import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.ai import ask_json
from app.auth import current_user_id
from app.db import supabase
from app.logic import SAFETY_RULES, get_profile

router = APIRouter(tags=["machine guide"])


class ScanRequest(BaseModel):
    image_b64: str = Field(max_length=8_000_000)  # the web app shrinks photos to about 1024 px first
    mime: str = "image/jpeg"


@router.post("/machines/scan")
def scan_machine(body: ScanRequest, user_id: str = Depends(current_user_id)):
    """Identify a gym machine from a photo (machine or its instruction sticker) and build a simple guide."""
    profile = get_profile(user_id)
    curated = supabase.table("exercises").select("slug, name_en, engine").eq("curated", True).execute().data
    options = "\n".join(f"- {e['slug']}: {e['name_en']}" for e in curated)

    system = (
        "You are an expert gym trainer who knows every commercial gym machine (Life Fitness, Technogym, Hammer Strength, "
        "Indian brands like Energie, Viva, Cosco and unbranded local machines). From a photo of a machine or its printed "
        "instruction sticker, identify the machine and explain how to use it to a complete beginner in very simple words. "
        "If sticker text is visible, read it (even if faded) and use it. "
        f"{SAFETY_RULES} Respond with JSON only."
    )
    prompt = f"""Look at this photo from a gym.
User: height {profile.get('height_cm') or 'unknown'} cm, experience {profile.get('experience') or 'beginner'}.

Exercises that our live AI coach supports (pick the best match for this machine, or null):
{options}

Return JSON:
{{"is_gym_machine": true,
 "machine_type": "snake_case_generic_type, e.g. seated_leg_press, lat_pulldown, pec_deck, chest_press, leg_extension, smith_machine",
 "name_en": "Seated Leg Press", "name_hi": "सीटेड लेग प्रेस",
 "confidence": 0.0,
 "muscles": ["quadriceps", "glutes"],
 "sticker_text": "text read from the sticker, or empty",
 "exercise_slug": "matching slug from the list or null",
 "guide": {{
   "en": {{"setup": ["seat/pad/pin setup steps"], "steps": ["how to do one rep"], "mistakes": ["top 3 mistakes"], "safety": ["safety points"]}},
   "hi": {{"setup": [], "steps": [], "mistakes": [], "safety": []}}
 }}}}
Write "hi" in simple Hindi (Devanagari). Keep every line short."""

    result = ask_json(system, prompt, image_b64=body.image_b64, mime=body.mime, temperature=0.2)
    if not result.get("is_gym_machine", True):
        raise HTTPException(status_code=422, detail="That doesn't look like a gym machine. Try a clearer photo of the machine or its sticker.")

    machine_type = re.sub(r"[^a-z0-9_]", "", str(result.get("machine_type") or "unknown_machine").lower())[:60]
    slug = result.get("exercise_slug")
    exercise = next((e for e in curated if e["slug"] == slug), None)
    machine = (
        supabase.table("machines")
        .upsert(
            {
                "type": machine_type,
                "name_en": result.get("name_en") or machine_type.replace("_", " ").title(),
                "name_hi": result.get("name_hi"),
                "muscles": result.get("muscles") or [],
                "guide": result.get("guide") or {},
                "exercise_slug": exercise["slug"] if exercise else None,
            },
            on_conflict="type",
        )
        .execute()
        .data[0]
    )

    users_count = None
    if profile.get("gym_id"):
        existing = (
            supabase.table("gym_machines").select("id, verified_count")
            .eq("gym_id", profile["gym_id"]).eq("machine_id", machine["id"]).execute().data
        )
        if existing:
            users_count = (existing[0].get("verified_count") or 1) + 1
            supabase.table("gym_machines").update({"verified_count": users_count}).eq("id", existing[0]["id"]).execute()
        else:
            users_count = 1
            supabase.table("gym_machines").insert(
                {
                    "gym_id": profile["gym_id"],
                    "machine_id": machine["id"],
                    "sticker_text": result.get("sticker_text") or None,
                    "guide": result.get("guide") or {},
                    "added_by": user_id,
                }
            ).execute()

    return {
        "machine": machine,
        "confidence": result.get("confidence"),
        "sticker_text": result.get("sticker_text"),
        "guide": result.get("guide") or {},
        "exercise": exercise,
        "saved_to_gym": bool(profile.get("gym_id")),
        "scans_at_gym": users_count,
    }


@router.get("/machines/my-gym")
def my_gym_machines(user_id: str = Depends(current_user_id)):
    profile = get_profile(user_id)
    if not profile.get("gym_id"):
        return []
    rows = (
        supabase.table("gym_machines")
        .select("id, verified_count, guide, sticker_text, machines(*)")
        .eq("gym_id", profile["gym_id"])
        .order("created_at", desc=True)
        .execute()
        .data
    )
    slugs = [r["machines"]["exercise_slug"] for r in rows if r.get("machines") and r["machines"].get("exercise_slug")]
    engines = {}
    if slugs:
        engines = {e["slug"]: e for e in supabase.table("exercises").select("slug, name_en, engine").in_("slug", slugs).execute().data}
    for r in rows:
        slug = (r.get("machines") or {}).get("exercise_slug")
        r["exercise"] = engines.get(slug)
    return rows
