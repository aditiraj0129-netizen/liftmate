"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, Session } from "@/lib/api";
import { Bar, Card, ErrorNote, SectionLabel, Spinner } from "@/components/ui";
import { IconBody, IconMic, IconPlus, IconScan } from "@/components/icons";

type Home = {
  name: string | null;
  today: string;
  week: { week_start: string; days: { date: string; sessions: { id: string; title: string | null }[]; sets: number; avg_form: number | null }[] };
  sessions_this_week: number;
  training_days_goal: number;
  today_session: (Session & { sets: { id: string }[] }) | null;
  recovery: number;
  nutrition: { kcal: number; protein_g: number; targets: { kcal: number; protein_g: number } };
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export default function HomePage() {
  const [data, setData] = useState<Home | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Home>("/home").then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="pt-8"><ErrorNote message={error} /></div>;
  if (!data) return <Spinner />;

  const todayLabel = new Date(data.today + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  const plan = data.today_session?.plan;

  return (
    <div className="flex flex-col gap-5 pt-6">
      <header>
        <p className="text-sm text-muted">{todayLabel}</p>
        <h1 className="font-display text-3xl font-bold">{greeting()}, {data.name?.split(" ")[0] ?? "lifter"}</h1>
      </header>

      <section aria-label="This week" className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between">
          <SectionLabel>This week</SectionLabel>
          <span className="text-sm text-muted">{data.sessions_this_week} of {data.training_days_goal} sessions</span>
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {data.week.days.map((day, i) => {
            const isToday = day.date === data.today;
            const future = day.date > data.today;
            const trained = day.sessions.length > 0;
            const inner = (
              <>
                <span className={`text-[11px] ${isToday ? "font-semibold" : "text-muted"}`}>{DAY_NAMES[i]}</span>
                <span className={`font-display text-xl font-bold ${future && !isToday ? "text-muted" : ""}`}>{Number(day.date.slice(8))}</span>
                <span className={`h-1.5 w-1.5 rounded-full ${trained ? (isToday ? "bg-ground" : "bg-lime") : future ? "" : "border border-muted/60"}`} />
              </>
            );
            const cls = `flex flex-col items-center gap-1.5 rounded-2xl py-2.5 ${isToday ? "bg-lime text-ground" : future ? "border border-dashed border-line" : "bg-surface"}`;
            return trained ? (
              <Link key={day.date} href={`/session/${day.sessions[0].id}`} className={cls} aria-label={`${DAY_NAMES[i]}: ${day.sessions[0].title ?? "workout"}`}>
                {inner}
              </Link>
            ) : (
              <div key={day.date} className={cls}>{inner}</div>
            );
          })}
        </div>
      </section>

      <Card className="flex flex-col gap-3.5 p-5">
        <div className="flex items-center justify-between">
          <SectionLabel className="!text-lime">Today&apos;s plan</SectionLabel>
          {plan?.intensity && <span className="text-xs text-muted">{plan.intensity} intensity</span>}
        </div>
        {data.today_session ? (
          <>
            <div className="font-display text-4xl font-extrabold uppercase leading-none">{data.today_session.title}</div>
            <ul className="flex flex-col gap-2 text-sm">
              {(plan?.exercises ?? []).slice(0, 3).map((ex) => (
                <li key={ex.slug} className="flex justify-between gap-3">
                  <span>{ex.name}</span>
                  <span className="shrink-0 text-muted">{ex.sets} × {ex.reps}</span>
                </li>
              ))}
              {(plan?.exercises?.length ?? 0) > 3 && <li className="text-muted">+ {(plan?.exercises?.length ?? 0) - 3} more</li>}
            </ul>
            <Link href={`/session/${data.today_session.id}`} className="flex min-h-[52px] items-center justify-center rounded-2xl bg-lime font-bold text-ground">
              {data.today_session.end_time ? "View today's session" : "Continue session"}
            </Link>
          </>
        ) : (
          <>
            <p className="text-soft">No session yet today. Do a 30-second check-in and your coach builds today&apos;s plan around your week, food and recovery.</p>
            <Link href="/session/new" className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-lime font-bold text-ground">
              <IconPlus /> New Session
            </Link>
          </>
        )}
      </Card>

      <div className="grid grid-cols-3 gap-2.5">
        <div className="flex flex-col gap-1.5 rounded-2xl bg-surface p-3">
          <span className="text-[11px] text-muted">Recovery</span>
          <span className="font-display text-3xl font-bold leading-none">{data.recovery}<span className="text-sm text-muted">%</span></span>
          <Bar value={data.recovery} max={100} tone={data.recovery < 55 ? "amber" : "lime"} />
        </div>
        <div className="flex flex-col gap-1.5 rounded-2xl bg-surface p-3">
          <span className="text-[11px] text-muted">Protein</span>
          <span className="font-display text-3xl font-bold leading-none">{data.nutrition.protein_g}<span className="text-sm text-muted">/{data.nutrition.targets.protein_g}g</span></span>
          <Bar value={data.nutrition.protein_g} max={data.nutrition.targets.protein_g} tone="amber" />
        </div>
        <div className="flex flex-col gap-1.5 rounded-2xl bg-surface p-3">
          <span className="text-[11px] text-muted">Calories</span>
          <span className="font-display text-3xl font-bold leading-none">{data.nutrition.kcal.toLocaleString("en-IN")}</span>
          <Bar value={data.nutrition.kcal} max={data.nutrition.targets.kcal} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        <Link href="/exercises?ai=1" className="flex min-h-[88px] flex-col justify-between rounded-2xl border border-line p-3">
          <IconBody className="h-6 w-6 text-lime" />
          <span className="text-sm font-semibold">Live Coach</span>
        </Link>
        <Link href="/machines" className="flex min-h-[88px] flex-col justify-between rounded-2xl border border-line p-3">
          <IconScan className="h-6 w-6 text-lime" />
          <span className="text-sm font-semibold">Scan machine</span>
        </Link>
        <Link href="/nutrition#chat" className="flex min-h-[88px] flex-col justify-between rounded-2xl border border-line p-3">
          <IconMic className="h-6 w-6 text-lime" />
          <span className="text-sm font-semibold">Ask nutritionist</span>
        </Link>
      </div>
    </div>
  );
}
