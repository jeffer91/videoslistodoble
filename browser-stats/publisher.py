"""Publica un video desde la web de cada red, con el perfil de navegador propio de Studio.

Uso: publisher.py <red> <perfil> <trabajo.json>

El trabajo indica el archivo, el texto y si es un ensayo. En modo ensayo se hace
todo (abrir, cargar el video, escribir el texto, elegir la visibilidad) excepto
pulsar el botón final de publicar.

Eventos (una línea JSON por evento):
  {"stage": "...", "message": "..."}      avance
  {"submitted": true}                      se pulsó «Publicar» (a partir de aquí no se reintenta solo)
  {"result": {"url": ..., "dry": bool}}    terminado
  {"error": "...", "screenshot": "..."}    fallo, con captura de la pantalla
"""
import json
import re
import sys
import time

from playwright.sync_api import sync_playwright, Error as BrowserError

import reader
from reader import emit, open_browser, logged_in, allowed

UPLOAD_MINUTES = 30


def step(message):
    emit(stage="publish", message=message)


def words(*options):
    # Playwright no admite «/» sin escapar dentro de un nombre con expresión regular.
    return re.compile(r"^\s*(" + "|".join(option.replace("/", r"\/") for option in options) + r")\s*$", re.I)


def button(scope, *names):
    return scope.get_by_role("button", name=words(*names))


def click_first(scope, locators, timeout=15000):
    """Pulsa el primer elemento visible de una lista de alternativas (cada red cambia sus textos)."""
    deadline = time.time() + timeout / 1000
    while time.time() < deadline:
        for locator in locators:
            try:
                count = locator.count()
            except BrowserError:
                continue
            for index in range(count):
                item = locator.nth(index)
                try:
                    if item.is_visible() and item.is_enabled():
                        item.click(timeout=5000)
                        return True
                except BrowserError:
                    continue
        time.sleep(0.5)
    return False


def fill_editable(page, locator, text):
    locator.wait_for(state="visible", timeout=120000)
    locator.click()
    page.keyboard.press("Control+A")
    page.keyboard.press("Delete")
    page.keyboard.insert_text(text)


def choose_file(scope, path):
    file_input = scope.locator('input[type="file"]').first
    file_input.wait_for(state="attached", timeout=60000)
    file_input.set_input_files(path)


def wait_for(check, minutes, message):
    deadline = time.time() + minutes * 60
    while time.time() < deadline:
        if check():
            return True
        time.sleep(2)
    raise ValueError(message)


# ---------------------------------------------------------------- YouTube

def youtube(page, job):
    step("Abriendo YouTube Studio…")
    page.goto("https://www.youtube.com/upload", wait_until="domcontentloaded", timeout=60000)
    choose_file(page, job["file"])
    step("Cargando el video…")
    title = page.locator("#title-textarea #textbox").first
    fill_editable(page, title, job["title"][:100])
    if job["description"]:
        fill_editable(page, page.locator("#description-textarea #textbox").first, job["description"][:4900])
    if not click_first(page, [page.locator('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]'),
                              page.get_by_role("radio", name=re.compile(r"no es contenido para niños|not made for kids", re.I))]):
        raise ValueError("No encontré la opción «No es contenido para niños»")
    for _ in range(3):
        click_first(page, [page.locator("#next-button"), button(page, "siguiente", "next")], 20000)
        page.wait_for_timeout(1500)
    privacy = {"public": "PUBLIC", "unlisted": "UNLISTED", "private": "PRIVATE"}.get(job.get("privacy") or "public", "PUBLIC")
    if not click_first(page, [page.locator(f'tp-yt-paper-radio-button[name="{privacy}"]')]):
        raise ValueError("No encontré la opción de visibilidad")
    link = page.locator("a.style-scope.ytcp-video-info, ytcp-video-info a[href*='youtu']").first
    url = link.get_attribute("href") if link.count() else None
    step("Esperando a que termine la carga…")
    progress = page.locator("ytcp-video-upload-progress").first

    def uploaded():
        try:
            text = progress.inner_text(timeout=3000)
        except BrowserError:
            return False
        return not re.search(r"subiendo|uploading|\d+\s*%|restante|remaining", text, re.I)

    wait_for(uploaded, UPLOAD_MINUTES, "YouTube no terminó de cargar el video a tiempo")
    if job.get("dryRun"):
        return {"dry": True, "url": url, "note": "Ensayo correcto. YouTube guardó un borrador privado que puedes borrar en Studio."}
    emit(submitted=True)
    click_first(page, [page.locator("#done-button"), button(page, "publicar", "publish", "guardar", "save")], 20000)
    wait_for(lambda: page.locator("ytcp-video-share-dialog, #close-button").count() > 0 or
             page.get_by_text(re.compile(r"video publicado|video published", re.I)).count() > 0,
             10, "YouTube no confirmó la publicación")
    return {"url": url}


