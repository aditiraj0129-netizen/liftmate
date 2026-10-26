"""
One small module for every AI call, so switching provider or paid tier later
is a config change, not a rewrite.

Providers (both have free tiers):
  - Google Gemini: key starts with "AIza"  (GEMINI_API_KEY)
  - Groq:          key starts with "gsk_"  (GROQ_API_KEY)
Use either one or both. If a Groq key is pasted into GEMINI_API_KEY by mistake, it is detected and used as Groq.
Every function asks the model for JSON and returns a Python dict.
"""

import json
import logging
import re

import httpx
from fastapi import HTTPException

from app.config import settings

log = logging.getLogger("liftmate.ai")

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models"
# Best first. If GROQ_MODEL is "auto" or unavailable, the first one your key can use is picked.
GROQ_TEXT_PREFERENCE = [
    "openai/gpt-oss-120b",
    "llama-3.3-70b-versatile",
    "qwen/qwen3.8-27b",
    "openai/gpt-oss-20b",
    "llama-3.1-8b-instant",
]
GROQ_VISION_HINTS = ("scout", "maverick", "vision", "muse")

_client = httpx.Client(timeout=90)
_gemini_broken = False  # set when Google says the key is invalid, so we stop trying it
_groq_picked: dict[str, str] = {}  # "text" / "vision" -> model id that works for this key


class AIError(Exception):
    pass


def _looks_like(key: str, prefix: str) -> bool:
    key = (key or "").strip()
    return key.startswith(prefix) and len(key) > 20 and "PASTE" not in key.upper()


def gemini_key() -> str:
    key = settings.gemini_api_key.strip()
    return key if _looks_like(key, "AIza") and not _gemini_broken else ""


def groq_key() -> str:
    for key in (settings.groq_api_key, settings.gemini_api_key):
        if _looks_like(key, "gsk_"):
            return key.strip()
    return ""


def provider_status() -> dict:
    return {"gemini": bool(gemini_key()), "groq": bool(groq_key())}


def _parse_json(text: str) -> dict:
    """Models sometimes wrap JSON in ``` fences. Strip them and parse."""
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, re.S)
        if match:
            return json.loads(match.group(0))
        raise AIError("The AI answer was not valid JSON.")


def _gemini(system: str, prompt: str, image_b64: str | None, mime: str, temperature: float) -> dict:
    global _gemini_broken
    parts: list[dict] = [{"text": prompt}]
    if image_b64:
        parts.append({"inline_data": {"mime_type": mime, "data": image_b64}})
    body = {
        "system_instruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": temperature},
    }
    response = _client.post(
        GEMINI_URL.format(model=settings.gemini_model),
        headers={"x-goog-api-key": gemini_key()},
        json=body,
    )
    if response.status_code != 200:
        if "API_KEY_INVALID" in response.text or response.status_code in (401, 403):
            _gemini_broken = True
            log.warning("Gemini key rejected by Google. Check GEMINI_API_KEY in api/.env (it should start with AIza).")
        raise AIError(f"Gemini error {response.status_code}")
    data = response.json()
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        raise AIError("Gemini returned an empty answer.")
    return _parse_json(text)


def _groq_available() -> list[str]:
    response = _client.get(GROQ_MODELS_URL, headers={"Authorization": f"Bearer {groq_key()}"})
    if response.status_code != 200:
        raise AIError(f"Groq key problem ({response.status_code}). Check GROQ_API_KEY in api/.env.")
    return [m["id"] for m in response.json().get("data", []) if m.get("active", True)]


def _groq_model(kind: str, refresh: bool = False) -> str:
    """Pick a Groq model this key can actually use, and remember it."""
    if kind in _groq_picked and not refresh:
        return _groq_picked[kind]
    wanted = settings.groq_model.strip()
    if kind == "text" and wanted and wanted != "auto" and not refresh:
        _groq_picked[kind] = wanted
        return wanted
    available = _groq_available()
    if kind == "vision":
        choice = next((m for m in available if any(h in m.lower() for h in GROQ_VISION_HINTS)), None)
        if not choice:
            raise AIError("Your Groq account has no image model. Add a Gemini key for Machine Guide photos.")
    else:
        choice = next((m for m in GROQ_TEXT_PREFERENCE if m in available), None)
        choice = choice or next((m for m in available if "whisper" not in m and "tts" not in m and "guard" not in m), None)
        if not choice:
            raise AIError("No usable Groq chat model found for this key.")
    log.warning("Using Groq model %s for %s", choice, kind)
    _groq_picked[kind] = choice
    return choice


def _groq(system: str, prompt: str, image_b64: str | None, mime: str, temperature: float, retry: bool = True) -> dict:
    kind = "vision" if image_b64 else "text"
    if image_b64:
        user_content: str | list = [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_b64}"}},
        ]
    else:
        user_content = prompt
    model = _groq_model(kind)
    response = _client.post(
        GROQ_URL,
        headers={"Authorization": f"Bearer {groq_key()}"},
        json={
            "model": model,
            "temperature": temperature,
            "max_tokens": 6000,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system + "\nAlways answer with one valid JSON object."},
                {"role": "user", "content": user_content},
            ],
        },
    )
    if response.status_code in (400, 404) and "model" in response.text and retry:
        # model retired or not allowed for this key -> pick another one and try again
        _groq_picked.pop(kind, None)
        _groq_model(kind, refresh=True)
        return _groq(system, prompt, image_b64, mime, temperature, retry=False)
    if response.status_code == 429:
        raise AIError("Groq free limit reached for this minute. Wait a moment and try again.")
    if response.status_code != 200:
        raise AIError(f"Groq error {response.status_code}: {response.text[:200]}")
    return _parse_json(response.json()["choices"][0]["message"]["content"])


def ask_json(
    system: str,
    prompt: str,
    image_b64: str | None = None,
    mime: str = "image/jpeg",
    temperature: float = 0.6,
) -> dict:
    """Ask the AI and get a dict back. Tries Gemini first, then Groq."""
    providers = []
    if gemini_key():
        providers.append(("Gemini", _gemini))
    if groq_key():
        providers.append(("Groq", _groq))
    if not providers:
        raise HTTPException(
            status_code=503,
            detail="No working AI key. Put a Gemini key (starts with AIza) in GEMINI_API_KEY or a Groq key (starts with gsk_) in GROQ_API_KEY in api/.env, then restart the backend.",
        )
    errors = []
    for name, call in providers:
        try:
            return call(system, prompt, image_b64, mime, temperature)
        except (AIError, httpx.HTTPError, KeyError, ValueError) as error:
            log.warning("%s failed: %s", name, error)
            errors.append(f"{name}: {error}")
    raise HTTPException(status_code=503, detail="AI is busy right now. " + " | ".join(errors))


def try_ask_json(system: str, prompt: str, temperature: float = 0.6) -> dict | None:
    """Same as ask_json but returns None instead of failing (for optional AI extras)."""
    try:
        return ask_json(system, prompt, temperature=temperature)
    except HTTPException:
        return None
