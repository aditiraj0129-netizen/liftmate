from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.ai import ask_json
from app.auth import current_user_id
from app.db import supabase
from app.logic import (
    SAFETY_RULES,
    get_profile,
    language_rule,
    nutrition_targets,
    save_facts,
    today_ist,
    user_brief,
    week_start,
)

router = APIRouter(tags=["nutrition"])

DIET_RULES = {
    "veg": "Vegetarian: no meat, fish or eggs. Dairy is fine.",
    "non_veg": "Non-vegetarian: chicken, fish, eggs, meat all fine.",
    "eggetarian": "Eggetarian: eggs and dairy fine, no meat or fish.",
    "vegan": "Vegan: no meat, fish, eggs, dairy or honey.",
    "jain": "Jain: vegetarian, no eggs, no root vegetables (onion, garlic, potato, carrot, beetroot).",
}


def _today_meals(user_id: str) -> list[dict]:
    return (
        supabase.table("meals")
        .select("*")
        .eq("user_id", user_id)
        .eq("date", today_ist().isoformat())
        .order("eaten_at")
        .execute()
        .data
    )


def _totals(meals: list[dict]) -> dict:
    keys = ["kcal", "protein_g", "carbs_g", "fat_g"]
    return {k: round(sum(float(m.get(k) or 0) for m in meals)) for k in keys}


@router.get("/nutrition/today")
def nutrition_today(user_id: str = Depends(current_user_id)):
    profile = get_profile(user_id)
    targets = nutrition_targets(profile)
    meals = _today_meals(user_id)
    totals = _totals(meals)
    return {
        "targets": targets,
        "totals": totals,
        "remaining": {k: targets[k] - totals[k] for k in targets},
        "meals": meals,
        "diet_type": profile.get("diet_type"),
    }


class MealLog(BaseModel):
    text: str = Field(min_length=2, max_length=600)
    source: Literal["voice", "photo", "text"] = "text"


@router.post("/nutrition/log")
def log_meal(body: MealLog, user_id: str = Depends(current_user_id)):
    """Turn 'two aloo parathas with butter and a lassi' into foods with calories and macros."""
    system = (
        "You are a nutrition database expert for Indian food (home-style dishes, street food, restaurant food, "
        "packaged foods) and global foods. Estimate realistic portions as typically served in India when the "
        "user does not give amounts (1 roti ~ 30 g flour, 1 katori dal ~ 150 ml, etc.). Respond with JSON only."
    )
    prompt = f"""Food eaten: "{body.text}"
Return JSON: {{"items": [{{"name": "Aloo paratha with butter", "quantity": "2 pieces", "kcal": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0}}],
"note": "one short line if anything was guessed, else empty"}}"""
    parsed = ask_json(system, prompt, temperature=0.2)
    items = parsed.get("items") or []
    if not items:
        raise HTTPException(status_code=422, detail="Couldn't understand that food. Try adding quantities.")
    totals = {k: round(sum(float(i.get(k) or 0) for i in items), 1) for k in ["kcal", "protein_g", "carbs_g", "fat_g"]}
    row = {
        "user_id": user_id,
        "date": today_ist().isoformat(),
        "description": body.text,
        "items": items,
        "source": body.source,
        **totals,
    }
    meal = supabase.table("meals").insert(row).execute().data[0]
    meal["note"] = parsed.get("note") or ""
    return meal


@router.delete("/nutrition/meals/{meal_id}")
def delete_meal(meal_id: str, user_id: str = Depends(current_user_id)):
    supabase.table("meals").delete().eq("id", meal_id).eq("user_id", user_id).execute()
    return {"ok": True}


class ChatMessage(BaseModel):
    message: str = Field(min_length=1, max_length=1000)


@router.get("/nutrition/chat")
def chat_history(user_id: str = Depends(current_user_id)):
    rows = (
        supabase.table("chat_messages")
        .select("role, content, created_at")
        .eq("user_id", user_id)
        .eq("channel", "nutrition")
        .order("created_at", desc=True)
        .limit(40)
        .execute()
        .data
    )
    return list(reversed(rows))


