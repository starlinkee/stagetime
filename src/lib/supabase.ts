import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

/** Zwraca klienta Supabase albo null, gdy zmienne środowiskowe nie są ustawione (tryb lokalny). */
export function getSupabase(): SupabaseClient | null {
  if (!url || !key) return null;
  return (client ??= createClient(url, key));
}
