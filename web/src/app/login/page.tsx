"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { ErrorNote, inputClass, labelClass, PrimaryButton, Segmented } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/");
    });
  }, [router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    if (!isSupabaseConfigured) {
      setError("Supabase keys are missing. Fill in web/.env.local and restart the web app.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name } } });
        if (error) throw error;
        if (!data.session) {
          setInfo("Account created. Check your email to confirm, then log in.");
          setMode("login");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      router.replace("/");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-6 py-10">
      <div>
        <div className="font-display text-5xl font-extrabold tracking-wide text-lime">LIFTMATE</div>
        <p className="mt-2 text-lg text-soft">Your lifting partner. Live form coaching, reps counted for you, food and recovery advice in English or Hindi.</p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <Segmented
          label="Login or sign up"
          value={mode}
          onChange={setMode}
          options={[
            { value: "login", label: "Log in" },
            { value: "signup", label: "Create account" },
          ]}
        />
        {mode === "signup" && (
          <label className={labelClass}>
            Your name
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          </label>
        )}
        <label className={labelClass}>
          Email
          <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label className={labelClass}>
          Password
          <input
            className={inputClass}
            type="password"
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />
        </label>
        <ErrorNote message={error} />
        {info && <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-lime">{info}</p>}
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? "Please wait..." : mode === "signup" ? "Create account" : "Log in"}
        </PrimaryButton>
      </form>
      <p className="text-xs text-muted">Minimum age 16. Liftmate gives general fitness guidance, not medical advice.</p>
    </main>
  );
}
