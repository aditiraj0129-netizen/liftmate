"""
Fill the `exercises` table.

Source: free-exercise-db (public domain, https://github.com/yuhonas/free-exercise-db).
On top of it we mark ~37 popular exercises as "curated": they get a Hindi name and
an AI coach engine, so the Live Coach can count reps and check form for them.

Run from the `api` folder (with the virtual environment active):
    python -m scripts.seed_exercises
It is safe to run again; existing exercises are updated, not duplicated.
"""

import httpx

from app.db import supabase

DATA_URL = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json"
IMAGE_BASE = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/"

# dataset id -> (Hindi name, AI engine or None)
CURATED: dict[str, tuple[str, str | None]] = {
    "Barbell_Squat": ("बारबेल स्क्वाट", "squat"),
    "Bodyweight_Squat": ("बॉडीवेट स्क्वाट", "squat"),
    "Goblet_Squat": ("गॉब्लेट स्क्वाट", "squat"),
    "Smith_Machine_Squat": ("स्मिथ मशीन स्क्वाट", "squat"),
    "Hack_Squat": ("हैक स्क्वाट", "squat"),
    "Pushups": ("पुश-अप", "pushup"),
    "Dumbbell_Bicep_Curl": ("डंबल बाइसेप कर्ल", "curl"),
    "Hammer_Curls": ("हैमर कर्ल", "curl"),
    "Machine_Bicep_Curl": ("मशीन बाइसेप कर्ल", "curl"),
    "Dumbbell_Shoulder_Press": ("डंबल शोल्डर प्रेस", "press_overhead"),
    "Standing_Military_Press": ("मिलिट्री प्रेस", "press_overhead"),
    "Leverage_Shoulder_Press": ("मशीन शोल्डर प्रेस", "press_overhead"),
    "Wide-Grip_Lat_Pulldown": ("लैट पुलडाउन", "pulldown"),
    "Close-Grip_Front_Lat_Pulldown": ("क्लोज़-ग्रिप लैट पुलडाउन", "pulldown"),
    "Pullups": ("पुल-अप", "pulldown"),
    "Leg_Press": ("लेग प्रेस", "leg_press"),
    "Dumbbell_Lunges": ("डंबल लंज", "lunge"),
    "Barbell_Deadlift": ("बारबेल डेडलिफ्ट", "hinge"),
    "Romanian_Deadlift": ("रोमानियन डेडलिफ्ट", "hinge"),
    "Side_Lateral_Raise": ("लेटरल रेज़", "lateral_raise"),
    "Barbell_Bench_Press_-_Medium_Grip": ("बेंच प्रेस", "bench"),
    "Leverage_Chest_Press": ("मशीन चेस्ट प्रेस", "bench"),
    "Dips_-_Triceps_Version": ("डिप्स", "bench"),
    "Triceps_Pushdown": ("ट्राइसेप्स पुशडाउन", "pushdown"),
    "Triceps_Pushdown_-_Rope_Attachment": ("रोप पुशडाउन", "pushdown"),
    "Bent_Over_Barbell_Row": ("बेंट-ओवर बारबेल रो", "row_bent"),
    "Seated_Cable_Rows": ("सीटेड केबल रो", "row_seated"),
    "Plank": ("प्लैंक", "plank"),
    "Leg_Extensions": ("लेग एक्सटेंशन", "leg_extension"),
    "Lying_Leg_Curls": ("लाइंग लेग कर्ल", "leg_curl"),
    "Seated_Leg_Curl": ("सीटेड लेग कर्ल", "leg_curl"),
    "Barbell_Hip_Thrust": ("हिप थ्रस्ट", None),
    "Butterfly": ("पेक डेक", None),
    "Cable_Crossover": ("केबल क्रॉसओवर", None),
    "Face_Pull": ("फेस पुल", None),
    "Seated_Calf_Raise": ("सीटेड काफ रेज़", None),
    "Barbell_Shoulder_Press": ("बारबेल शोल्डर प्रेस", "press_overhead"),
}

KEEP_CATEGORIES = {"strength", "powerlifting"}
FAMILY_BY_EQUIPMENT = {
    "barbell": "barbell",
    "e-z curl bar": "barbell",
    "dumbbell": "dumbbell",
    "kettlebells": "dumbbell",
    "cable": "cable",
    "machine": "machine",
    "body only": "bodyweight",
}


def to_row(item: dict) -> dict | None:
    curated = CURATED.get(item["id"])
    family = FAMILY_BY_EQUIPMENT.get(item.get("equipment") or "")
    if item["id"] == "Plank":
        family = "hold"
    if not curated and (item.get("category") not in KEEP_CATEGORIES or family is None):
        return None
    if family is None:
        family = "bodyweight"
    return {
        "slug": item["id"].lower(),
        "name_en": item["name"],
        "name_hi": curated[0] if curated else None,
        "family": family,
        "muscles": item.get("primaryMuscles") or [],
        "secondary_muscles": item.get("secondaryMuscles") or [],
        "equipment": item.get("equipment"),
        "difficulty": item.get("level"),
        "image_urls": [IMAGE_BASE + path for path in item.get("images") or []],
        "instructions": item.get("instructions") or [],
        "engine": curated[1] if curated else None,
        "curated": bool(curated),
    }


def main() -> None:
    print("Downloading exercise data...")
    data = httpx.get(DATA_URL, timeout=60).json()
    rows = [row for row in (to_row(item) for item in data) if row]
    print(f"Saving {len(rows)} exercises ({sum(r['curated'] for r in rows)} curated)...")
    for start in range(0, len(rows), 200):
        supabase.table("exercises").upsert(rows[start:start + 200], on_conflict="slug").execute()
    print("Done.")


if __name__ == "__main__":
    main()
