"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, LoggedSet, PlanExercise, Session } from "@/lib/api";
import { Card, ErrorNote, GhostButton, inputClass, PageHeader, PrimaryButton, SectionLabel, Spinner } from "@/components/ui";
import { IconBody, IconCheck, IconTrash } from "@/components/icons";

function ManualLog({ sessionId, exercise, onSaved }: { sessionId: string; exercise: PlanExercise; onSaved: () => void }) {
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api(`/sessions/${sessionId}/sets`, {
            body: { exercise_slug: exercise.slug, weight_kg: weight ? Number(weight) : null, reps_full: Number(reps) || 0, source: "manual" },
          });
          setReps("");
          onSaved();
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="sr-only" htmlFor={`w-${exercise.slug}`}>Weight in kg</label>
      <input id={`w-${exercise.slug}`} className={`${inputClass} !h-11`} inputMode="decimal" placeholder="kg" value={weight} onChange={(e) => setWeight(e.target.value)} />
      <label className="sr-only" htmlFor={`r-${exercise.slug}`}>Reps</label>
      <input id={`r-${exercise.slug}`} className={`${inputClass} !h-11`} inputMode="numeric" placeholder="reps" value={reps} onChange={(e) => setReps(e.target.value)} required />
      <GhostButton type="submit" disabled={busy} className="!min-h-[44px] shrink-0">Log</GhostButton>
    </form>
  );
}

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Session>(`/sessions/${id}`).then(setSession).catch((e) => setError(e.message));
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  if (error) return <div className="pt-8"><ErrorNote message={error} /></div>;
  if (!session) return <Spinner />;

  const plan = session.plan ?? {};
  const sets = session.sets ?? [];
  const setsFor = (slug: string) => sets.filter((s) => s.exercises?.slug === slug);
  const extra = sets.filter((s) => !(plan.exercises ?? []).some((ex) => ex.slug === s.exercises?.slug));

  async function remove(set: LoggedSet) {
    await api(`/sets/${set.id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={session.title ?? "Workout"} subtitle={new Date(session.date + "T00:00:00").toDateString()} back="/" />

      {plan.reasoning && (
        <Card className="flex gap-3">
          <span className="mt-0.5 h-7 w-7 shrink-0 rounded-full bg-lime" aria-hidden="true" />
          <div className="flex flex-col gap-1 text-sm">
            <p className="leading-relaxed text-soft">{plan.reasoning}</p>
            {plan.warmup && <p className="text-muted">Warm-up: {plan.warmup}</p>}
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        <SectionLabel>Exercises</SectionLabel>
        {(plan.exercises ?? []).map((ex) => {
          const done = setsFor(ex.slug);
          const finished = done.length >= ex.sets;
          const coachHref = `/coach?slug=${ex.slug}&session=${session.id}&reps=${encodeURIComponent(ex.reps)}&rest=${ex.rest_sec}&sets=${ex.sets}`;
          return (
            <Card key={ex.slug} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/exercises/${ex.slug}`} className="font-semibold hover:text-lime">{ex.name}</Link>
                  <p className="text-sm text-muted">
                    {ex.sets} × {ex.reps} {ex.weight_hint && `· ${ex.weight_hint}`} · rest {ex.rest_sec}s
                  </p>
                  {ex.tip && <p className="mt-1 text-xs text-soft">{ex.tip}</p>}
                </div>
                <span className={`flex shrink-0 items-center gap-1 rounded-xl px-2 py-1 text-xs font-semibold ${finished ? "bg-lime text-ground" : "bg-surface2 text-muted"}`}>
                  {finished && <IconCheck className="h-3.5 w-3.5" />} {done.length}/{ex.sets}
                </span>
              </div>
              {done.length > 0 && (
                <ul className="flex flex-col gap-1 text-sm">
                  {done.map((s, i) => (
                    <li key={s.id} className="flex items-center justify-between rounded-xl bg-surface2 px-3 py-2">
                      <span>Set {i + 1}: {s.weight_kg ?? "BW"} kg × {s.reps_full}{s.reps_partial ? ` (+${s.reps_partial} partial)` : ""}</span>
                      <span className="flex items-center gap-2 text-muted">
                        {s.form_score !== null && <span className="text-lime">{s.form_score}</span>}
                        <button aria-label="Delete set" onClick={() => remove(s)} className="flex h-8 w-8 items-center justify-center rounded-lg hover:text-amber"><IconTrash className="h-4 w-4" /></button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                {ex.engine ? (
                  <Link href={coachHref} className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-2xl bg-lime text-sm font-bold text-ground">
                    <IconBody /> Train with AI
                  </Link>
                ) : (
                  <span className="flex flex-1 items-center text-xs text-muted">AI rep counting not available for this one yet.</span>
                )}
                <GhostButton onClick={() => setOpen(open === ex.slug ? null : ex.slug)} className="!min-h-[48px] text-sm">Log manually</GhostButton>
              </div>
              {open === ex.slug && <ManualLog sessionId={session.id} exercise={ex} onSaved={load} />}
            </Card>
          );
        })}
      </div>

      {extra.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionLabel>Other sets today</SectionLabel>
          {extra.map((s) => (
            <div key={s.id} className="rounded-xl bg-surface px-3 py-2 text-sm">
              {s.exercises?.name_en}: {s.weight_kg ?? "BW"} kg × {s.reps_full} {s.form_score !== null && <span className="text-lime">· form {s.form_score}</span>}
            </div>
          ))}
        </div>
      )}

      <Link href="/exercises" className="text-center text-sm text-lime">+ Add another exercise</Link>

      {!session.end_time ? (
        <PrimaryButton
          onClick={async () => {
            await api(`/sessions/${session.id}/finish`, { method: "POST" });
            load();
          }}
        >
          Finish session
        </PrimaryButton>
      ) : (
        <p className="text-center text-sm text-muted">Session finished. Great work.</p>
      )}
    </div>
  );
}
