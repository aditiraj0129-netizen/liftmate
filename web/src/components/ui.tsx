"use client";

import Link from "next/link";
import { IconBack } from "./icons";

/** Small shared UI pieces so every screen looks the same. */

export const inputClass =
  "h-12 w-full rounded-2xl border border-line bg-surface px-4 text-[15px] text-ink placeholder:text-muted/70 outline-none focus:border-lime";

export const labelClass = "flex flex-col gap-1.5 text-xs text-muted";

export function PrimaryButton({ className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`flex h-13 min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-lime px-5 text-base font-bold text-ground transition active:scale-[0.98] disabled:opacity-50 ${className}`}
    />
  );
}

export function GhostButton({ className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border border-line bg-surface px-4 text-[15px] font-semibold text-ink transition active:scale-[0.98] disabled:opacity-50 ${className}`}
    />
  );
}

export function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`rounded-3xl border border-line bg-surface p-4 ${className}`}>{children}</div>;
}

export function SectionLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`text-xs font-semibold uppercase tracking-widest text-muted ${className}`}>{children}</div>;
}

export function PageHeader({ title, subtitle, back }: { title: string; subtitle?: string; back?: string }) {
  return (
    <div className="flex items-center gap-3 pb-2 pt-6">
      {back && (
        <Link href={back} aria-label="Back" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface">
          <IconBack />
        </Link>
      )}
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-bold leading-none">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-2xl border border-amber/50 bg-amber-deep px-4 py-3 text-sm text-amber">
      {message}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-sm text-muted" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-lime" />
      {label}
    </div>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`min-h-[48px] rounded-2xl px-2 text-sm font-semibold transition ${
            o.value === value ? "bg-lime text-ground" : "border border-line bg-surface text-muted"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Bar({ value, max, tone = "lime" }: { value: number; max: number; tone?: "lime" | "amber" }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return (
    <div className="h-1.5 rounded-full bg-line">
      <div className={`h-1.5 rounded-full ${tone === "lime" ? "bg-lime" : "bg-amber"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
