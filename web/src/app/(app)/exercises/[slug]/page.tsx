"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, Exercise } from "@/lib/api";
import { speak } from "@/lib/speech";
import { useProfile } from "@/components/AuthGate";
import { ErrorNote, GhostButton, PageHeader, SectionLabel, Spinner } from "@/components/ui";
import { IconBody, IconSpeaker } from "@/components/icons";

export default function ExerciseDetail() {
  const { slug } = useParams<{ slug: string }>();
  const { profile } = useProfile();
  const [ex, setEx] = useState<Exercise | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    api<Exercise>(`/exercises/${slug}`).then(setEx).catch((e) => setError(e.message));
  }, [slug]);

  // Flip between the start and end photos so it plays like a demo loop
  useEffect(() => {
    if (!ex || ex.image_urls.length < 2) return;
    const timer = setInterval(() => setFrame((f) => (f + 1) % ex.image_urls.length), 1200);
    return () => clearInterval(timer);
  }, [ex]);

  if (error) return <div className="pt-8"><ErrorNote message={error} /></div>;
  if (!ex) return <Spinner />;

  const steps = ex.instructions ?? [];
  const recent = (ex.history ?? []).slice(0, 8).reverse();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={ex.name_en} subtitle={[ex.name_hi, ex.equipment, ex.difficulty].filter(Boolean).join(" · ")} back="/exercises" />

      {ex.image_urls.length > 0 && (
        <div className="relative overflow-hidden rounded-3xl bg-surface">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ex.image_urls[frame]} alt={`${ex.name_en} demonstration, position ${frame + 1}`} className="aspect-[4/3] w-full object-contain" />
          <div className="absolute bottom-3 left-3 flex gap-1.5" aria-hidden="true">
            {ex.image_urls.map((_, i) => <span key={i} className={`h-1 rounded-full ${i === frame ? "w-5 bg-lime" : "w-1.5 bg-muted"}`} />)}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {ex.muscles.map((m) => <span key={m} className="rounded-xl bg-lime px-3 py-1.5 text-xs font-semibold capitalize text-ground">{m}</span>)}
        {(ex.secondary_muscles ?? []).map((m) => <span key={m} className="rounded-xl bg-surface2 px-3 py-1.5 text-xs capitalize">{m}</span>)}
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-2.5">
        <GhostButton onClick={() => speak(`${ex.name_en}. ${steps.join(" ")}`, profile?.language === "hi" ? "hi" : "en", true)} className="px-5">
          <IconSpeaker /> Listen
        </GhostButton>
        {ex.engine ? (
          <Link href={`/coach?slug=${ex.slug}&reps=8-12&rest=90`} className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-lime font-bold text-ground">
            <IconBody /> Train with AI
          </Link>
        ) : (
          <span className="flex items-center rounded-2xl border border-dashed border-line px-3 text-xs text-muted">Live AI coach coming soon for this exercise. Log it from your session.</span>
        )}
      </div>

      {steps.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionLabel>How to do it</SectionLabel>
          <ol className="flex flex-col gap-3">
            {steps.map((step, i) => (
              <li key={i} className="flex gap-3 text-[15px] leading-relaxed">
                <span className="w-4 shrink-0 font-display text-lg font-bold text-lime">{i + 1}</span>
                <span className="text-soft">{step}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-3xl border border-line p-4">
        <div className="flex items-baseline justify-between">
          <SectionLabel>Your history</SectionLabel>
          {ex.best && <span className="text-sm text-soft">Best: {ex.best.weight_kg ?? "BW"} kg × {ex.best.reps}</span>}
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-muted">No sets yet. Your weights and form scores will show here.</p>
        ) : (
          <div className="flex h-20 items-end gap-1.5" role="img" aria-label="Form score of recent sets">
            {recent.map((h, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <div className={`w-full rounded-sm ${i === recent.length - 1 ? "bg-lime" : "bg-[#3a423d]"}`} style={{ height: `${Math.max(8, (h.form_score ?? 50) * 0.6)}px` }} />
                <span className="text-[10px] text-muted">{h.weight_kg ?? "BW"}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
