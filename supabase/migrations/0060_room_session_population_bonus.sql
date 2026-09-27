-- STU-73: XP/coin bonus that scales with how many players were actually in a pomodoro room when
-- its work phase ended (+10% per player beyond the first, capped at +90% for a 10+ player room).
-- Room population is only known authoritatively inside realtime-server (`rooms.get(instance.slug)`
-- at the work->break transition, see server.ts) — never trusted from the client, same reasoning as
-- increment_kills/award_kill_reward (0024/0025): the caller has no per-user Supabase session to run
-- an auth.uid()-scoped RPC as, so this is callable only through the service-role bridge
-- (src/app/api/internal/room-session-bonus/route.ts), with explicit p_user_id/p_multiplier
-- arguments and grants restricted to service_role.
--
-- This tops up the existing base (unmultiplied) reward from room_session_complete (0026/0036),
-- which keeps flowing through the client's own call unchanged — kept as a separate credits table
-- (not reusing room_session_credits, whose primary key is (user_id, room) and only remembers the
-- latest session, not "was the bonus already paid for this one") so this is idempotent per
-- (user, room, session_started_at) regardless of call ordering or retries relative to the base
-- credit.

create table if not exists public.room_session_bonus_credits (
  user_id uuid not null references auth.users(id) on delete cascade,
  room text not null,
  session_started_at bigint not null,
  credited_at timestamptz not null default now(),
  primary key (user_id, room, session_started_at)
);

alter table public.room_session_bonus_credits enable row level security;
-- No policies: this table is never read or written directly by a client, only from inside
-- admin_award_room_session_bonus below (security definer, runs as the function owner).

create or replace function public.admin_award_room_session_bonus(
  p_user_id uuid,
  p_room text,
  p_cycle bigint,
  p_multiplier numeric
)
returns table (credited boolean, bonus_xp double precision, bonus_coins double precision)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_work_min integer;
  v_xp numeric;
  v_coins numeric;
  v_multiplier numeric;
  v_bonus_xp numeric := 0;
  v_bonus_coins numeric := 0;
  v_credited boolean := false;
begin
  -- Same whitelist room_session_complete (0036) uses for the base reward.
  v_work_min := case
    when p_room = '25-5' then 25
    when p_room = '20-5' then 20
    when p_room = '50-10' then 50
    else null
  end;
  if v_work_min is null then
    raise exception 'unknown_room' using errcode = 'P0001';
  end if;

  -- Defense-in-depth: realtime-server computes this from its own trusted connection count, but a
  -- cross-process input is never trusted at face value here either — clamp to the legit range
  -- (1.0..1.9, i.e. +10%/player up to +90% at 10 players) no matter what's sent.
  v_multiplier := least(greatest(p_multiplier, 1.0), 1.9);
  if v_multiplier <= 1.0 then
    return query select false, 0::double precision, 0::double precision;
    return;
  end if;

  -- Same base amounts as room_session_complete (0036) — the bonus is only the *extra* on top.
  v_xp := round((v_work_min * 60)::numeric / 300, 1);
  v_coins := round((v_work_min * 60)::numeric / 60, 1);
  v_bonus_xp := round(v_xp * (v_multiplier - 1.0), 1);
  v_bonus_coins := round(v_coins * (v_multiplier - 1.0), 1);

  insert into public.room_session_bonus_credits (user_id, room, session_started_at)
  values (p_user_id, p_room, p_cycle)
  on conflict (user_id, room, session_started_at) do nothing;

  v_credited := found;

  if v_credited then
    update public.profiles
    set xp = xp + v_bonus_xp,
        coins = coins + v_bonus_coins
    where id = p_user_id;
  else
    v_bonus_xp := 0;
    v_bonus_coins := 0;
  end if;

  return query select v_credited, v_bonus_xp::double precision, v_bonus_coins::double precision;
end;
$$;

revoke all on function public.admin_award_room_session_bonus(uuid, text, bigint, numeric) from public, authenticated, anon;
grant execute on function public.admin_award_room_session_bonus(uuid, text, bigint, numeric) to service_role;

-- profiles already rides the supabase_realtime publication (migration 0002), so a bonus recipient's
-- own open tabs (ProfileMenu) see the xp/coins bump live, same as kills/deaths/base session reward.
