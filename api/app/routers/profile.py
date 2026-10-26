from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.auth import current_user_id
from app.db import supabase
from app.logic import get_profile, nutrition_targets, today_ist

router = APIRouter(tags=["profile"])


class ProfileUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    age: int | None = Field(default=None, ge=16, le=100)
    sex: Literal["male", "female", "other"] | None = None
    height_cm: float | None = Field(default=None, ge=100, le=250)
    weight_kg: float | None = Field(default=None, ge=30, le=300)
    goal: Literal["fat_loss", "muscle_gain", "recomp", "strength", "endurance"] | None = None
    diet_type: Literal["veg", "non_veg", "eggetarian", "vegan", "jain"] | None = None
    experience: Literal["beginner", "intermediate", "advanced"] | None = None
    training_days: int | None = Field(default=None, ge=1, le=7)
    language: Literal["en", "hi"] | None = None
    gym_id: str | None = None
    visibility: Literal["public", "gym", "connections"] | None = None


@router.get("/me")
def read_me(user_id: str = Depends(current_user_id)):
    profile = get_profile(user_id)
    profile["targets"] = nutrition_targets(profile)
    profile["is_complete"] = bool(profile.get("goal") and profile.get("weight_kg") and profile.get("name"))
    return profile


@router.put("/me")
def update_me(body: ProfileUpdate, user_id: str = Depends(current_user_id)):
    changes = body.model_dump(exclude_none=True)
    if changes:
        supabase.table("profiles").update(changes).eq("id", user_id).execute()
    return read_me(user_id)


class PainLog(BaseModel):
    body_part: str = Field(max_length=40)
    level: int = Field(ge=1, le=10)
    note: str | None = Field(default=None, max_length=300)


@router.post("/pain")
def log_pain(body: PainLog, user_id: str = Depends(current_user_id)):
    row = {"user_id": user_id, "date": today_ist().isoformat(), **body.model_dump()}
    return supabase.table("pain_logs").insert(row).execute().data[0]
