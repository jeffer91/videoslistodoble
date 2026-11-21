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


FOLLOWERS = r"""() => {
  const text = document.body ? document.body.innerText : '';
  const patterns = [
    /suscriptores actuales\s*\n\s*(\d[\d.,]*(?:\s*(?:mil|mill\.?|k|m)\b)?)/i,
    /current subscribers\s*\n\s*(\d[\d.,]*(?:\s*(?:mil|mill\.?|k|m)\b)?)/i,
    /(\d[\d.,]*(?:\s*(?:mil|mill\.?|k|m)\b)?)\s*(?:seguidores|followers)\b/i,
    /(?:seguidores|followers)\s*\n\s*(\d[\d.,]*(?:\s*(?:mil|mill\.?|k|m)\b)?)/i,
  ];
  for (const pattern of patterns) { const match = text.match(pattern); if (match) return match[1].trim(); }
  return null;
}"""


def parse_count(raw):
    match = re.fullmatch(r"(\d[\d.,\s]*?)\s*(mil|mill\.?|k|m)?", (raw or "").strip().lower())
    if not match:
        return None
    value, unit = match.group(1).replace(" ", ""), match.group(2)
    if unit:
        value = value.replace(",", ".")
    elif re.fullmatch(r"\d{1,3}([.,]\d{3})+", value):
        value = re.sub(r"[.,]", "", value)
    elif re.search(r"[.,]", value):
        return None
    try:
        number = float(value) * {"k": 1e3, "mil": 1e3, "m": 1e6, "mill": 1e6, "mill.": 1e6}.get(unit, 1)
    except ValueError:
        return None
    return round(number)


def read_followers(page, reported, seconds=15):
    """Seguidores de la cuenta, leídos una sola vez por lectura (espera a que la página cargue la cifra)."""
    if reported:
        return True
    followers = raw = None
    for _ in range(seconds):
        try:
            raw = page.evaluate(FOLLOWERS)
        except BrowserError:
            raw = None
        followers = parse_count(raw)
        if followers is not None:
            break
        page.wait_for_timeout(1000)
    if followers is None:
        return False
    emit(account={"followers": followers, "raw": raw})
    return True


DIAGNOSTIC = None  # carpeta donde se guarda cómo se ve cada página (para ajustar el lector)

SNAPSHOT = r"""(limit) => {
  const rows = [...document.querySelectorAll('ytcp-video-row,tr,[role="row"],article,[data-e2e*="post-item"]')].slice(0, 3);
  const headers = [...document.querySelectorAll('th,[role="columnheader"],ytcp-table-header')].slice(0, 30).map(h => h.outerHTML.slice(0, 400));
  const pagers = [...document.querySelectorAll('[aria-label]')].map(e => e.tagName + ' ' + e.getAttribute('aria-label')).filter(t => /siguiente|next|anterior|previous/i.test(t)).slice(0, 10);
  return JSON.stringify({ url: location.href, headers, pagers, rows: rows.map(r => r.outerHTML.slice(0, limit)), text: document.body.innerText.slice(0, limit) }, null, 1);
}"""


def save_diagnostic(page, name):
    if not DIAGNOSTIC:
        return
    try:
        DIAGNOSTIC.mkdir(parents=True, exist_ok=True)
        (DIAGNOSTIC / name).write_text(page.evaluate(SNAPSHOT, 40000), encoding="utf-8")
    except Exception:  # noqa: BLE001 - el diagnóstico nunca debe interrumpir la lectura
        pass


def instagram_user(page, context):
    """Nombre de usuario propio a partir de la sesión (no de las sugerencias de la portada)."""
    own = next((c["value"] for c in context.cookies() if c["name"] == "ds_user_id" and c["domain"].endswith("instagram.com")), None)
    if own:
        try:
            name = page.evaluate("""async id => {
              const reply = await fetch('/api/v1/users/' + id + '/info/', { headers: { 'X-IG-App-ID': '936619743392459' }, credentials: 'include' });
              if (!reply.ok) return null;
              return (await reply.json())?.user?.username || null;
            }""", own)
            if name and re.fullmatch(r"[\w.]{1,30}", name):
                return name
        except BrowserError:
            pass
    try:
        name = page.evaluate(r"""() => {
          for (const a of document.querySelectorAll('a[href]')) {
            const text = (a.innerText || '').trim().toLowerCase();
            const path = (a.getAttribute('href') || '').split(/[?#]/)[0];
            if ((text === 'perfil' || text === 'profile') && /^\/[\w.]+\/$/.test(path)) return path.slice(1, -1);
          }
          return null;
        }""")
        if name:
            return name
    except BrowserError:
        pass
    return None


