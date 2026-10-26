from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.ai import ask_json, provider_status
from app.config import settings
from app.routers import coach, exercises, gyms, machines, nutrition, profile, sessions, tts

app = FastAPI(
    title="Liftmate API",
    version="1.0.0",
    description="Backend for Liftmate: planner, live coach brain, nutritionist, machine guide, gym community.",
)

# Allow the web app to call this backend from the browser.
allowed = {settings.frontend_url.rstrip("/"), "http://localhost:3000", "http://127.0.0.1:3000"}
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(allowed),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    """Quick check that the server is running."""
    status = provider_status()
    return {"status": "ok", "app": "liftmate", "ai_configured": any(status.values()), "ai_keys": status}


@app.get("/health/ai")
def health_ai():
    """Open this in the browser to test your AI key with a tiny real request."""
    try:
        answer = ask_json("You are a test. Reply with JSON only.", 'Return {"ok": true}', temperature=0)
        return {"ai_working": bool(answer.get("ok")), "keys": provider_status()}
    except Exception as error:  # show the reason in plain words
        return {"ai_working": False, "keys": provider_status(), "problem": getattr(error, "detail", str(error))}


for module in (profile, gyms, exercises, sessions, coach, nutrition, machines, tts):
    app.include_router(module.router)
