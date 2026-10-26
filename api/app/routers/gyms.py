from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import current_user_id
from app.db import supabase
from app.logic import get_profile

router = APIRouter(tags=["gyms & people"])

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
# OpenStreetMap asks every app to identify itself. Free, max ~1 request per second.
OSM_HEADERS = {"User-Agent": "Liftmate/1.0 (gym search for a fitness app)"}


@router.get("/gyms/search")
def search_gyms(q: str, user_id: str = Depends(current_user_id)):
    """Search gyms on OpenStreetMap, e.g. 'Gold's Gym Vijay Nagar Indore'."""
    if len(q.strip()) < 3:
        return []
    try:
        response = httpx.get(
            NOMINATIM_URL,
            params={"q": q, "format": "jsonv2", "countrycodes": "in", "limit": 8},
            headers=OSM_HEADERS,
            timeout=15,
        )
        response.raise_for_status()
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail="Map search is busy. Try again in a few seconds.")
    results = []
    for place in response.json():
        display = place.get("display_name", "")
        results.append(
            {
                "osm_id": f"{place.get('osm_type', '')}{place.get('osm_id', '')}",
                "name": place.get("name") or display.split(",")[0],
                "address": display,
                "lat": float(place["lat"]),
                "lng": float(place["lon"]),
            }
        )
    return results


class GymChoice(BaseModel):
    osm_id: str | None = None
    name: str
    address: str | None = None
    lat: float
    lng: float


@router.post("/gyms")
def choose_gym(body: GymChoice, user_id: str = Depends(current_user_id)):
    """Save the chosen gym (shared record) and link it to the user's profile."""
    if body.osm_id:
        gym = supabase.table("gyms").upsert(body.model_dump(), on_conflict="osm_id").execute().data[0]
    else:
        gym = supabase.table("gyms").insert(body.model_dump(exclude={"osm_id"})).execute().data[0]
    supabase.table("profiles").update({"gym_id": gym["id"]}).eq("id", user_id).execute()
    return gym


def _visible_to(viewer: dict, other: dict, connected_ids: set[str]) -> bool:
    visibility = other.get("visibility") or "gym"
    if visibility == "public":
        return True
    if visibility == "gym":
        return bool(viewer.get("gym_id")) and other.get("gym_id") == viewer.get("gym_id")
    return other["id"] in connected_ids


def _connections(user_id: str) -> list[dict]:
    return (
        supabase.table("connections")
        .select("*")
        .or_(f"requester_id.eq.{user_id},receiver_id.eq.{user_id}")
        .execute()
        .data
    )


@router.get("/people")
def search_people(q: str = "", scope: Literal["gym", "all"] = "gym", user_id: str = Depends(current_user_id)):
    """Find people by name; by default only people at your gym."""
    me = get_profile(user_id)
    query = supabase.table("profiles").select("id, name, gym_id, visibility, experience, goal, gyms(name)").neq("id", user_id)
    if scope == "gym":
        if not me.get("gym_id"):
            return []
        query = query.eq("gym_id", me["gym_id"])
    if q.strip():
        query = query.ilike("name", f"%{q.strip()}%")
    people = query.limit(40).execute().data
    links = _connections(user_id)
    status_by_id = {}
    for link in links:
        other = link["receiver_id"] if link["requester_id"] == user_id else link["requester_id"]
        direction = "sent" if link["requester_id"] == user_id else "received"
        status_by_id[other] = link["status"] if link["status"] != "pending" else f"pending_{direction}"
    connected = {pid for pid, status in status_by_id.items() if status == "accepted"}
    return [
        {**person, "connection": status_by_id.get(person["id"], "none")}
        for person in people
        if status_by_id.get(person["id"]) != "blocked" and _visible_to(me, person, connected)
    ]


@router.get("/connections")
def list_connections(user_id: str = Depends(current_user_id)):
    links = _connections(user_id)
    other_ids = [l["receiver_id"] if l["requester_id"] == user_id else l["requester_id"] for l in links]
    names = {}
    if other_ids:
        for p in supabase.table("profiles").select("id, name, gyms(name)").in_("id", other_ids).execute().data:
            names[p["id"]] = p
    result = {"accepted": [], "incoming": [], "outgoing": []}
    for link in links:
        incoming = link["receiver_id"] == user_id
        other = link["requester_id"] if incoming else link["receiver_id"]
        item = {"user_id": other, "profile": names.get(other), "since": link["created_at"]}
        if link["status"] == "accepted":
            result["accepted"].append(item)
        elif link["status"] == "pending":
            result["incoming" if incoming else "outgoing"].append(item)
    return result


class ConnectRequest(BaseModel):
    receiver_id: str


@router.post("/connections")
def send_request(body: ConnectRequest, user_id: str = Depends(current_user_id)):
    if body.receiver_id == user_id:
        raise HTTPException(status_code=400, detail="You can't connect with yourself.")
    existing = [
        l for l in _connections(user_id) if body.receiver_id in (l["requester_id"], l["receiver_id"])
    ]
    if existing:
        return existing[0]
    row = {"requester_id": user_id, "receiver_id": body.receiver_id, "status": "pending"}
    return supabase.table("connections").insert(row).execute().data[0]


class ConnectAnswer(BaseModel):
    requester_id: str
    status: Literal["accepted", "blocked"]


@router.patch("/connections")
def answer_request(body: ConnectAnswer, user_id: str = Depends(current_user_id)):
    updated = (
        supabase.table("connections")
        .update({"status": body.status})
        .eq("requester_id", body.requester_id)
        .eq("receiver_id", user_id)
        .execute()
        .data
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Request not found.")
    return updated[0]


@router.delete("/connections/{other_id}")
def remove_connection(other_id: str, user_id: str = Depends(current_user_id)):
    supabase.table("connections").delete().eq("requester_id", user_id).eq("receiver_id", other_id).execute()
    supabase.table("connections").delete().eq("requester_id", other_id).eq("receiver_id", user_id).execute()
    return {"ok": True}
