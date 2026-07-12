import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Direct Supabase project. Only public configuration is embedded here:
// the project URL and the publishable (anon) key. Never place a
// service-role key, database password, or any other private secret in
// this file or anywhere else in browser code.
const FALLBACK_URL = "https://rmlaknguklxwbbdnywcd.supabase.co";
const FALLBACK_KEY = "sb_publishable_sigueHFNPiD455wrChYrog_SvJQFlIi";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? FALLBACK_URL;
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? FALLBACK_KEY;

export const SUPABASE_URL = url;
export const SUPABASE_PUBLISHABLE_KEY = key;

export const supabase: SupabaseClient = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  },
});
