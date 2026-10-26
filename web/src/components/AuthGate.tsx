"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, Profile } from "@/lib/api";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { Spinner } from "./ui";

type Ctx = { profile: Profile | null; refresh: () => Promise<void> };
const ProfileContext = createContext<Ctx>({ profile: null, refresh: async () => {} });
export const useProfile = () => useContext(ProfileContext);

/** Makes sure the user is logged in and has finished onboarding before showing app screens. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const me = await api<Profile>("/me");
    setProfile(me);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!isSupabaseConfigured) {
        setError("Supabase keys are missing. Fill in web/.env.local and restart `npm run dev`.");
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.replace("/login");
        return;
      }
      try {
        const me = await api<Profile>("/me");
        if (!active) return;
        setProfile(me);
        if (!me.is_complete && pathname !== "/onboarding") router.replace("/onboarding");
        setReady(true);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.replace("/login");
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-md p-6">
        <h1 className="font-display text-3xl font-bold">Liftmate can't start</h1>
        <p className="mt-3 text-soft">{error}</p>
        <p className="mt-3 text-sm text-muted">Check that the backend is running on port 8000 and the keys in both .env files are filled in.</p>
      </div>
    );
  }
  if (!ready) return <Spinner label="Getting things ready" />;
  return <ProfileContext.Provider value={{ profile, refresh }}>{children}</ProfileContext.Provider>;
}
