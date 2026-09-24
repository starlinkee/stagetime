-- Stat: mob kills, separate from PvP `kills` (0024) — kills of the room-owned enemy in the Arena
-- (see ARENA_ROOM_SLUG in realtime-server/shared/constants.ts), not another player. Run in
-- Supabase → SQL Editor (jednorazowo, po 0029).

alter table public.profiles
  add column if not exists mob_kills integer not null default 0 check (mob_kills >= 0);

-- Same "no client-side session" reasoning as increment_kills (0024): an enemy kill is decided
-- authoritatively by realtime-server, which has no per-user Supabase JWT to run an
-- auth.uid()-scoped RPC as (see src/lib/supabaseAdmin.ts). Callable only through the service-role
-- bridge (src/app/api/internal/combat/route.ts), hence `p_user_id` as an explicit argument and
-- grants restricted to service_role.
create or replace function public.increment_mob_kills(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mob_kills integer;
begin
  update public.profiles
  set mob_kills = mob_kills + 1
  where id = p_user_id
  returning mob_kills into v_mob_kills;

  return v_mob_kills;
end;
$$;

revoke all on function public.increment_mob_kills(uuid) from public, authenticated, anon;
grant execute on function public.increment_mob_kills(uuid) to service_role;

-- profiles already rides the supabase_realtime publication (migration 0002), so mob_kills updates
-- push to everyone watching a profile live, same as kills/deaths.
