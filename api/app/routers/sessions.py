from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.ai import try_ask_json
from app.auth import current_user_id
from app.db import supabase
from app.logic import (
    SAFETY_RULES,
    get_profile,
    language_rule,
    nutrition_targets,
    recovery_score,
    today_ist,
    user_brief,
    week_sessions,
    week_start,
)

router = APIRouter(tags=["sessions"])

# Rule-based backup plans (used if the AI is unavailable). All slugs are curated exercises.
TEMPLATES = {
    "Push (chest, shoulders, triceps)": {
        "muscles": {"chest", "shoulders", "triceps"},
        "slugs": ["barbell_bench_press_-_medium_grip", "dumbbell_shoulder_press", "leverage_chest_press", "side_lateral_raise", "triceps_pushdown"],
    },
    "Pull (back, biceps)": {
        "muscles": {"lats", "middle back", "biceps"},
        "slugs": ["wide-grip_lat_pulldown", "seated_cable_rows", "bent_over_barbell_row", "dumbbell_bicep_curl", "hammer_curls"],
    },
    "Legs": {
        "muscles": {"quadriceps", "hamstrings", "glutes", "calves"},
        "slugs": ["barbell_squat", "leg_press", "romanian_deadlift", "leg_extensions", "lying_leg_curls"],
    },
}


def _catalogue() -> list[dict]:
    return (
        supabase.table("exercises")
        .select("id, slug, name_en, family, muscles, engine")
        .eq("curated", True)
        .execute()
        .data
    )


def _fallback_plan(user_id: str, minutes: int, catalogue: dict[str, dict]) -> dict:
    trained = set()
    for session in week_sessions(user_id, week_start(today_ist())):
        for s in session.get("sets") or []:
            trained.update((s.get("exercises") or {}).get("muscles") or [])
    title = min(TEMPLATES, key=lambda name: len(TEMPLATES[name]["muscles"] & trained))
    count = 3 if minutes <= 30 else 4 if minutes <= 45 else 5
    exercises = [
        {"slug": slug, "sets": 3, "reps": "8-12", "weight_hint": "a weight you can lift with 2 reps to spare", "rest_sec": 90, "tip": ""}
        for slug in TEMPLATES[title]["slugs"][:count]
        if slug in catalogue
    ]
    return {
        "title": title,
        "reasoning": "Picked the muscle group you have trained least this week.",
        "intensity": "moderate",
        "warmup": "5 minutes light cardio, then 2 light warm-up sets of the first exercise.",
        "exercises": exercises,
    }


class CheckIn(BaseModel):
    session_date: date | None = None
    time: str | None = Field(default=None, max_length=20)
    meals_text: str = Field(default="", max_length=600)
    energy: int = Field(default=3, ge=1, le=5)
    sleep_hours: float = Field(default=7, ge=0, le=16)
    soreness: list[str] = Field(default_factory=list, max_length=8)
    minutes: int = Field(default=60, ge=15, le=180)
    focus: str | None = Field(default=None, max_length=60)


def _attach_names(plan: dict, catalogue: dict[str, dict]) -> dict:
    cleaned = []
    for item in plan.get("exercises") or []:
        exercise = catalogue.get(str(item.get("slug", "")).lower())
        if not exercise:
            continue
        cleaned.append(
            {
                "slug": exercise["slug"],
                "name": exercise["name_en"],
                "engine": exercise.get("engine"),
                "sets": int(item.get("sets") or 3),
                "reps": str(item.get("reps") or "8-12"),
                "weight_hint": str(item.get("weight_hint") or ""),
                "rest_sec": int(item.get("rest_sec") or 90),
                "tip": str(item.get("tip") or ""),
            }
        )
    plan["exercises"] = cleaned
    return plan


