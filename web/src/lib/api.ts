import { supabase } from "./supabase";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

/** Call the FastAPI backend with the logged-in user's token. Throws an Error with a readable message. */
export async function api<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? (options.body ? "POST" : "GET"),
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new Error("Can't reach the Liftmate server. Is the backend running?");
  }
  if (!response.ok) {
    let message = `Something went wrong (${response.status}).`;
    try {
      const err = await response.json();
      if (typeof err.detail === "string") message = err.detail;
      else if (Array.isArray(err.detail)) message = err.detail.map((d: { msg: string }) => d.msg).join(", ");
    } catch {
      /* keep default message */
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export type Profile = {
  id: string;
  name: string | null;
  age: number | null;
  sex: "male" | "female" | "other" | null;
  height_cm: number | null;
  weight_kg: number | null;
  goal: "fat_loss" | "muscle_gain" | "recomp" | "strength" | "endurance" | null;
  diet_type: "veg" | "non_veg" | "eggetarian" | "vegan" | "jain" | null;
  experience: "beginner" | "intermediate" | "advanced" | null;
  training_days: number | null;
  language: "en" | "hi";
  gym_id: string | null;
  visibility: "public" | "gym" | "connections";
  gyms: { id: string; name: string; address: string | null } | null;
  targets: { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
  is_complete: boolean;
};

export type PlanExercise = {
  slug: string;
  name: string;
  engine: string | null;
  sets: number;
  reps: string;
  weight_hint: string;
  rest_sec: number;
  tip: string;
};

export type Session = {
  id: string;
  date: string;
  title: string | null;
  end_time: string | null;
  plan: { title?: string; reasoning?: string; intensity?: string; warmup?: string; exercises?: PlanExercise[] };
  sets?: LoggedSet[];
};

export type LoggedSet = {
  id: string;
  weight_kg: number | null;
  reps_full: number;
  reps_partial: number;
  form_score: number | null;
  est_rir: number | null;
  good_points: string[];
  improve_points: string[];
  source: "ai" | "manual";
  exercises: { slug: string; name_en: string; engine: string | null } | null;
};

export type Exercise = {
  id: string;
  slug: string;
  name_en: string;
  name_hi: string | null;
  family: string;
  muscles: string[];
  secondary_muscles?: string[];
  equipment: string | null;
  difficulty: string | null;
  image_urls: string[];
  instructions?: string[];
  engine: string | null;
  curated: boolean;
  history?: { date: string; weight_kg: number | null; reps: number | null; form_score: number | null }[];
  best?: { weight_kg: number | null; reps: number } | null;
};
