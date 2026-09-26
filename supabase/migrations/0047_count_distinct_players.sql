-- Public stats: distinct accounts that actually entered a room, for the "About the game" panel
-- (src/app/api/stats/route.ts). Run in Supabase → SQL Editor (jednorazowo, po 0046).
--
-- player_positions (migration 0004) is RLS-scoped to auth.uid() = user_id, so the anon client
-- used by /api/stats can't COUNT(DISTINCT user_id) across all rows directly. This is a
-- security-definer function that only ever returns an aggregate count — no row-level data leaks
-- through it — so it's safe to grant to anon/authenticated, unlike the service-role-only
-- functions in migration 0024.
create or replace function public.count_distinct_players()
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(distinct user_id)::integer from public.player_positions;
$$;

grant execute on function public.count_distinct_players() to anon, authenticated;
