"""
Shared helpers: dates, nutrition targets, recovery score and the "user brief"
that every AI agent reads so its advice is personal, not generic.
"""

from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException

from app.db import supabase

IST = timezone(timedelta(hours=5, minutes=30))

GOAL_LABELS = {
    "fat_loss": "fat loss",
    "muscle_gain": "muscle gain",
    "recomp": "body recomposition",
    "strength": "strength",
    "endurance": "endurance",
}

SAFETY_RULES = (
    "Safety rules: give general fitness and nutrition guidance only, never a medical diagnosis. "
    "Never encourage training through pain. For sharp pain, numbness, tingling, swelling, chest pain, "
    "dizziness or pain lasting more than a few days, clearly tell the user to see a doctor or physiotherapist. "
    "Never suggest starving, crash diets, or skipping meals as punishment."
)


def today_ist() -> date:
    return datetime.now(IST).date()


def week_start(day: date) -> date:
    """Weeks run Monday to Sunday."""
    return day - timedelta(days=day.weekday())


def get_profile(user_id: str) -> dict:
    rows = supabase.table("profiles").select("*, gyms(*)").eq("id", user_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Profile not found.")
    return rows[0]


def language_rule(profile: dict) -> str:
    """Hindi answers are written in Devanagari so the Hindi voice reads them clearly and naturally."""
    if profile.get("language") == "hi":
        return (
            "Reply in natural, spoken, friendly Hindi written ONLY in Devanagari script (no Roman letters). "
            "Use everyday Hindi like a real Indian gym coach talks. Common English gym and food words are fine, "
            "but write them in Devanagari (for example: सेट, रेप्स, प्रोटीन, कैलोरी, फॉर्म, स्क्वाट). "
            "Write numbers as digits. Use 'तुम'."
        )
    return "Reply in simple, friendly Indian English. If the user writes in Hindi, reply in Hindi written in Devanagari."


def nutrition_targets(profile: dict) -> dict:
    """Mifflin-St Jeor estimate + goal adjustment. A starting point, refined over time."""
    weight = float(profile.get("weight_kg") or 70)
    height = float(profile.get("height_cm") or 170)
    age = int(profile.get("age") or 25)
    sex = profile.get("sex") or "male"
    bmr = 10 * weight + 6.25 * height - 5 * age + (5 if sex == "male" else -161)
    days = int(profile.get("training_days") or 4)
    activity = 1.375 if days <= 2 else 1.55 if days <= 4 else 1.65
    tdee = bmr * activity
    goal = profile.get("goal") or "recomp"
    kcal = tdee + {"fat_loss": -400, "muscle_gain": 250, "strength": 150}.get(goal, 0)
    protein_per_kg = {"fat_loss": 2.0, "muscle_gain": 1.8, "strength": 1.8, "recomp": 2.0}.get(goal, 1.6)
    protein = weight * protein_per_kg
    fat = kcal * 0.25 / 9
    carbs = max(0.0, (kcal - protein * 4 - fat * 9) / 4)
    return {
        "kcal": round(kcal / 10) * 10,
        "protein_g": round(protein),
        "carbs_g": round(carbs),
        "fat_g": round(fat),
    }


def week_sessions(user_id: str, start: date) -> list[dict]:
    return (
        supabase.table("sessions")
        .select("id, date, title, checkin, end_time, sets(id, reps_full, form_score, exercises(name_en, muscles))")
        .eq("user_id", user_id)
        .eq("week_start", start.isoformat())
        .order("date")
        .execute()
        .data
    )


def recovery_score(user_id: str) -> int:
    """Simple 0-100 score from the latest check-in (sleep, energy, soreness) and recent training volume."""
    recent = (
        supabase.table("sessions")
        .select("date, checkin, sets(id)")
        .eq("user_id", user_id)
        .gte("date", (today_ist() - timedelta(days=3)).isoformat())
        .order("date", desc=True)
        .execute()
        .data
    )
    score = 75.0
    if recent:
        checkin = recent[0].get("checkin") or {}
        sleep = float(checkin.get("sleep_hours") or 7)
        energy = int(checkin.get("energy") or 3)
        soreness = len(checkin.get("soreness") or [])
        score = 50 + min(sleep, 9) * 4 + (energy - 3) * 6 - soreness * 5
        sets_last_3_days = sum(len(s.get("sets") or []) for s in recent)
        score -= max(0, sets_last_3_days - 40) * 0.5
    return int(max(20, min(98, score)))


def recent_memories(user_id: str, limit: int = 15) -> list[str]:
    rows = (
        supabase.table("memories")
        .select("text")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
        .data
    )
    return [row["text"] for row in rows]


def save_facts(user_id: str, facts: list | None) -> None:
    """Store new long-term facts the AI noticed (e.g. 'dislikes oats'). Skips duplicates."""
    if not facts:
        return
    known = {text.lower() for text in recent_memories(user_id, 50)}
    new_rows = [
        {"user_id": user_id, "text": str(fact)[:300]}
        for fact in facts[:3]
        if str(fact).strip() and str(fact).lower() not in known
    ]
    if new_rows:
        supabase.table("memories").insert(new_rows).execute()


def user_brief(user_id: str, profile: dict | None = None) -> str:
    """A short text summary of the user that is added to every AI prompt."""
    profile = profile or get_profile(user_id)
    start = week_start(today_ist())
    sessions = week_sessions(user_id, start)
    training_lines = []
    for session in sessions:
        muscles = sorted({m for s in session.get("sets") or [] for m in (s.get("exercises") or {}).get("muscles") or []})
        training_lines.append(
            f"- {session['date']}: {session.get('title') or 'Workout'} "
            f"({len(session.get('sets') or [])} sets; muscles: {', '.join(muscles) or 'not logged'})"
        )
    pains = (
        supabase.table("pain_logs")
        .select("date, body_part, level, note")
        .eq("user_id", user_id)
        .gte("date", (today_ist() - timedelta(days=14)).isoformat())
        .execute()
        .data
    )
    gym = profile.get("gyms") or {}
    lines = [
        f"Name: {profile.get('name') or 'User'}",
        f"Age: {profile.get('age')}, sex: {profile.get('sex')}, height: {profile.get('height_cm')} cm, weight: {profile.get('weight_kg')} kg",
        f"Goal: {GOAL_LABELS.get(profile.get('goal') or '', 'general fitness')}",
        f"Diet: {profile.get('diet_type') or 'not set'}",
        f"Experience: {profile.get('experience') or 'beginner'}, plans to train {profile.get('training_days') or 4} days a week",
        f"Gym: {gym.get('name') or 'not set'}",
        f"Today: {today_ist().strftime('%A %d %B %Y')}",
        "Training this week (Mon-Sun):",
        *(training_lines or ["- nothing logged yet"]),
        "Pain/soreness in last 14 days: "
        + ("; ".join(f"{p['date']} {p['body_part']} {p.get('level') or ''}/10 {p.get('note') or ''}" for p in pains) or "none"),
        "Things the user told us before:",
        *([f"- {m}" for m in recent_memories(user_id)] or ["- nothing yet"]),
    ]
    return "\n".join(lines)
