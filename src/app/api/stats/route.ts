import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Public, aggregate-only stats for the "About the game" panel. Uses the anon client (not
 * supabaseAdmin) — public.profiles has a select-all RLS policy, so a plain row count needs no
 * service role, and one row per account exists from creation (see supabase/migrations/0002_profiles.sql).
 *
 * `players` counts distinct accounts that actually entered a room (rows in player_positions,
 * one per user_id/room pair — see supabase/migrations/0004_player_positions.sql), as opposed to
 * `accounts`, which counts every registration regardless of whether they ever played. We don't
 * track IP addresses anywhere in the DB, so this distinct-player count is the closest honest
 * proxy for "how many separate people actually showed up."
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
    supabase.rpc("count_distinct_players"),
  ]);

  return Response.json(
    {
      accounts: accountsResult.error ? null : (accountsResult.count ?? null),
      players: playersResult.error ? null : (playersResult.data ?? null),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
