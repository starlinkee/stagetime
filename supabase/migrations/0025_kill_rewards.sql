-- Kill reward: +KILL_XP_REWARD xp / +KILL_GOLD_REWARD coins to the killer, credited alongside the
-- kills/deaths counters from 0024 (see AGENTS.md and realtime-server/shared/constants.ts, which is
-- the single source of truth for the amounts — src/app/api/internal/combat/route.ts imports them
-- from there rather than hardcoding them again here).

-- Same "no client-side session" reasoning as increment_kills/increment_deaths (0024): a kill is
-- decided authoritatively by realtime-server, which has no per-user Supabase JWT to run an
-- auth.uid()-scoped RPC as (see src/lib/supabaseAdmin.ts). Callable only through the service-role
-- bridge, hence `p_user_id`/`p_xp`/`p_coins` as explicit arguments and grants restricted to
-- service_role.
create or replace function public.award_kill_reward(p_user_id uuid, p_xp integer, p_coins integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set xp = xp + greatest(p_xp, 0),
      coins = coins + greatest(p_coins, 0)
  where id = p_user_id;
end;
$$;

revoke all on function public.award_kill_reward(uuid, integer, integer) from public, authenticated, anon;
grant execute on function public.award_kill_reward(uuid, integer, integer) to service_role;

-- profiles already rides the supabase_realtime publication (migration 0002), so a killer's own
-- open tabs (ProfileMenu) see the xp/coins bump live, same as kills/deaths.
