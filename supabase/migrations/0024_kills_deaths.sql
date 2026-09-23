-- Stats: kills/deaths from PvP combat (damage only happens outside the lobby — see AGENTS.md and
-- realtime-server/shared/constants.ts). Run in Supabase → SQL Editor (jednorazowo, po 0023).

alter table public.profiles
  add column if not exists kills integer not null default 0 check (kills >= 0),
  add column if not exists deaths integer not null default 0 check (deaths >= 0);

-- Unlike increment_balls_shot/increment_fist_swings (migrations 0012/0023), these are never
-- called by a client with its own session — a kill/death is decided authoritatively by
-- realtime-server (realtime-server/src/server.ts), which has no per-user Supabase JWT to run an
-- auth.uid()-scoped RPC as (see src/lib/supabaseAdmin.ts). Callable only through the service-role
-- bridge (src/app/api/internal/combat/route.ts), hence `p_user_id` as an explicit argument and
-- grants restricted to service_role.
create or replace function public.increment_kills(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kills integer;
begin
  update public.profiles
  set kills = kills + 1
  where id = p_user_id
  returning kills into v_kills;

  return v_kills;
end;
$$;

create or replace function public.increment_deaths(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deaths integer;
begin
  update public.profiles
  set deaths = deaths + 1
  where id = p_user_id
  returning deaths into v_deaths;

  return v_deaths;
end;
$$;

revoke all on function public.increment_kills(uuid) from public, authenticated, anon;
revoke all on function public.increment_deaths(uuid) from public, authenticated, anon;
grant execute on function public.increment_kills(uuid) to service_role;
grant execute on function public.increment_deaths(uuid) to service_role;

-- profiles already rides the supabase_realtime publication (migration 0002), so kills/deaths
-- updates push to everyone watching a profile live, same as balls_shot/fist_swings.