# ---------------------------------------------------------------- TikTok

def tiktok(page, job):
    step("Abriendo TikTok Studio…")
    page.goto("https://www.tiktok.com/tiktokstudio/upload", wait_until="domcontentloaded", timeout=60000)
    choose_file(page, job["file"])
    step("Cargando el video…")
    editor = page.locator('div[contenteditable="true"]').first
    fill_editable(page, editor, job["caption"][:2200])
    page.keyboard.press("End")
    post = page.locator('button[data-e2e="post_video_button"]')

    def ready():
        candidates = [post, button(page, "publicar", "post")]
        for locator in candidates:
            if locator.count() and locator.first.is_visible() and locator.first.is_enabled() and \
                    locator.first.get_attribute("aria-disabled") != "true" and \
                    locator.first.get_attribute("data-disabled") != "true":
                return True
        return False

    step("Esperando a que TikTok procese el video…")
    wait_for(ready, UPLOAD_MINUTES, "TikTok no habilitó el botón Publicar")
    if job.get("dryRun"):
        return {"dry": True, "url": None, "note": "Ensayo correcto: el video quedó listo para publicar."}
    emit(submitted=True)
    click_first(page, [post, button(page, "publicar", "post")])
    page.wait_for_timeout(2000)
    click_first(page, [button(page, "publicar ahora", "post now")], 4000)
    wait_for(lambda: "/tiktokstudio/content" in page.url or
             page.get_by_text(re.compile(r"(video|publicación).*(publicad|compartid)|posted|uploaded", re.I)).count() > 0,
             10, "TikTok no confirmó la publicación")
    return {"url": None}


# ---------------------------------------------------------------- Instagram

