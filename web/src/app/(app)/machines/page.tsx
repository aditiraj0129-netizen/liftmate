"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { speak } from "@/lib/speech";
import { useProfile } from "@/components/AuthGate";
import { Card, ErrorNote, PageHeader, SectionLabel, Segmented, Spinner } from "@/components/ui";
import { IconBody, IconCamera, IconCheck, IconSpeaker } from "@/components/icons";

type GuideLang = { setup?: string[]; steps?: string[]; mistakes?: string[]; safety?: string[] };
type Guide = { en?: GuideLang; hi?: GuideLang };
type Machine = { id: string; type: string; name_en: string; name_hi: string | null; muscles: string[]; guide: Guide; exercise_slug: string | null };
type ScanResult = {
  machine: Machine;
  confidence: number | null;
  guide: Guide;
  exercise: { slug: string; name_en: string; engine: string | null } | null;
  saved_to_gym: boolean;
  scans_at_gym: number | null;
};
type GymMachine = { id: string; verified_count: number; guide: Guide; machines: Machine; exercise: ScanResult["exercise"] };

/** Shrink a photo to ~1024 px JPEG so it uploads fast and stays inside free AI limits. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
}

function GuideView({ machine, guide, exercise, lang, setLang, meta }: {
  machine: Machine; guide: Guide; exercise: ScanResult["exercise"]; lang: "en" | "hi"; setLang: (l: "en" | "hi") => void; meta?: React.ReactNode;
}) {
  const g = (lang === "hi" ? guide.hi : guide.en) ?? guide.en ?? {};
  const sections: [string, string[] | undefined, string][] = lang === "hi"
    ? [["सेटअप", g.setup, "text-lime"], ["कैसे करें", g.steps, "text-lime"], ["आम गलतियाँ", g.mistakes, "text-amber"], ["सुरक्षा", g.safety, "text-amber"]]
    : [["Setup", g.setup, "text-lime"], ["How to do it", g.steps, "text-lime"], ["Common mistakes", g.mistakes, "text-amber"], ["Safety", g.safety, "text-amber"]];
  const readAloud = () => speak([lang === "hi" ? machine.name_hi ?? machine.name_en : machine.name_en, ...sections.flatMap(([, lines]) => lines ?? [])].join(". "), lang, true);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          {meta}
          <h2 className="font-display text-3xl font-extrabold uppercase leading-none">{machine.name_en}</h2>
          <p className="text-sm text-muted">{machine.name_hi} · {machine.muscles.join(", ")}</p>
        </div>
        <button onClick={readAloud} aria-label="Read guide aloud" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line"><IconSpeaker /></button>
      </div>
      <Segmented label="Guide language" value={lang} onChange={setLang} options={[{ value: "en", label: "English" }, { value: "hi", label: "हिंदी" }]} />
      {sections.map(([title, lines, tone]) => lines && lines.length > 0 && (
        <div key={title}>
          <p className={`mb-1.5 text-xs font-semibold uppercase tracking-widest ${tone}`}>{title}</p>
          <ul className="flex flex-col gap-1.5 text-[15px] leading-relaxed text-soft">{lines.map((line) => <li key={line}>• {line}</li>)}</ul>
        </div>
      ))}
      {exercise?.engine ? (
        <Link href={`/coach?slug=${exercise.slug}&reps=10-12&rest=90`} className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-lime font-bold text-ground">
          <IconBody /> Train with AI on this machine
        </Link>
      ) : exercise ? (
        <Link href={`/exercises/${exercise.slug}`} className="text-sm text-lime">Open the {exercise.name_en} guide</Link>
      ) : null}
    </Card>
  );
}

export default function MachinesPage() {
  const { profile } = useProfile();
  const fileRef = useRef<HTMLInputElement>(null);
  const [lang, setLang] = useState<"en" | "hi">(profile?.language === "hi" ? "hi" : "en");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [list, setList] = useState<GymMachine[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const loadList = () => api<GymMachine[]>("/machines/my-gym").then(setList).catch(() => setList([]));
  useEffect(() => { loadList(); }, []);

  async function onPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setResult(null);
    setBusy(true);
    setPreview(URL.createObjectURL(file));
    try {
      const image_b64 = await shrink(file);
      const scanned = await api<ScanResult>("/machines/scan", { body: { image_b64, mime: "image/jpeg" } });
      setResult(scanned);
      loadList();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Machine Guide" subtitle="Scan any machine or its printed sticker" back="/" />

      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPhoto} className="hidden" id="scan-input" />
      <label htmlFor="scan-input" className="relative flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-3xl bg-surface text-muted">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Machine photo you scanned" className="absolute inset-0 h-full w-full object-cover opacity-70" />
        ) : null}
        {["left-4 top-4 border-l-4 border-t-4 rounded-tl-xl", "right-4 top-4 border-r-4 border-t-4 rounded-tr-xl", "left-4 bottom-4 border-l-4 border-b-4 rounded-bl-xl", "right-4 bottom-4 border-r-4 border-b-4 rounded-br-xl"].map((c) => (
          <span key={c} aria-hidden="true" className={`absolute h-9 w-9 border-lime ${c}`} />
        ))}
        <span className="relative flex flex-col items-center gap-2 rounded-2xl bg-ground/70 px-4 py-3 text-center">
          <IconCamera className="h-8 w-8 text-lime" />
          <span className="text-sm font-semibold text-ink">{busy ? "Reading the machine..." : preview ? "Scan another" : "Tap to take a photo"}</span>
          <span className="text-xs">Machine or its instruction sticker</span>
        </span>
      </label>

      {busy && <Spinner label="Identifying machine and writing a simple guide" />}
      <ErrorNote message={error} />

      {result && (
        <GuideView
          machine={result.machine}
          guide={result.guide}
          exercise={result.exercise}
          lang={lang}
          setLang={setLang}
          meta={
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-lime">
              Identified{result.confidence ? ` · ${Math.round(result.confidence * 100)}% sure` : ""}
            </p>
          }
        />
      )}
      {result?.saved_to_gym && (
        <p className="flex items-center gap-2 text-xs text-muted"><IconCheck className="h-4 w-4 text-lime" /> Saved to My Gym&apos;s Machines{result.scans_at_gym && result.scans_at_gym > 1 ? ` · scanned ${result.scans_at_gym} times at your gym` : ""}</p>
      )}
      {result && !result.saved_to_gym && <p className="text-xs text-muted">Set your gym in Profile to share this guide with other members.</p>}

      <section className="flex flex-col gap-2">
        <SectionLabel>My gym&apos;s machines {profile?.gyms?.name ? `· ${profile.gyms.name}` : ""}</SectionLabel>
        {list === null ? <Spinner /> : list.length === 0 ? (
          <p className="text-sm text-muted">No machines saved yet. The first scan of each machine at your gym is shared with all members.</p>
        ) : list.map((row) => (
          <div key={row.id} className="flex flex-col gap-2">
            <button onClick={() => setOpenId(openId === row.id ? null : row.id)} aria-expanded={openId === row.id}
              className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3 text-left">
              <span><span className="font-semibold">{row.machines.name_en}</span><span className="block text-xs text-muted">{row.machines.muscles.join(", ")}</span></span>
              <span className="text-xs text-muted">{row.verified_count} scan{row.verified_count > 1 ? "s" : ""}</span>
            </button>
            {openId === row.id && <GuideView machine={row.machines} guide={row.guide ?? row.machines.guide} exercise={row.exercise} lang={lang} setLang={setLang} />}
          </div>
        ))}
      </section>
    </div>
  );
}
