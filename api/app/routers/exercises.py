from fastapi import APIRouter, Depends, HTTPException

from app.auth import current_user_id
from app.db import supabase

router = APIRouter(tags=["exercises"])

LIST_FIELDS = "id, slug, name_en, name_hi, family, muscles, equipment, difficulty, image_urls, engine, curated"


@router.get("/exercises")
def list_exercises(
    family: str | None = None,
    q: str = "",
    ai_only: bool = False,
    limit: int = 60,
    user_id: str = Depends(current_user_id),
):
    query = supabase.table("exercises").select(LIST_FIELDS)
    if family:
        query = query.eq("family", family)
    if ai_only:
        query = query.not_.is_("engine", "null")
    if q.strip():
        query = query.ilike("name_en", f"%{q.strip()}%")
    rows = query.order("curated", desc=True).order("name_en").limit(min(limit, 200)).execute().data
    return rows


@router.get("/exercises/{slug}")
def get_exercise(slug: str, user_id: str = Depends(current_user_id)):
    rows = supabase.table("exercises").select("*").eq("slug", slug).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Exercise not found.")
    exercise = rows[0]
    history = (
        supabase.table("sets")
        .select("weight_kg, reps_full, form_score, created_at, sessions!inner(user_id, date)")
        .eq("exercise_id", exercise["id"])
        .eq("sessions.user_id", user_id)
        .order("created_at", desc=True)
        .limit(30)
        .execute()
        .data
    )
    best = None
    for s in history:
        score = (s.get("weight_kg") or 0) * (1 + (s.get("reps_full") or 0) / 30)  # Epley estimate
        if s.get("reps_full") and (best is None or score > best["score"]):
            best = {"weight_kg": s.get("weight_kg"), "reps": s["reps_full"], "score": round(score, 1)}
    exercise["history"] = [
        {"date": s["sessions"]["date"], "weight_kg": s.get("weight_kg"), "reps": s.get("reps_full"), "form_score": s.get("form_score")}
        for s in history
    ]
    exercise["best"] = best
    return exercise
