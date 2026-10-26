"use client";

import { useState } from "react";
import { api, Profile } from "@/lib/api";
import { ErrorNote, inputClass, labelClass, PrimaryButton, Segmented } from "./ui";

type Draft = Pick<
  Profile,
  "name" | "age" | "sex" | "height_cm" | "weight_kg" | "goal" | "diet_type" | "experience" | "training_days" | "language" | "visibility"
>;

const GOALS = [
  { value: "fat_loss", label: "Fat loss" },
  { value: "muscle_gain", label: "Muscle gain" },
  { value: "recomp", label: "Recomp" },
  { value: "strength", label: "Strength" },
  { value: "endurance", label: "Endurance" },
] as const;

const DIETS = [
  { value: "veg", label: "Veg" },
  { value: "non_veg", label: "Non-veg" },
  { value: "eggetarian", label: "Egg" },
  { value: "vegan", label: "Vegan" },
  { value: "jain", label: "Jain" },
] as const;

export function ProfileForm({ initial, submitLabel, onSaved }: { initial: Profile | null; submitLabel: string; onSaved: () => void }) {
  const [d, setD] = useState<Draft>({
    name: initial?.name ?? "",
    age: initial?.age ?? null,
    sex: initial?.sex ?? "male",
    height_cm: initial?.height_cm ?? null,
    weight_kg: initial?.weight_kg ?? null,
    goal: initial?.goal ?? "muscle_gain",
    diet_type: initial?.diet_type ?? "veg",
    experience: initial?.experience ?? "beginner",
    training_days: initial?.training_days ?? 4,
    language: initial?.language ?? "en",
    visibility: initial?.visibility ?? "gym",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setD((prev) => ({ ...prev, [key]: value }));
  const num = (v: string) => (v === "" ? null : Number(v));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/me", { method: "PUT", body: d });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-5">
      <label className={labelClass}>
        Name (people at your gym search this)
        <input className={inputClass} value={d.name ?? ""} onChange={(e) => set("name", e.target.value)} required />
      </label>
      <div className="grid grid-cols-3 gap-3">
        <label className={labelClass}>
          Age
          <input className={inputClass} type="number" min={16} max={100} value={d.age ?? ""} onChange={(e) => set("age", num(e.target.value))} required />
        </label>
        <label className={labelClass}>
          Height (cm)
          <input className={inputClass} type="number" min={100} max={250} value={d.height_cm ?? ""} onChange={(e) => set("height_cm", num(e.target.value))} required />
        </label>
        <label className={labelClass}>
          Weight (kg)
          <input className={inputClass} type="number" step="0.1" min={30} max={300} value={d.weight_kg ?? ""} onChange={(e) => set("weight_kg", num(e.target.value))} required />
        </label>
      </div>
      <div className={labelClass}>
        Sex (for calorie estimates)
        <Segmented label="Sex" value={d.sex ?? "male"} onChange={(v) => set("sex", v)} options={[{ value: "male", label: "Male" }, { value: "female", label: "Female" }, { value: "other", label: "Other" }]} />
      </div>
      <div className={labelClass}>
        Main goal
        <div className="grid grid-cols-3 gap-2">
          {GOALS.map((g) => (
            <button key={g.value} type="button" aria-pressed={d.goal === g.value} onClick={() => set("goal", g.value)}
              className={`min-h-[48px] rounded-2xl text-sm font-semibold ${d.goal === g.value ? "bg-lime text-ground" : "border border-line bg-surface text-muted"}`}>
              {g.label}
            </button>
          ))}
        </div>
      </div>
      <div className={labelClass}>
        Diet
        <Segmented label="Diet" value={d.diet_type ?? "veg"} onChange={(v) => set("diet_type", v)} options={[...DIETS]} />
      </div>
      <div className={labelClass}>
        Experience
        <Segmented label="Experience" value={d.experience ?? "beginner"} onChange={(v) => set("experience", v)} options={[{ value: "beginner", label: "Beginner" }, { value: "intermediate", label: "Intermediate" }, { value: "advanced", label: "Advanced" }]} />
      </div>
      <div className={labelClass}>
        Training days per week
        <Segmented label="Training days" value={d.training_days ?? 4} onChange={(v) => set("training_days", v)} options={[2, 3, 4, 5, 6].map((n) => ({ value: n, label: String(n) }))} />
      </div>
      <div className={labelClass}>
        Coach language
        <Segmented label="Language" value={d.language} onChange={(v) => set("language", v)} options={[{ value: "en", label: "English" }, { value: "hi", label: "हिंदी / Hinglish" }]} />
      </div>
      <div className={labelClass}>
        Who can find my profile
        <Segmented label="Visibility" value={d.visibility} onChange={(v) => set("visibility", v)} options={[{ value: "public", label: "Everyone" }, { value: "gym", label: "My gym" }, { value: "connections", label: "Connections" }]} />
      </div>
      <ErrorNote message={error} />
      <PrimaryButton type="submit" disabled={busy}>{busy ? "Saving..." : submitLabel}</PrimaryButton>
    </form>
  );
}
