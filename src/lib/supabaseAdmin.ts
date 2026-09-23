import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

let client: SupabaseClient | null = null;

/**
 * Service-role client — bypasses RLS. Only for the internal realtime-server bridge
 * (src/app/api/internal/positions/route.ts), which reads/writes *other* users' last-known
 * position on their behalf. There's no per-request user JWT on that path (the caller is a
 * trusted backend process acting for many different players at once, not one signed-in user's
 * own browser), so the normal `auth.uid()`-scoped RLS policies on player_positions don't apply —
 * see docs/stateful_server_plan.md, Faza C / C1. Never import this from a route that doesn't
 * check its own authorization first.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (!url || !key) return null;
  return (client ??= createClient(url, key, { auth: { persistSession: false } }));
}