@router.post("/nutrition/chat")
def chat(body: ChatMessage, user_id: str = Depends(current_user_id)):
    """
    The live AI nutritionist + recovery advisor. Knows today's food, today's training,
    the user's goal, diet type and history, so the advice is personal.
    """
    profile = get_profile(user_id)
    today = nutrition_today(user_id)
    todays_sessions = (
        supabase.table("sessions")
        .select("title, start_time, end_time, plan")
        .eq("user_id", user_id)
        .eq("date", today_ist().isoformat())
        .execute()
        .data
    )
    history = chat_history(user_id)[-10:]
    meals_text = "\n".join(
        f"- {m['eaten_at'][11:16]} UTC: {m.get('description')} ({round(float(m.get('kcal') or 0))} kcal, {round(float(m.get('protein_g') or 0))} g protein)"
        for m in today["meals"]
    ) or "- nothing logged yet"

    system = (
        "You are Liftmate's expert sports nutritionist and recovery advisor for gym-goers in India. "
        "You help with: balancing the rest of the day after a heavy or wrong meal, meal timing around training "
        "(how long to wait after eating, pre/post workout food), hitting protein with foods the user actually eats, "
        "spreading a small correction over the next 2-3 days (never starvation), supplements basics at a general level, "
        "and gym-related aches, soreness and minor injuries linked to their training. "
        f"{SAFETY_RULES} {language_rule(profile)} "
        f"Diet rule you must follow: {DIET_RULES.get(profile.get('diet_type') or '', 'Ask the user their diet type if relevant.')} "
        "Give practical, specific answers with real Indian foods and quantities. Keep it short: 2-6 sentences or a few short lines. "
        "Respond with JSON only."
    )
    prompt = f"""ABOUT THE USER
{user_brief(user_id, profile)}

TODAY'S NUTRITION
Targets: {today['targets']}
Eaten so far: {today['totals']}
Remaining: {today['remaining']}
Meals today:
{meals_text}

TODAY'S TRAINING
{todays_sessions or 'No session started yet today.'}

RECENT CHAT
{chr(10).join(f"{m['role']}: {m['content']}" for m in history) or 'none'}

USER NOW SAYS: "{body.message}"

Return JSON: {{"reply": "your answer", "new_facts": ["new long-term facts about the user worth remembering (food dislikes, allergies they mention, injuries, schedule); else empty"]}}"""

    answer = ask_json(system, prompt, temperature=0.6)
    reply = str(answer.get("reply") or "Sorry, I couldn't answer that. Please try again.")
    save_facts(user_id, answer.get("new_facts"))
    supabase.table("chat_messages").insert(
        [
            {"user_id": user_id, "channel": "nutrition", "role": "user", "content": body.message},
            {"user_id": user_id, "channel": "nutrition", "role": "assistant", "content": reply},
        ]
    ).execute()
    return {"reply": reply}


@router.get("/nutrition/plan")
def read_plan(user_id: str = Depends(current_user_id)):
    monday = week_start(today_ist()).isoformat()
    rows = supabase.table("nutrition_plans").select("*").eq("user_id", user_id).eq("week_start", monday).execute().data
    return rows[0] if rows else None


class PlanRequest(BaseModel):
    budget: Literal["low", "medium", "high"] = "medium"
    region: str = Field(default="North Indian", max_length=40)
    dislikes: str = Field(default="", max_length=200)


@router.post("/nutrition/plan")
def make_plan(body: PlanRequest, user_id: str = Depends(current_user_id)):
    """Build this week's (Mon-Sun) advised meal plan."""
    profile = get_profile(user_id)
    targets = nutrition_targets(profile)
    days = int(profile.get("training_days") or 4)
    system = (
        "You are an expert Indian sports nutritionist. Build a practical 7-day meal plan with real, affordable, "
        "home-cookable Indian foods and exact household quantities (katori, roti count, grams). "
        "Training days get more carbs around the workout; rest days slightly fewer carbs. "
        f"Diet rule you must follow: {DIET_RULES.get(profile.get('diet_type') or '', 'balanced diet')} "
        f"{SAFETY_RULES} Respond with JSON only."
    )
    prompt = f"""ABOUT THE USER
{user_brief(user_id, profile)}

Daily targets (training days): {targets}
Training days per week: {days} (spread them Mon-Sat sensibly)
Budget: {body.budget}. Food style: {body.region}. Dislikes: {body.dislikes or 'none'}.

Return JSON:
{{"days": [{{"day": "Monday", "training_day": true, "kcal": 0, "protein_g": 0,
  "meals": [{{"time": "8:00 AM", "name": "Breakfast", "items": "2 besan chilla + 1 katori curd", "kcal": 0, "protein_g": 0}}]}}],
 "grocery_list": ["item with weekly quantity"],
 "tips": ["3 short tips for this user"]}}
Give all 7 days, Monday first, 4-6 meals per day."""
    plan = ask_json(system, prompt, temperature=0.5)
    row = {"user_id": user_id, "week_start": week_start(today_ist()).isoformat(), "targets": targets, "plan": plan}
    return supabase.table("nutrition_plans").upsert(row, on_conflict="user_id,week_start").execute().data[0]
