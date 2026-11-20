"""Supervised collection from visible creator pages using a dedicated browser profile."""
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import time
from urllib.request import urlopen
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, Error as BrowserError

START = {
    "youtube": "https://studio.youtube.com/",
    "instagram": "https://www.instagram.com/",
    "facebook": "https://business.facebook.com/latest/posts/published_posts",
    "tiktok": "https://www.tiktok.com/tiktokstudio/content",
}
READ = Path(__file__).with_name("read.js").read_text(encoding="utf-8")


def emit(**event):
    print(json.dumps(event), flush=True)


def allowed(url, network):
    u = urlparse(url)
    domain = network + ".com"
    return u.scheme == "https" and (u.hostname == domain or (u.hostname or "").endswith("." + domain))


# Cookie que indica que la sesión está iniciada en cada red.
SESSION = {
    "youtube": ("youtube.com", {"SAPISID", "__Secure-3PAPISID", "LOGIN_INFO"}),
    "tiktok": ("tiktok.com", {"sessionid", "sessionid_ss"}),
    "instagram": ("instagram.com", {"sessionid"}),
    "facebook": ("facebook.com", {"c_user"}),
}

PROFILE_LINK = """() => {
  const skip = new Set(['explore', 'reels', 'direct', 'accounts', 'stories', 'p', 'reel']);
  for (const a of document.querySelectorAll('a[href]')) {
    const alt = (a.querySelector('img')?.alt || '').toLowerCase();
    const path = (a.getAttribute('href') || '').replace(/^https?:\\/\\/[^/]+/, '').split(/[?#]/)[0];
    const match = path.match(/^\\/([\\w.]+)\\/$/);
    if (match && !skip.has(match[1]) && /perfil|profile/.test(alt)) return match[1];
  }
  return null;
}"""


def is_listing(url, network):
    parsed = urlparse(url)
    return allowed(url, network) and {
        "youtube": parsed.hostname == "studio.youtube.com" and "/videos" in parsed.path,
        "tiktok": "/tiktokstudio/" in parsed.path or parsed.path.startswith("/creator-center/"),
        "facebook": parsed.hostname == "business.facebook.com",
        "instagram": bool(re.fullmatch(r"/[\w.]+/reels/?", parsed.path)),
    }[network]


def logged_in(context, network):
    domain, names = SESSION[network]
    return any(c["name"] in names and c["domain"].lstrip(".").endswith(domain) for c in context.cookies())


def wait_for_login(context, network, minutes=15):
    if logged_in(context, network):
        return
    emit(stage="login", message="Inicia sesión en la ventana del navegador. Studio continuará solo.")
    deadline = time.time() + minutes * 60
    while time.time() < deadline:
        time.sleep(2)
        if logged_in(context, network):
            time.sleep(3)  # deja que la red termine de redirigir tras el inicio de sesión
            return
    raise ValueError("No se detectó el inicio de sesión. Vuelve a abrir el lector cuando quieras intentarlo.")


