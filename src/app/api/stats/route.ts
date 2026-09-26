import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Public, aggregate-only stats for the "About the game" panel. Uses the anon client (not
 * supabaseAdmin) — public.profiles has a select-all RLS policy, so a plain row count needs no
 * service role, and one row per account exists from creation (see supabase/migrations/0002_profiles.sql).
 *
 * `players` counts distinct accounts that have signed in at least once (via
 * count_logged_in_users(), see supabase/migrations/0051_count_logged_in_users.sql — backed by
 * auth.users.last_sign_in_at, not by having actually moved a character in a room), as opposed to
 * `accounts`, which counts every registration regardless of whether they ever came back to log
 * in. auth.users isn't exposed via PostgREST directly, hence the security-definer RPC.
 */
export async function GET() {
  const supabase = getSupabase();
  if (!supabase) {
    return Response.json(
      { accounts: null, players: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const [accountsResult, playersResult] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.rpc("count_logged_in_users"),
  ]);

  return Response.json(
    {
      accounts: accountsResult.error ? null : (accountsResult.count ?? null),
      players: playersResult.error ? null : (playersResult.data ?? null),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
