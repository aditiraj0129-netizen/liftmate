from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.ai import try_ask_json
from app.auth import current_user_id
from app.db import supabase
from app.logic import SAFETY_RULES, get_profile, language_rule, save_facts, user_brief

router = APIRouter(tags=["live coach"])


class RepInfo(BaseModel):
    n: int
    score: int
    errors: list[str] = Field(default_factory=list, max_length=6)
    seconds: float | None = None  # time of the lifting part of the rep


class SetState(BaseModel):
    set_number: int = 1
    reps: int = 0
    bad_reps: int = 0
    partial: int = 0
    target_reps: int | None = None
    weight_kg: float | None = None
    form_score: int | None = None
    est_rir: int | None = None
    struggled: bool = False
    cues: list[str] = Field(default_factory=list, max_length=8)
    hold_seconds: int | None = None
    rep_log: list[RepInfo] = Field(default_factory=list, max_length=60)


class CoachTalk(BaseModel):
    exercise_slug: str
    event: Literal["set_start", "set_end", "question"]
    state: SetState = Field(default_factory=SetState)
    text: str | None = Field(default=None, max_length=500)
    coach_gender: Literal["female", "male"] = "female"
    set_id: str | None = None  # the set just saved (so it isn't compared with itself)


FALLBACK = {
    "en": {
        "set_start": "Let's go! Control every rep, I'm watching your form.",
        "set_end": "Good work. Breathe, shake it out, and get ready for the next set.",
        "question": "Sorry, I couldn't answer that right now. Ask me again in a moment.",
    },
    "hi": {
        "set_start": "चलो शुरू करते हैं! हर रेप कंट्रोल में, मेरी नज़र तुम्हारे फॉर्म पर है।",
        "set_end": "बढ़िया काम। गहरी सांस लो और अगले सेट के लिए तैयार हो जाओ।",
        "question": "माफ़ करना, अभी जवाब नहीं मिल पाया। एक बार फिर से पूछो।",
    },
}


def _history(user_id: str, limit: int = 8) -> list[dict]:
    rows = (
        supabase.table("chat_messages")
        .select("role, content")
        .eq("user_id", user_id)
        .eq("channel", "coach")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
        .data
    )
    return list(reversed(rows))


def _previous_set(user_id: str, slug: str, exclude_id: str | None) -> str:
    """The last earlier set of this exercise, to tell the user what improved."""
    rows = (
        supabase.table("sets")
        .select("id, weight_kg, reps_full, reps_bad, reps_partial, form_score, improve_points, created_at, exercises!inner(slug), sessions!inner(user_id, date)")
        .eq("exercises.slug", slug)
        .eq("sessions.user_id", user_id)
        .order("created_at", desc=True)
        .limit(3)
        .execute()
        .data
    )
    for row in rows:
        if row["id"] != exclude_id:
            return (
                f"{row['sessions']['date']}: {row.get('weight_kg') or 'bodyweight'} kg, {row.get('reps_full')} reps "
                f"({row.get('reps_bad') or 0} bad, {row.get('reps_partial') or 0} partial), form score {row.get('form_score')}, "
                f"problems: {', '.join(row.get('improve_points') or []) or 'none'}"
            )
    return "no earlier set of this exercise"


def _rep_table(state: SetState) -> str:
    if not state.rep_log:
        return "not available"
    return "\n".join(
        f"rep {r.n}: score {r.score}{', errors: ' + ', '.join(r.errors) if r.errors else ', clean'}"
        f"{f', lifting took {r.seconds:.1f}s' if r.seconds else ''}"
        for r in state.rep_log
    )