def instagram(page, job):
    step("Abriendo Instagram…")
    page.goto("https://www.instagram.com/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(3000)
    create = page.locator('svg[aria-label="Nueva publicación"], svg[aria-label="New post"], svg[aria-label="Crear"], svg[aria-label="Create"]')
    if not click_first(page, [create.locator("xpath=ancestor::*[self::a or @role='link' or @role='button'][1]"), create]):
        raise ValueError("No encontré el botón Crear de Instagram")
    page.wait_for_timeout(1500)
    click_first(page, [page.get_by_role("link", name=words("publicación", "post")), page.get_by_text(words("publicación", "post"))], 4000)
    dialog = page.locator('div[role="dialog"]').last
    choose_file(dialog, job["file"])
    step("Cargando el video…")
    click_first(page, [button(page, "aceptar", "ok")], 6000)
    for _ in range(2):
        if not click_first(page, [page.get_by_role("button", name=words("siguiente", "next")),
                                  page.locator('div[role="dialog"] div[role="button"]').filter(has_text=words("siguiente", "next"))], 60000):
            raise ValueError("Instagram no mostró el botón Siguiente")
        page.wait_for_timeout(1500)
    caption = page.locator('div[role="dialog"] div[contenteditable="true"][role="textbox"]').first
    fill_editable(page, caption, job["caption"][:2200])
    if job.get("dryRun"):
        return {"dry": True, "url": None, "note": "Ensayo correcto: el Reel quedó listo para compartir."}
    emit(submitted=True)
    if not click_first(page, [page.get_by_role("button", name=words("compartir", "share")),
                              page.locator('div[role="dialog"] div[role="button"]').filter(has_text=words("compartir", "share"))], 20000):
        raise ValueError("No encontré el botón Compartir")
    step("Instagram está publicando el Reel…")
    wait_for(lambda: page.get_by_text(re.compile(r"compartid|se compartió|publicad|has been shared|reel shared|post shared", re.I)).count() > 0,
             UPLOAD_MINUTES, "Instagram no confirmó la publicación")
    return {"url": None}


# ---------------------------------------------------------------- Facebook

def facebook_page(page, job):
    reel = job.get("reel")
    step("Abriendo Meta Business Suite…")
    page.goto("https://business.facebook.com/latest/reels_composer" if reel else "https://business.facebook.com/latest/composer",
              wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(3000)
    if not reel:
        click_first(page, [button(page, "agregar video", "add video", "agregar foto o video", "add photo/video")], 8000)
    choose_file(page, job["file"])
    step("Cargando el video…")
    editor = page.locator('div[contenteditable="true"][role="textbox"], div[contenteditable="true"]').first
    fill_editable(page, editor, job["caption"][:5000])
    share = [button(page, "compartir", "share", "publicar", "publish")]
    for _ in range(3):
        if any(l.count() and l.first.is_visible() for l in share):
            break
        click_first(page, [button(page, "siguiente", "next")], 30000)
        page.wait_for_timeout(1500)
    wait_for(lambda: any(l.count() and l.first.is_visible() and l.first.is_enabled() for l in share),
             UPLOAD_MINUTES, "Facebook no habilitó el botón para publicar")
    if job.get("dryRun"):
        return {"dry": True, "url": None, "note": "Ensayo correcto: la publicación de la página quedó lista."}
    emit(submitted=True)
    click_first(page, share, 20000)
    wait_for(lambda: page.get_by_text(re.compile(r"publicad|se public|compartid|se compartió|published|shared|programad", re.I)).count() > 0,
             UPLOAD_MINUTES, "Facebook no confirmó la publicación")
    return {"url": None}


def facebook_group(page, job):
    step("Abriendo el grupo de Facebook…")
    page.goto(job["groupUrl"], wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(3000)
    if not click_first(page, [page.get_by_role("button", name=re.compile(r"^(escribe algo|write something)", re.I)),
                              page.get_by_text(re.compile(r"^(escribe algo|write something)", re.I))]):
        raise ValueError("No encontré «Escribe algo…» en el grupo")
    dialog = page.locator('div[role="dialog"]').last
    dialog.wait_for(timeout=20000)
    click_first(dialog, [dialog.get_by_role("button", name=re.compile(r"foto\/video|photo\/video", re.I)),
                         dialog.locator('[aria-label*="Foto/video" i], [aria-label*="Photo/video" i]')], 8000)
    choose_file(dialog, job["file"])
    step("Cargando el video en el grupo…")
    fill_editable(page, dialog.locator('div[contenteditable="true"][role="textbox"]').first, job["caption"][:5000])
    post = [dialog.get_by_role("button", name=words("publicar", "post"))]
    wait_for(lambda: post[0].count() and post[0].first.is_enabled(), UPLOAD_MINUTES, "El grupo no habilitó el botón Publicar")
    if job.get("dryRun"):
        return {"dry": True, "url": None, "note": "Ensayo correcto: la publicación del grupo quedó lista."}
    emit(submitted=True)
    click_first(dialog, post, 20000)
    wait_for(lambda: page.locator('div[role="dialog"]').count() == 0 or not dialog.is_visible(),
             UPLOAD_MINUTES, "El grupo no confirmó la publicación")
    return {"url": None}


FLOWS = {"youtube": youtube, "tiktok": tiktok, "instagram": instagram, "facebook": facebook_page}


def main():
    network, profile, job_file = sys.argv[1:4]
    with open(job_file, encoding="utf-8") as handle:
        job = json.load(handle)
    with sync_playwright() as pw:
        reader.START[network] = {"youtube": "https://studio.youtube.com/", "tiktok": "https://www.tiktok.com/tiktokstudio",
                                 "instagram": "https://www.instagram.com/", "facebook": "https://business.facebook.com/"}[network]
        process, browser = open_browser(pw, network, profile)
        page = None
        try:
            context = browser.contexts[0]
            page = context.pages[0] if context.pages else context.new_page()
            if not logged_in(context, network):
                emit(stage="login", message="Inicia sesión en la ventana del navegador para publicar.")
                wait_for(lambda: logged_in(context, network), 5,
                         "No hay sesión iniciada. Abre el lector de navegador de esta red e inicia sesión una vez.")
            result = FLOWS[network](page, job)
            if network == "facebook" and job.get("groupUrl"):
                group = facebook_group(page, job)
                result["note"] = ((result.get("note") or "") + " También en el grupo." if not job.get("dryRun")
                                  else (result.get("note") or "") + " " + (group.get("note") or "")).strip()
            emit(result=result)
        except Exception as error:  # noqa: BLE001 - se informa cualquier fallo con su captura
            shot = job.get("screenshot")
            try:
                if page and shot:
                    page.screenshot(path=shot, full_page=False)
            except Exception:  # noqa: BLE001
                shot = None
            emit(error=str(error).splitlines()[0][:350], screenshot=shot)
            sys.exit(1)
        finally:
            try:
                browser.close()
            finally:
                process.terminate()


if __name__ == "__main__":
    main()
