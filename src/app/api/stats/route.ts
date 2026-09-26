import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Public, aggregate-only stats for the "About the game" panel. Uses the anon client (not
 * supabaseAdmin) — public.profiles has a select-all RLS policy, so a plain row count needs no
 * service role, and one row per account exists from creation (see supabase/migrations/0002_profiles.sql).
 */
export async function GET() {
  const supabase = getSupabase();
  if (!supabase) {
    return Response.json({ accounts: null }, { headers: { "Cache-Control": "no-store" } });
  }

  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true });

  return Response.json(
    { accounts: error ? null : (count ?? null) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