@router.post("/coach/talk")
def coach_talk(body: CoachTalk, user_id: str = Depends(current_user_id)):
    """
    The voice coach's brain. The phone does the fast work (pose, reps, instant cues, motivation shouts)
    and only sends small events here: set start, set end summary, or something the user said.
    """
    profile = get_profile(user_id)
    lang = profile.get("language") or "en"
    exercise = supabase.table("exercises").select("name_en, muscles").eq("slug", body.exercise_slug).execute().data
    exercise_name = exercise[0]["name_en"] if exercise else body.exercise_slug
    state = body.state
    clean = max(0, state.reps - state.bad_reps)

    system = (
        "You are Liftmate, a real, warm, high-energy personal gym coach standing next to the user. "
        "Talk like an experienced human coach having a conversation: specific, encouraging, honest, never robotic. "
        "Use their first name sometimes. Spoken text must have no lists, emojis, markdown or symbols. "
        "When you point out a mistake, ALWAYS explain HOW to fix it with a simple body cue "
        "(for example: 'push your knees out over your toes', 'brace your stomach like someone will punch it'), not just name it. "
        "Never encourage training through pain or broken form. "
        f"You speak as a {body.coach_gender} coach (use matching grammar, e.g. Hindi verb endings). "
        f"{SAFETY_RULES} {language_rule(profile)} Respond with JSON only."
    )

    history = _history(user_id)
    context = f"""ABOUT THE USER
{user_brief(user_id, profile)}

EXERCISE: {exercise_name}
THIS SET: set {state.set_number}; {state.reps} reps counted ({clean} clean, {state.bad_reps} with form errors), {state.partial} half reps,
target {state.target_reps or 'not set'}, weight {state.weight_kg or 'bodyweight/unknown'} kg,
form score {state.form_score if state.form_score is not None else 'n/a'} out of 100,
estimated reps left in reserve {state.est_rir if state.est_rir is not None else 'n/a'}, struggled on a rep: {'yes' if state.struggled else 'no'},
hold time {state.hold_seconds or 0} seconds, form problems seen: {', '.join(state.cues) or 'none'}
REP BY REP:
{_rep_table(state)}
PREVIOUS SET OF THIS EXERCISE: {_previous_set(user_id, body.exercise_slug, body.set_id)}

RECENT CONVERSATION WITH YOU
{chr(10).join(f"{m['role']}: {m['content']}" for m in history) or 'none'}"""

    if body.event == "set_end":
        prompt = f"""{context}

TASK: The user just finished this set. Coach them like a real human coach reviewing the set.
Return JSON:
{{"reply": "what you SAY out loud, 3-5 short natural sentences: react to the set, the best thing, the one fix and how to do it, what to do next set, motivation",
  "feedback": {{
    "how_it_went": "1-2 sentences on how the reps went (consistency, where form slipped, speed and effort)",
    "good": ["specific things done well"],
    "improved": ["what got better compared with the previous set; empty list if nothing to compare"],
    "to_improve": [{{"issue": "the problem", "how_to_fix": "exact simple cue to fix it"}}],
    "next_set": "clear plan: weight (keep/add/reduce and by how much), target reps, one focus cue"
  }},
  "new_facts": ["long-term facts only if new about injuries, pain, preferences or goals; else empty"]}}"""
    elif body.event == "set_start":
        prompt = f"""{context}

TASK: The user is about to start this set. Give one short focus cue for this exercise (based on their last set if available) and a motivating line. Maximum 2 sentences.
Return JSON: {{"reply": "what you say out loud", "new_facts": []}}"""
    else:
        prompt = f"""{context}

TASK: The user said to you (by voice, mid-workout): "{body.text}". Reply naturally and directly like a coach talking back. Maximum 3 sentences.
Return JSON: {{"reply": "what you say out loud", "new_facts": ["new long-term facts about injuries, pain, preferences or goals; else empty"]}}"""

    answer = try_ask_json(system, prompt, temperature=0.8) or {}
    reply = str(answer.get("reply") or FALLBACK.get(lang, FALLBACK["en"])[body.event])
    save_facts(user_id, answer.get("new_facts"))

    rows = []
    if body.event == "question" and body.text:
        rows.append({"user_id": user_id, "channel": "coach", "role": "user", "content": body.text})
    if body.event in ("question", "set_end"):
        rows.append({"user_id": user_id, "channel": "coach", "role": "assistant", "content": reply})
    if rows:
        supabase.table("chat_messages").insert(rows).execute()
    return {"reply": reply, "feedback": answer.get("feedback") if body.event == "set_end" else None, "ai": bool(answer)}