@router.post("/sessions")
def start_session(body: CheckIn, user_id: str = Depends(current_user_id)):
    """The New Session check-in: builds today's plan with the AI and saves the session."""
    profile = get_profile(user_id)
    day = body.session_date or today_ist()
    rows = _catalogue()
    catalogue = {row["slug"]: row for row in rows}

    gym_machines = []
    if profile.get("gym_id"):
        gym_machines = [
            row["machines"]["name_en"]
            for row in supabase.table("gym_machines").select("machines(name_en)").eq("gym_id", profile["gym_id"]).execute().data
            if row.get("machines")
        ]

    for part in body.soreness:
        supabase.table("pain_logs").insert(
            {"user_id": user_id, "date": day.isoformat(), "body_part": part, "level": 3, "note": "soreness from check-in"}
        ).execute()

    exercise_list = "\n".join(
        f"- {r['slug']}: {r['name_en']} ({r['family']}; {', '.join(r.get('muscles') or [])})" for r in rows
    )
    system = (
        "You are Liftmate's expert strength and bodybuilding coach. You plan today's gym session for one person, "
        "based on their goal, what they already trained this week, recovery, food and time available. "
        f"{SAFETY_RULES} Keep the plan realistic for the time available (about 8-10 minutes per exercise). "
        "Avoid training a muscle that is sore or was trained hard in the last 48 hours. "
        "Only use exercise slugs from the provided list. Respond with JSON only."
    )
    prompt = f"""USER PROFILE AND HISTORY
{user_brief(user_id, profile)}

TODAY'S CHECK-IN
Date/time: {day.isoformat()} {body.time or ''}
Food eaten so far: {body.meals_text or 'not given'}
Energy (1-5): {body.energy}
Sleep last night: {body.sleep_hours} hours
Sore / painful areas: {', '.join(body.soreness) or 'none'}
Time available: {body.minutes} minutes
Requested focus: {body.focus or 'coach decides'}
Machines known at their gym: {', '.join(gym_machines) or 'unknown - assume a normal commercial gym'}

EXERCISES YOU MAY USE (slug: name)
{exercise_list}

Return JSON:
{{"title": "short session name, e.g. Back + Biceps",
  "reasoning": "1-2 sentences why this plan today (mention week history, recovery, food timing if relevant). {language_rule(profile)}",
  "intensity": "light | moderate | hard",
  "warmup": "one sentence",
  "exercises": [{{"slug": "...", "sets": 3, "reps": "8-10", "weight_hint": "e.g. 'RPE 7' or 'last time +2.5 kg'", "rest_sec": 90, "tip": "one short form tip"}}]}}"""

    plan = try_ask_json(system, prompt, temperature=0.5) or _fallback_plan(user_id, body.minutes, catalogue)
    plan = _attach_names(plan, catalogue)
    if not plan["exercises"]:
        plan = _attach_names(_fallback_plan(user_id, body.minutes, catalogue), catalogue)

    session = {
        "user_id": user_id,
        "date": day.isoformat(),
        "week_start": week_start(day).isoformat(),
        "title": plan.get("title") or "Workout",
        "checkin": body.model_dump(mode="json"),
        "plan": plan,
    }
    return supabase.table("sessions").insert(session).execute().data[0]


class QuickStart(BaseModel):
    title: str = Field(default="Quick workout", max_length=60)


@router.post("/sessions/quick")
def quick_session(body: QuickStart, user_id: str = Depends(current_user_id)):
    """Reuse today's open session, or create an empty one (used when training straight from an exercise)."""
    day = today_ist()
    open_today = (
        supabase.table("sessions")
        .select("*")
        .eq("user_id", user_id)
        .eq("date", day.isoformat())
        .is_("end_time", "null")
        .order("start_time", desc=True)
        .limit(1)
        .execute()
        .data
    )
    if open_today:
        return open_today[0]
    row = {"user_id": user_id, "date": day.isoformat(), "week_start": week_start(day).isoformat(), "title": body.title, "plan": {"exercises": []}}
    return supabase.table("sessions").insert(row).execute().data[0]


