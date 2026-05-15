import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Singleton — prevents duplicate instances during Next.js hot-reload
declare global {
  // eslint-disable-next-line no-var
  var _supabase: SupabaseClient | undefined;
}

export const supabase: SupabaseClient =
  globalThis._supabase ?? createClient(url, key);

if (process.env.NODE_ENV !== "production") {
  globalThis._supabase = supabase;
}
