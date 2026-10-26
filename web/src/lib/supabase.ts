import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isSupabaseConfigured = url.startsWith("https://") && !url.includes("YOUR-PROJECT") && anonKey.length > 20;

// Only used for login. All app data goes through the FastAPI backend.
export const supabase = createClient(isSupabaseConfigured ? url : "https://placeholder.supabase.co", anonKey || "placeholder-key", {
  auth: { persistSession: true, autoRefreshToken: true },
});