def _owned_session(session_id: str, user_id: str) -> dict:
    rows = supabase.table("sessions").select("*").eq("id", session_id).eq("user_id", user_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Session not found.")
    return rows[0]


@router.get("/sessions/{session_id}")
def read_session(session_id: str, user_id: str = Depends(current_user_id)):
    session = _owned_session(session_id, user_id)
    session["sets"] = (
        supabase.table("sets")
        .select("*, exercises(slug, name_en, engine)")
        .eq("session_id", session_id)
        .order("created_at")
        .execute()
        .data
    )
    return session


class SetLog(BaseModel):
    exercise_slug: str
    weight_kg: float | None = Field(default=None, ge=0, le=600)
    reps_full: int = Field(default=0, ge=0, le=200)
    reps_partial: int = Field(default=0, ge=0, le=200)
    reps_bad: int = Field(default=0, ge=0, le=200)
    form_score: int | None = Field(default=None, ge=0, le=100)
    est_rir: int | None = Field(default=None, ge=0, le=10)
    good_points: list[str] = Field(default_factory=list, max_length=5)
    improve_points: list[str] = Field(default_factory=list, max_length=5)
    source: str = "manual"
    hold_seconds: int | None = None


@router.post("/sessions/{session_id}/sets")
def log_set(session_id: str, body: SetLog, user_id: str = Depends(current_user_id)):
    _owned_session(session_id, user_id)
    exercise = supabase.table("exercises").select("id").eq("slug", body.exercise_slug).execute().data
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercise not found.")
    row = body.model_dump(exclude={"exercise_slug", "hold_seconds"})
    if body.hold_seconds is not None:
        row["reps_full"] = body.hold_seconds  # holds store seconds in reps_full
    row.update({"session_id": session_id, "exercise_id": exercise[0]["id"], "source": "ai" if body.source == "ai" else "manual"})
    return supabase.table("sets").insert(row).execute().data[0]


class SetEdit(BaseModel):
    weight_kg: float | None = Field(default=None, ge=0, le=600)
    reps_full: int | None = Field(default=None, ge=0, le=200)
    reps_bad: int | None = Field(default=None, ge=0, le=200)


@router.patch("/sets/{set_id}")
def edit_set(set_id: str, body: SetEdit, user_id: str = Depends(current_user_id)):
    """Fix the counted reps or weight after a set (the camera isn't perfect)."""
    row = supabase.table("sets").select("id, sessions!inner(user_id)").eq("id", set_id).eq("sessions.user_id", user_id).execute().data
    if not row:
        raise HTTPException(status_code=404, detail="Set not found.")
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        return row[0]
    return supabase.table("sets").update(changes).eq("id", set_id).execute().data[0]


@router.delete("/sets/{set_id}")
def delete_set(set_id: str, user_id: str = Depends(current_user_id)):
    row = supabase.table("sets").select("id, sessions!inner(user_id)").eq("id", set_id).eq("sessions.user_id", user_id).execute().data
    if not row:
        raise HTTPException(status_code=404, detail="Set not found.")
    supabase.table("sets").delete().eq("id", set_id).execute()
    return {"ok": True}


@router.post("/sessions/{session_id}/finish")
def finish_session(session_id: str, user_id: str = Depends(current_user_id)):
    _owned_session(session_id, user_id)
    now = datetime.now(timezone.utc).isoformat()
    return supabase.table("sessions").update({"end_time": now}).eq("id", session_id).execute().data[0]


@router.get("/week")
def read_week(start: date | None = None, user_id: str = Depends(current_user_id)):
    """Mon-Sun overview for the week that contains `start` (default: this week)."""
    monday = week_start(start or today_ist())
    sessions = week_sessions(user_id, monday)
    meals = (
        supabase.table("meals")
        .select("date, kcal, protein_g")
        .eq("user_id", user_id)
        .gte("date", monday.isoformat())
        .lte("date", (monday + timedelta(days=6)).isoformat())
        .execute()
        .data
    )
    days = []
    for offset in range(7):
        day = monday + timedelta(days=offset)
        todays = [s for s in sessions if s["date"] == day.isoformat()]
        scores = [st["form_score"] for s in todays for st in s.get("sets") or [] if st.get("form_score") is not None]
        food = [m for m in meals if m["date"] == day.isoformat()]
        days.append(
            {
                "date": day.isoformat(),
                "sessions": [{"id": s["id"], "title": s.get("title")} for s in todays],
                "sets": sum(len(s.get("sets") or []) for s in todays),
                "avg_form": round(sum(scores) / len(scores)) if scores else None,
                "kcal": round(sum(float(m.get("kcal") or 0) for m in food)),
                "protein_g": round(sum(float(m.get("protein_g") or 0) for m in food)),
            }
        )
    return {"week_start": monday.isoformat(), "days": days}


@router.get("/home")
def home(user_id: str = Depends(current_user_id)):
    profile = get_profile(user_id)
    day = today_ist()
    week = read_week(day, user_id)
    today_sessions = (
        supabase.table("sessions")
        .select("id, title, plan, end_time, sets(id)")
        .eq("user_id", user_id)
        .eq("date", day.isoformat())
        .order("start_time", desc=True)
        .execute()
        .data
    )
    today_food = next((d for d in week["days"] if d["date"] == day.isoformat()), {})
    return {
        "name": profile.get("name"),
        "language": profile.get("language"),
        "today": day.isoformat(),
        "week": week,
        "sessions_this_week": sum(1 for d in week["days"] if d["sessions"]),
        "training_days_goal": profile.get("training_days") or 4,
        "today_session": today_sessions[0] if today_sessions else None,
        "recovery": recovery_score(user_id),
        "nutrition": {"kcal": today_food.get("kcal", 0), "protein_g": today_food.get("protein_g", 0), "targets": nutrition_targets(profile)},
    }
