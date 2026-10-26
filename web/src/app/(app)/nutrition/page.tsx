"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { canListen, listen, speak } from "@/lib/speech";
import { useProfile } from "@/components/AuthGate";
import { Bar, Card, ErrorNote, GhostButton, inputClass, PageHeader, PrimaryButton, SectionLabel, Segmented, Spinner } from "@/components/ui";
import { IconMic, IconSend, IconSpeaker, IconTrash } from "@/components/icons";

type Macro = { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
type Meal = { id: string; eaten_at: string; description: string; kcal: number; protein_g: number; items: { name: string; quantity: string; kcal: number; protein_g: number }[] };
type Today = { targets: Macro; totals: Macro; remaining: Macro; meals: Meal[] };
type Msg = { role: "user" | "assistant"; content: string };
type PlanDay = { day: string; training_day: boolean; kcal: number; protein_g: number; meals: { time: string; name: string; items: string; kcal: number; protein_g: number }[] };
type Plan = { week_start: string; targets: Macro; plan: { days?: PlanDay[]; grocery_list?: string[]; tips?: string[] } };

const QUICK_QUESTIONS = [
  "I had a heavy lunch and gym is in 2 hours. What should I do?",
  "Protein is low today. What can I eat now?",
  "I ate extra at a party. How do I balance it?",
  "Mera lower back pain ho raha hai deadlift ke baad, kya karun?",
];

export default function NutritionPage() {
  const { profile } = useProfile();
  const lang = profile?.language ?? "en";
  const [tab, setTab] = useState<"today" | "chat" | "plan">("today");
  const [today, setToday] = useState<Today | null>(null);
  const [food, setFood] = useState("");
  const [logging, setLogging] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [voiceReplies, setVoiceReplies] = useState(false);
  const [plan, setPlan] = useState<Plan | null | undefined>(undefined);
  const [planBusy, setPlanBusy] = useState(false);
  const [budget, setBudget] = useState<"low" | "medium" | "high">("medium");
  const [region, setRegion] = useState("North Indian");
  const [openDay, setOpenDay] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  const loadToday = () => api<Today>("/nutrition/today").then(setToday).catch((e) => setError(e.message));

  useEffect(() => {
    loadToday();
    api<Msg[]>("/nutrition/chat").then(setMessages).catch(() => {});
    api<Plan | null>("/nutrition/plan").then(setPlan).catch(() => setPlan(null));
    if (window.location.hash === "#chat") setTab("chat");
    const day = (new Date().getDay() + 6) % 7;
    setOpenDay(day);
  }, []);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  async function logFood(text: string, source: "text" | "voice") {
    if (!text.trim()) return;
    setLogging(true);
    setError(null);
    try {
      const meal = await api<Meal & { note: string }>("/nutrition/log", { body: { text, source } });
      setFood("");
      setNote(meal.note || null);
      await loadToday();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLogging(false);
    }
  }

  async function voice(target: "food" | "chat") {
    try {
      const text = await listen(lang);
      if (!text) return;
      if (target === "food") await logFood(text, "voice");
      else await send(text, true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function send(text: string, spoken = false) {
    if (!text.trim()) return;
    setMessages((m) => [...m, { role: "user", content: text }]);
    setDraft("");
    setThinking(true);
    setError(null);
    try {
      const { reply } = await api<{ reply: string }>("/nutrition/chat", { body: { message: text } });
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      if (voiceReplies || spoken) speak(reply, lang, true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setThinking(false);
    }
  }

  async function buildPlan() {
    setPlanBusy(true);
    setError(null);
    try {
      setPlan(await api<Plan>("/nutrition/plan", { body: { budget, region } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPlanBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Nutrition" subtitle="Your AI nutritionist, in English or Hindi" />
      <Segmented label="Section" value={tab} onChange={setTab} options={[{ value: "today", label: "Today" }, { value: "chat", label: "Ask" }, { value: "plan", label: "Week plan" }]} />
      <ErrorNote message={error} />

      {tab === "today" && (
        !today ? <Spinner /> : (
          <>
            <Card className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <span className="font-display text-4xl font-bold">{today.totals.kcal}<span className="text-lg text-muted"> / {today.targets.kcal} kcal</span></span>
                <span className={`text-sm ${today.remaining.kcal < 0 ? "text-amber" : "text-muted"}`}>
                  {today.remaining.kcal >= 0 ? `${today.remaining.kcal} left` : `${-today.remaining.kcal} over`}
                </span>
              </div>
              <Bar value={today.totals.kcal} max={today.targets.kcal} />
              <div className="grid grid-cols-3 gap-3 text-sm">
                {([["Protein", "protein_g"], ["Carbs", "carbs_g"], ["Fat", "fat_g"]] as const).map(([label, key]) => (
                  <div key={key} className="flex flex-col gap-1">
                    <span className="text-xs text-muted">{label}</span>
                    <span className="font-semibold">{today.totals[key]} / {today.targets[key]} g</span>
                    <Bar value={today.totals[key]} max={today.targets[key]} tone={key === "protein_g" ? "amber" : "lime"} />
                  </div>
                ))}
              </div>
            </Card>

            <form onSubmit={(e) => { e.preventDefault(); logFood(food, "text"); }} className="flex flex-col gap-2">
              <label htmlFor="food" className="text-xs text-muted">Log what you ate (any language, add amounts if you can)</label>
              <div className="flex gap-2">
                <input id="food" className={inputClass} value={food} onChange={(e) => setFood(e.target.value)} placeholder="e.g. 3 roti, 1 katori paneer bhurji, salad" />
                {canListen() && (
                  <button type="button" onClick={() => voice("food")} aria-label="Speak your meal" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-lime text-ground"><IconMic /></button>
                )}
              </div>
              <PrimaryButton type="submit" disabled={logging || !food.trim()}>{logging ? "Counting calories..." : "Add meal"}</PrimaryButton>
              {note && <p className="text-xs text-muted">{note}</p>}
            </form>

            <section className="flex flex-col gap-2">
              <SectionLabel>Today&apos;s meals</SectionLabel>
              {today.meals.length === 0 && <p className="text-sm text-muted">Nothing logged yet.</p>}
              {today.meals.map((meal) => (
                <div key={meal.id} className="flex items-start justify-between gap-3 rounded-2xl bg-surface p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{meal.description}</p>
                    <p className="text-xs text-muted">
                      {new Date(meal.eaten_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })} · {Math.round(meal.kcal)} kcal · {Math.round(meal.protein_g)} g protein
                    </p>
                  </div>
                  <button aria-label="Delete meal" onClick={async () => { await api(`/nutrition/meals/${meal.id}`, { method: "DELETE" }); loadToday(); }}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted hover:text-amber"><IconTrash className="h-4 w-4" /></button>
                </div>
              ))}
            </section>
          </>
        )
      )}

      {tab === "chat" && (
        <div id="chat" className="flex flex-col gap-3">
          <div className="flex min-h-[40vh] flex-col gap-2.5">
            {messages.length === 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-soft">Ask anything about food, timing, recovery or gym aches. Your coach knows today&apos;s meals and training.</p>
                {QUICK_QUESTIONS.map((q) => (
                  <button key={q} onClick={() => send(q)} className="rounded-2xl border border-line px-3 py-2.5 text-left text-sm text-soft hover:border-lime">{q}</button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed ${m.role === "user" ? "self-end bg-lime text-ground" : "self-start bg-surface text-soft"}`}>
                {m.content}
                {m.role === "assistant" && (
                  <button onClick={() => speak(m.content, lang, true)} aria-label="Read aloud" className="ml-2 inline-flex align-middle text-muted hover:text-lime"><IconSpeaker className="h-4 w-4" /></button>
                )}
              </div>
            ))}
            {thinking && <div className="self-start rounded-2xl bg-surface px-3.5 py-2.5 text-sm text-muted">Thinking...</div>}
            <div ref={chatEnd} />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={voiceReplies} onChange={(e) => setVoiceReplies(e.target.checked)} className="h-4 w-4 accent-[#c6f432]" />
            Speak replies out loud
          </label>
          <form onSubmit={(e) => { e.preventDefault(); send(draft); }} className="sticky bottom-20 flex gap-2 bg-ground py-2">
            <label className="sr-only" htmlFor="chat-input">Message</label>
            <input id="chat-input" className={inputClass} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type or tap the mic..." />
            {canListen() && (
              <button type="button" onClick={() => voice("chat")} aria-label="Speak your question" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-line"><IconMic /></button>
            )}
            <button type="submit" disabled={!draft.trim() || thinking} aria-label="Send" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-lime text-ground disabled:opacity-50"><IconSend /></button>
          </form>
        </div>
      )}

      {tab === "plan" && (
        plan === undefined ? <Spinner /> : (
          <div className="flex flex-col gap-4">
            <Card className="flex flex-col gap-3">
              <p className="text-sm text-soft">
                {plan ? "This week's plan is ready. Rebuild it any time if your week changes." : `Get a Monday-Sunday plan for your ${profile?.diet_type?.replace("_", "-") ?? ""} diet and ${profile?.goal?.replace("_", " ") ?? ""} goal.`}
              </p>
              <div className="flex flex-col gap-1.5 text-xs text-muted">Budget
                <Segmented label="Budget" value={budget} onChange={setBudget} options={[{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }]} />
              </div>
              <label className="flex flex-col gap-1.5 text-xs text-muted">Food style
                <input className={inputClass} value={region} onChange={(e) => setRegion(e.target.value)} />
              </label>
              <GhostButton onClick={buildPlan} disabled={planBusy}>{planBusy ? "Building your week (about 20 s)..." : plan ? "Rebuild this week's plan" : "Build my week plan"}</GhostButton>
            </Card>
            {plan?.plan.days?.map((day, i) => (
              <div key={day.day} className="flex flex-col gap-2">
                <button onClick={() => setOpenDay(openDay === i ? -1 : i)} aria-expanded={openDay === i} className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
                  <span className="font-semibold">{day.day} {day.training_day && <span className="ml-1 rounded-md bg-lime px-1.5 py-0.5 text-[10px] font-bold text-ground">TRAINING</span>}</span>
                  <span className="text-xs text-muted">{day.kcal} kcal · {day.protein_g} g protein</span>
                </button>
                {openDay === i && (
                  <ul className="flex flex-col gap-2 pl-2">
                    {day.meals.map((meal, j) => (
                      <li key={j} className="rounded-xl border border-line p-3 text-sm">
                        <div className="flex justify-between"><span className="font-semibold">{meal.time} · {meal.name}</span><span className="text-muted">{meal.protein_g} g</span></div>
                        <p className="mt-1 text-soft">{meal.items}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            {plan?.plan.tips && plan.plan.tips.length > 0 && (
              <Card><SectionLabel className="mb-2">Coach tips</SectionLabel><ul className="flex flex-col gap-1.5 text-sm text-soft">{plan.plan.tips.map((t) => <li key={t}>• {t}</li>)}</ul></Card>
            )}
            {plan?.plan.grocery_list && plan.plan.grocery_list.length > 0 && (
              <Card><SectionLabel className="mb-2">Grocery list</SectionLabel><ul className="grid grid-cols-1 gap-1 text-sm text-soft sm:grid-cols-2">{plan.plan.grocery_list.map((g) => <li key={g}>☐ {g}</li>)}</ul></Card>
            )}
          </div>
        )
      )}
    </div>
  );
}
