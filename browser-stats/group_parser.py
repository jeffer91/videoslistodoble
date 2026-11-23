"""Parseo verificable de cifras visibles en grupos de Facebook; no necesita navegador."""
import re

GROUP_METRICS = {
    "newMembers": r"(?:miembros nuevos|nuevos miembros|new members)",
    "activeMembers": r"(?:miembros activos|active members)",
    "posts": r"(?:publicaciones|posts)",
    "comments": r"(?:comentarios|comments)",
    "reactions": r"(?:reacciones|reactions)",
}
NUMBER = r"(\d[\d.,]*(?:[ \t]*(?:mil|mill\.?|k|m)\b)?)"


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


def group_numbers(text):
    """Acepta tanto 'Miembros nuevos\\n12' como '12 Miembros nuevos'.

    Las etiquetas no deben ser grupos de captura: si lo fueran, el parser leería
    el texto de la etiqueta como si fuera la cifra.
    """
    found = {}
    for key, label in GROUP_METRICS.items():
        # Cada captura debe pertenecer a la misma línea de la etiqueta o a
        # la línea inmediatamente siguiente. \s* libre saltaba a la cifra
        # de la siguiente estadística, intercambiando sus valores.
        patterns = [
            r"^[ \t]*" + label + r"[ \t]*[:\-]?[ \t]*(?:\r?\n[ \t]*)?" + NUMBER + r"[ \t]*$",
            r"^[ \t]*" + NUMBER + r"[ \t]*[:\-]?[ \t]*" + label + r"[ \t]*$",
        ]
        for pattern in patterns:
            match = re.search(pattern, text, re.I | re.M)
            value = parse_count(match.group(1)) if match else None
            if value is not None:
                found[key] = value
                break
    return found