def targets(page, network):
    """Listados que Studio abre por sí solo: (dirección, formato, nombre visible)."""
    if network == "youtube":
        page.goto("https://studio.youtube.com/", wait_until="domcontentloaded", timeout=60000)
        try:
            page.wait_for_url(re.compile(r"/channel/UC[\w-]+"), timeout=45000)
        except BrowserError:
            pass
        match = re.search(r"/channel/(UC[\w-]+)", page.url)
        if not match:
            raise ValueError("No se encontró tu canal en YouTube Studio.")
        base = f"https://studio.youtube.com/channel/{match.group(1)}/videos"
        return [(base + "/upload", "long", "Contenido → Videos"), (base + "/short", "short", "Contenido → Shorts")]
    if network == "instagram":
        page.goto("https://www.instagram.com/", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(4000)
        user = page.evaluate(PROFILE_LINK)
        return [(f"https://www.instagram.com/{user}/reels/" if user else None, "short", "Perfil → Reels")]
    label = "TikTok Studio → Contenido" if network == "tiktok" else "Contenido publicado"
    return [(START[network], None, label)]


def collect(page, network, discovered):
    visited = set()
    idle = 0
    for _ in range(1000):
        if not allowed(page.url, network):
            raise ValueError("El navegador salió de la página de contenido.")
        rows = page.evaluate(READ, network)
        signature = tuple(dict.fromkeys(row["externalId"] for row in rows))
        fresh = signature not in visited
        visited.add(signature)
        for row in rows:
            key = row["externalId"]
            previous = discovered.get(key)
            if previous is None or len(row["metrics"]) > len(previous["metrics"]):
                discovered[key] = row
        pagers = page.get_by_role("button", name=re.compile(r"^(next page|página siguiente|siguiente página|next|siguiente)$", re.I))
        next_button = next((b for b in pagers.all() if b.is_visible() and b.is_enabled() and b.get_attribute("aria-disabled") != "true"), None)
        if next_button and fresh:
            next_button.click(timeout=5000)
        else:
            links = page.locator('a[href*="/video/"],a[href*="/reel/"],a[href*="/analytics/"]')
            if links.count() and links.last.is_visible():
                links.last.scroll_into_view_if_needed(timeout=5000)
            page.mouse.wheel(0, 1400)
        page.wait_for_timeout(1000)
        idle = 0 if fresh else idle + 1
        if fresh:
            emit(stage="listing", message="Recorriendo el listado…", found=len(discovered))
        if idle >= 3:
            break


def scan(page, network):
    discovered = {}
    for url, fmt, label in targets(page, network):
        if url:
            emit(stage="navigate", message=f"Abriendo {label}…")
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(4000)
        else:
            emit(stage="navigate", message=f"Abre {label} en el navegador. Studio continuará solo.")
            deadline = time.time() + 600
            while not is_listing(page.url, network):
                if time.time() > deadline:
                    raise ValueError(f"No se abrió {label}.")
                page.wait_for_timeout(1500)
            page.wait_for_timeout(3000)
        if not is_listing(page.url, network):
            raise ValueError(f"No se pudo abrir {label}. Comprueba que la cuenta tenga acceso.")
        before = set(discovered)
        collect(page, network, discovered)
        if fmt:
            for key in set(discovered) - before:
                discovered[key]["format"] = fmt

    details = page.context.new_page()
    missing = 0
    total = len(discovered)
    for index, (key, row) in enumerate(discovered.items(), start=1):
        emit(stage="details", message="Leyendo las cifras de cada video…", index=index, total=total)
        url = row["url"]
        if network == "youtube":
            url = f"https://studio.youtube.com/video/{key}/analytics/tab-overview/period-lifetime"
        try:
            details.goto(url, wait_until="domcontentloaded", timeout=18000)
            if allowed(details.url, network):
                details.wait_for_timeout(1200)
                insights = details.get_by_text(re.compile(r"^(ver estadísticas|view insights|see insights)$", re.I), exact=True)
                opened = insights.count() == 1 and insights.is_visible()
                if opened:
                    insights.click(timeout=4000)
                    details.wait_for_timeout(900)
                if not allowed(details.url, network):
                    continue_reading = []
                else:
                    continue_reading = details.evaluate(READ, {"network": network, "openedId": key if opened else None})
                for item in continue_reading:
                    if item["externalId"] == key:
                        if item.get("period") and not re.search(r"lifetime|desde siempre|desde la publicación|since published", item["period"], re.I):
                            continue
                        row["metrics"].update(item["metrics"])
                        row["rawMetrics"].update(item["rawMetrics"])
                        for field in ["publishedAt", "title", "dateText"]:
                            row[field] = row.get(field) or item.get(field)
        except BrowserError:
            pass
        if row["metrics"]:
            emit(video=row)
        else:
            missing += 1
    details.close()
    emit(done=True, discovered=len(discovered), missing=missing)


def find_browser():
    """Edge o Chrome instalados en el equipo (no el navegador de pruebas de Playwright)."""
    if os.name == "nt":
        roots = [os.environ.get(k) for k in ("PROGRAMFILES(X86)", "PROGRAMFILES", "LOCALAPPDATA")]
        for root in filter(None, roots):
            for relative in (r"Microsoft\Edge\Application\msedge.exe", r"Google\Chrome\Application\chrome.exe"):
                candidate = os.path.join(root, relative)
                if os.path.isfile(candidate):
                    return candidate
        return shutil.which("msedge") or shutil.which("chrome")
    return shutil.which("google-chrome") or shutil.which("chromium") or shutil.which("chromium-browser")


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def open_browser(pw, network, profile):
    """Abre el navegador como una ventana normal y Studio solo se conecta para leer.

    Un navegador lanzado en modo automatizado queda marcado y Google (y otras redes)
    rechazan el inicio de sesión. Abierto de forma normal, el usuario inicia sesión
    él mismo y la sesión queda guardada en el perfil propio de Studio.
    """
    executable = find_browser()
    if not executable:
        raise ValueError("Instala Microsoft Edge o Google Chrome para usar el lector.")
    port = free_port()
    process = subprocess.Popen([executable, f"--remote-debugging-port={port}", f"--user-data-dir={profile}",
                                "--no-first-run", "--no-default-browser-check", "--new-window", START[network]],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    emit(browserPid=process.pid)
    deadline = time.time() + 40
    while time.time() < deadline:
        if process.poll() is not None:
            raise ValueError("El navegador se cerró al abrirse. Cierra cualquier lectura anterior y vuelve a intentarlo.")
        try:
            with urlopen(f"http://127.0.0.1:{port}/json/version", timeout=2):
                break
        except OSError:
            time.sleep(0.5)
    else:
        process.kill()
        raise ValueError("El navegador no respondió a tiempo.")
    browser = pw.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
    return process, browser


def main():
    network, profile = sys.argv[1:3]
    with sync_playwright() as pw:
        process, browser = open_browser(pw, network, profile)
        try:
            context = browser.contexts[0]
            page = next((p for p in context.pages if allowed(p.url, network)), None) or (context.pages or [context.new_page()])[0]
            if not allowed(page.url, network):
                page.goto(START[network], wait_until="commit", timeout=60000)
            try:
                page.bring_to_front()
            except BrowserError:
                pass
            emit(ready=True)
            wait_for_login(context, network)
            pages = [p for p in context.pages if allowed(p.url, network)]
            scan(pages[-1] if pages else context.pages[-1], network)
        finally:
            try:
                browser.close()
            finally:
                process.terminate()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit(error=str(error).splitlines()[0][:350])
        sys.exit(1)
