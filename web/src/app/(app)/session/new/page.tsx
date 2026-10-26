"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, Session } from "@/lib/api";
import { canListen, listen } from "@/lib/speech";
import { useProfile } from "@/components/AuthGate";
import { ErrorNote, inputClass, labelClass, PageHeader, PrimaryButton, Segmented } from "@/components/ui";
import { IconMic } from "@/components/icons";

const SORE_AREAS = ["Shoulders", "Chest", "Upper back", "Lower back", "Biceps", "Triceps", "Quads", "Hamstrings", "Glutes", "Knees", "Calves"];

function localDate() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export default function NewSessionPage() {
  const router = useRouter();
  const { profile } = useProfile();
  const [date, setDate] = useState(localDate());
  const [time, setTime] = useState(new Date().toTimeString().slice(0, 5));
  const [meals, setMeals] = useState("");
  const [energy, setEnergy] = useState(3);
  const [sleep, setSleep] = useState(7);
  const [sore, setSore] = useState<string[]>([]);
  const [minutes, setMinutes] = useState(60);
  const [focus, setFocus] = useState("");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function speakMeals() {
    setError(null);
    setListening(true);
    try {
      const text = await listen(profile?.language ?? "en");
      if (text) setMeals((m) => (m ? `${m}, ${text}` : text));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setListening(false);
    }
  }

  async function build() {
    setBusy(true);
    setError(null);
    try {
      const session = await api<Session>("/sessions", {
        body: { session_date: date, time, meals_text: meals, energy, sleep_hours: sleep, soreness: sore, minutes, focus: focus || null },
      });
      router.replace(`/session/${session.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="New Session" subtitle="30-second check-in" back="/" />

      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>Date<input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className={labelClass}>Start time<input className={inputClass} type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
      </div>

      <div className={labelClass}>
        <label htmlFor="meals">What have you eaten today? (with times if you can)</label>
        <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3">
          <textarea id="meals" rows={2} value={meals} onChange={(e) => setMeals(e.target.value)} placeholder="e.g. 2 aloo paratha with curd at 9, rajma chawal at 2 pm"
            className="resize-none bg-transparent text-[15px] leading-snug text-ink outline-none placeholder:text-muted/70" />
          {canListen() && (
            <button type="button" onClick={speakMeals} disabled={listening} className="flex h-11 w-fit items-center gap-2 rounded-xl bg-lime px-3 text-sm font-semibold text-ground">
              <IconMic /> {listening ? "Listening..." : "Speak it"}
            </button>
          )}
        </div>
      </div>

      <div className={labelClass}>
        Energy right now
        <Segmented label="Energy" value={energy} onChange={setEnergy} options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))} />
      </div>

      <label className={labelClass}>
        Sleep last night: <span className="font-display text-2xl font-bold text-ink">{sleep} h</span>
        <input type="range" min={3} max={11} step={0.5} value={sleep} onChange={(e) => setSleep(Number(e.target.value))} className="accent-[#c6f432]" />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-xs text-muted">Sore or painful anywhere?</legend>
        <div className="flex flex-wrap gap-2">
          {SORE_AREAS.map((area) => {
            const on = sore.includes(area);
            return (
              <button key={area} type="button" aria-pressed={on} onClick={() => setSore(on ? sore.filter((a) => a !== area) : [...sore, area])}
                className={`min-h-[40px] rounded-xl px-3 text-sm ${on ? "bg-amber-deep text-amber" : "border border-line text-muted"}`}>
                {area}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className={labelClass}>
        Time you have today
        <Segmented label="Time available" value={minutes} onChange={setMinutes} options={[30, 45, 60, 90].map((n) => ({ value: n, label: `${n} min` }))} />
      </div>

      <label className={labelClass}>
        Want a specific focus? (optional)
        <input className={inputClass} value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. legs, push, arms, let coach decide" />
      </label>

      <ErrorNote message={error} />
      <PrimaryButton onClick={build} disabled={busy}>{busy ? "Your coach is planning..." : "Build today's plan"}</PrimaryButton>
    </div>
  );
}
