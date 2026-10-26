"""
Realistic coach voice (text-to-speech).

Voices: Microsoft neural voices made for India.
  English: en-IN-NeerjaNeural (female), en-IN-PrabhatNeural (male)
  Hindi:   hi-IN-SwaraNeural (female), hi-IN-MadhurNeural (male)

Two ways to reach them:
  1. Default (no key needed): the free `edge-tts` library. Great for building and beta testing.
     It uses Microsoft Edge's read-aloud service, which is not an official API, so it may change.
  2. Official (recommended before launch): Azure Speech. Free tier = 0.5 million characters/month.
     Put AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in api/.env and it is used automatically.

Every clip is saved in api/.tts_cache, so repeated phrases (rep counts, cues) cost nothing and play instantly.
"""

import hashlib
from pathlib import Path
from typing import Literal
from xml.sax.saxutils import escape

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from app.auth import current_user_id
from app.config import settings

router = APIRouter(tags=["voice"])

VOICES = {
    ("en", "female"): "en-IN-NeerjaNeural",
    ("en", "male"): "en-IN-PrabhatNeural",
    ("hi", "female"): "hi-IN-SwaraNeural",
    ("hi", "male"): "hi-IN-MadhurNeural",
}
# "hype" is a little faster and brighter, for motivation lines.
STYLES = {"normal": ("+4%", "+0Hz"), "hype": ("+12%", "+3Hz"), "calm": ("-4%", "-1Hz")}

CACHE_DIR = Path(__file__).resolve().parent.parent.parent / ".tts_cache"
CACHE_DIR.mkdir(exist_ok=True)


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=700)
    lang: Literal["en", "hi"] = "en"
    gender: Literal["female", "male"] = "female"
    style: Literal["normal", "hype", "calm"] = "normal"


async def _edge(text: str, voice: str, rate: str, pitch: str) -> bytes:
    import edge_tts  # imported here so the server still starts if the package is missing

    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    audio = bytearray()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
    return bytes(audio)


async def _azure(text: str, voice: str, lang: str, rate: str, pitch: str) -> bytes:
    locale = "hi-IN" if lang == "hi" else "en-IN"
    ssml = (
        f"<speak version='1.0' xml:lang='{locale}'><voice name='{voice}'>"
        f"<prosody rate='{rate}' pitch='{pitch}'>{escape(text)}</prosody></voice></speak>"
    )
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            f"https://{settings.azure_speech_region}.tts.speech.microsoft.com/cognitiveservices/v1",
            headers={
                "Ocp-Apim-Subscription-Key": settings.azure_speech_key,
                "Content-Type": "application/ssml+xml",
                "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
                "User-Agent": "liftmate",
            },
            content=ssml.encode("utf-8"),
        )
    if response.status_code != 200:
        raise RuntimeError(f"Azure Speech error {response.status_code}")
    return response.content


@router.post("/tts")
async def speak(body: SpeakRequest, user_id: str = Depends(current_user_id)):
    voice = VOICES[(body.lang, body.gender)]
    rate, pitch = STYLES[body.style]
    text = body.text.strip()
    key = hashlib.sha1(f"{voice}|{rate}|{pitch}|{text}".encode("utf-8")).hexdigest()
    path = CACHE_DIR / f"{key}.mp3"

    if path.exists():
        audio = path.read_bytes()
    else:
        try:
            if settings.azure_speech_key and settings.azure_speech_region:
                audio = await _azure(text, voice, body.lang, rate, pitch)
            else:
                audio = await _edge(text, voice, rate, pitch)
        except Exception as error:  # the web app falls back to the browser voice
            raise HTTPException(status_code=503, detail=f"Voice service unavailable: {error}")
        if not audio:
            raise HTTPException(status_code=503, detail="Voice service returned no audio.")
        path.write_bytes(audio)

    return Response(content=audio, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=86400"})