def detail_urls(network, key, row):
    if network == "youtube":
        return [f"https://studio.youtube.com/video/{key}/analytics/tab-overview/period-lifetime",
                f"https://studio.youtube.com/video/{key}/analytics/tab-engagement/period-lifetime"]
    if network == "tiktok":
        candidates = [row.get("analyticsUrl"), f"https://www.tiktok.com/tiktokstudio/analytics/{key}", row["url"]]
    else:
        candidates = [row.get("analyticsUrl"), row["url"]]
    return list(dict.fromkeys(url for url in candidates if url))


INSIGHTS = re.compile(r"^(ver estadísticas|ver estadísticas y anuncios|estadísticas|view insights|see insights|insights)$", re.I)


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
        page.wait_for_timeout(3000)
        read_followers(page, False)
        if not match:
            raise ValueError("No se encontró tu canal en YouTube Studio.")
        base = f"https://studio.youtube.com/channel/{match.group(1)}/videos"
        return [(base + "/upload", "long", "Contenido → Videos"), (base + "/short", "short", "Contenido → Shorts")]
    if network == "instagram":
        page.goto("https://www.instagram.com/", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(4000)
        user = instagram_user(page, page.context)
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
        pagers = [page.locator("#navigate-after"),
                  page.locator('[aria-label="Página siguiente"], [aria-label="Siguiente página"], [aria-label="Next page"]'),
                  page.get_by_role("button", name=re.compile(r"^(next page|página siguiente|siguiente página|next|siguiente)$", re.I))]
        next_button = None
        for group in pagers:
            for candidate in group.all():
                try:
                    if candidate.is_visible() and candidate.is_enabled() and candidate.get_attribute("aria-disabled") != "true" \
                            and candidate.get_attribute("disabled") is None:
                        next_button = candidate
                        break
                except BrowserError:
                    continue
            if next_button:
                break
        if next_button and fresh:
            next_button.click(timeout=5000)
            page.wait_for_timeout(1500)
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
    followers = network == "youtube"  # YouTube ya lo leyó en el panel del canal
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
        followers = read_followers(page, followers)
        before = set(discovered)
        save_diagnostic(page, network + "-listado-" + re.sub(r"\W+", "-", label) + ".json")
        collect(page, network, discovered)
        if fmt:
            for key in set(discovered) - before:
                discovered[key]["format"] = fmt

    details = page.context.new_page()
    missing = 0
    total = len(discovered)
    for index, (key, row) in enumerate(discovered.items(), start=1):
        emit(stage="details", message="Leyendo las cifras de cada video…", index=index, total=total)
        for url in detail_urls(network, key, row):
            try:
                details.goto(url, wait_until="domcontentloaded", timeout=20000)
                if not allowed(details.url, network):
                    continue
                details.wait_for_timeout(1500)
                insights = details.get_by_text(INSIGHTS, exact=True)
                opened = insights.count() >= 1 and insights.first.is_visible()
                if opened:
                    insights.first.click(timeout=4000)
                    details.wait_for_timeout(1200)
                if not allowed(details.url, network):
                    continue
                found = False
                # Las páginas de estadísticas cargan las cifras después: se espera hasta 15 s a que aparezcan.
                items = []
                for _ in range(15):
                    items = [item for item in details.evaluate(READ, {"network": network, "openedId": key if opened else None})
                             if item["externalId"] == key and item["metrics"]]
                    if items:
                        break
                    details.wait_for_timeout(1000)
                if index <= 2:
                    save_diagnostic(details, f"{network}-detalle-{index}-{len(items) and 'con' or 'sin'}-cifras.json")
                for item in items:
                    if item["externalId"] != key:
                        continue
                    # En YouTube la dirección ya fija «desde la publicación»; en otras redes se descarta un período parcial.
                    if network != "youtube" and item.get("period") and \
                            not re.search(r"lifetime|desde siempre|desde la publicación|since published|total", item["period"], re.I):
                        continue
                    found = found or bool(item["metrics"])
                    row["metrics"].update(item["metrics"])
                    row["rawMetrics"].update(item["rawMetrics"])
                    for field in ["publishedAt", "title", "dateText", "duration"]:
                        row[field] = row.get(field) or item.get(field)
                if found and network != "youtube":
                    break
            except BrowserError:
                continue
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


def close_browser(browser, process, seconds=15):
    """Cierra el navegador como lo haría el usuario para que guarde la sesión (cookies) en el perfil.

    Matar el proceso de golpe puede perder la sesión recién iniciada y obliga a volver a
    escribir la contraseña y el código de verificación en Instagram, Facebook y TikTok.
    """
    try:
        browser.new_browser_cdp_session().send("Browser.close")
    except Exception:  # noqa: BLE001 - si ya estaba cerrado no hay nada que hacer
        pass
    try:
        process.wait(timeout=seconds)
    except subprocess.TimeoutExpired:
        process.terminate()


GROUP_METRICS = {
    "newMembers": r"(?:miembros nuevos|nuevos miembros|new members)",
    "activeMembers": r"(?:miembros activos|active members)",
    "posts": r"(?:publicaciones|posts)",
    "comments": r"(?:comentarios|comments)",
    "reactions": r"(?:reacciones|reactions)",
}
NUMBER = r"(\d[\d.,]*(?:\s*(?:mil|mill\.?|k|m)\b)?)"


def group_numbers(text):
    """Cifras del panel de estadísticas del grupo (la etiqueta va antes o después del número)."""
    found = {}
    for key, label in GROUP_METRICS.items():
        for pattern in [label + r"\s*\n\s*" + NUMBER, NUMBER + r"\s*\n?\s*" + label]:
            match = re.search(pattern, text, re.I)
            value = parse_count(match.group(1)) if match else None
            if value is not None:
                found[key] = value
                break
    return found


def read_group(page, url):
    """Miembros y estadísticas del grupo de Facebook (las de administrador, si las hay)."""
    emit(stage="navigate", message="Abriendo tu grupo de Facebook…")
    page.goto(url, wait_until="domcontentloaded", timeout=60000)
    if not allowed(page.url, "facebook"):
        raise ValueError("No se pudo abrir el grupo")
    members = raw = None
    for _ in range(15):
        page.wait_for_timeout(1000)
        text = page.locator("body").inner_text(timeout=10000)
        match = re.search(NUMBER + r"\s*(?:miembros|members)\b", text, re.I)
        if match:
            raw = match.group(0)
            members = parse_count(match.group(1))
            if members is not None:
                break
    name = None
    try:
        name = (page.locator("h1").first.inner_text(timeout=3000) or "").strip()[:120] or None
    except BrowserError:
        pass
    save_diagnostic(page, "facebook-grupo.json")
    insights = {}
    emit(stage="navigate", message="Leyendo las estadísticas del grupo…")
    try:
        page.goto(url.rstrip("/") + "/insights", wait_until="domcontentloaded", timeout=60000)
        for _ in range(15):
            page.wait_for_timeout(1000)
            insights = group_numbers(page.locator("body").inner_text(timeout=10000))
            if len(insights) >= 2:
                break
        save_diagnostic(page, "facebook-grupo-estadisticas.json")
    except BrowserError:
        insights = {}
    if members is None and not insights:
        emit(stage="navigate", message="No encontré las cifras del grupo; revisa el diagnóstico.")
        return
    emit(group={"members": members, "raw": raw, "name": name, "url": url, **insights})


def main():
    global DIAGNOSTIC
    network, profile = sys.argv[1:3]
    DIAGNOSTIC = Path(profile).parent / "diagnostico"
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
            target = pages[-1] if pages else context.pages[-1]
            group = sys.argv[3] if len(sys.argv) > 3 and network == "facebook" else ""
            if group:
                # El grupo se lee antes del cierre del escaneo para que el aviso «done» siga siendo el último.
                try:
                    read_group(target, group)
                except Exception as error:  # noqa: BLE001 - el grupo nunca impide leer la página
                    emit(stage="navigate", message="No se pudo leer el grupo: " + str(error).splitlines()[0][:160])
            scan(target, network)
        finally:
            close_browser(browser, process)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit(error=str(error).splitlines()[0][:350])
        sys.exit(1)
