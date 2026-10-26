"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, Exercise } from "@/lib/api";
import { ErrorNote, inputClass, PageHeader, Spinner } from "@/components/ui";

const FAMILIES = [
  { value: "", label: "All" },
  { value: "barbell", label: "Barbell" },
  { value: "dumbbell", label: "Dumbbell" },
  { value: "machine", label: "Machines" },
  { value: "cable", label: "Cables" },
  { value: "bodyweight", label: "Bodyweight" },
];

function Library() {
  const params = useSearchParams();
  const [family, setFamily] = useState("");
  const [query, setQuery] = useState("");
  const [aiOnly, setAiOnly] = useState(params.get("ai") === "1");
  const [items, setItems] = useState<Exercise[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const qs = new URLSearchParams({ limit: "120" });
      if (family) qs.set("family", family);
      if (query.trim()) qs.set("q", query.trim());
      if (aiOnly) qs.set("ai_only", "true");
      api<Exercise[]>(`/exercises?${qs}`).then(setItems).catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(timer);
  }, [family, query, aiOnly]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Exercises" subtitle="Guides, demos and live AI coaching" />
      <label className="sr-only" htmlFor="ex-q">Search exercises</label>
      <input id="ex-q" className={inputClass} placeholder="Search: squat, lat pulldown, curl..." value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="scrollbar-none -mx-5 flex gap-2 overflow-x-auto px-5">
        {FAMILIES.map((f) => (
          <button key={f.value} onClick={() => setFamily(f.value)} aria-pressed={family === f.value}
            className={`min-h-[40px] shrink-0 rounded-xl px-4 text-sm font-semibold ${family === f.value ? "bg-lime text-ground" : "bg-surface text-muted"}`}>
            {f.label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-3 text-sm text-soft">
        <input type="checkbox" checked={aiOnly} onChange={(e) => setAiOnly(e.target.checked)} className="h-5 w-5 accent-[#c6f432]" />
        Only exercises with live AI coach
      </label>
      <ErrorNote message={error} />
      {!items ? <Spinner /> : items.length === 0 ? <p className="text-muted">No exercises found. Did you run the seed script?</p> : (
        <ul className="flex flex-col gap-2">
          {items.map((ex) => (
            <li key={ex.id}>
              <Link href={`/exercises/${ex.slug}`} className="flex items-center gap-3 rounded-2xl bg-surface p-2.5 hover:bg-surface2">
                {ex.image_urls[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ex.image_urls[0]} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-xl bg-surface2 object-cover" />
                ) : <span className="h-14 w-14 shrink-0 rounded-xl bg-surface2" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{ex.name_en}</div>
                  <div className="truncate text-xs text-muted">{ex.name_hi ? `${ex.name_hi} · ` : ""}{ex.muscles.join(", ")}</div>
                </div>
                {ex.engine && <span className="shrink-0 rounded-lg bg-lime px-2 py-1 text-[11px] font-bold text-ground">AI</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ExercisesPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Library />
    </Suspense>
  );
}
