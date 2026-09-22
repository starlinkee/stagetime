-- Copper coins: a second, separate reward on top of XP, earned at a different rate. Study rooms
-- pay 1 coin per minute present (5 coins per 5 min, work or break phase alike); the Timer Room
-- pays 0.1 coin per minute, credited only while the stopwatch is running — see src/lib/coins.ts,
-- src/components/TimerRoom.tsx, and the XP rate split this mirrors in 0010_xp.sql/0014_timer_xp_rate.sql.
-- Run in Supabase → SQL Editor (jednorazowo, po 0014).

alter table public.profiles
  add column if not exists coins integer not null default 0 check (coins >= 0),
  add column if not exists coin_seconds integer not null default 0 check (coin_seconds >= 0 and coin_seconds < 60),
  add column if not exists timer_coin_seconds integer not null default 0 check (timer_coin_seconds >= 0 and timer_coin_seconds < 600);

-- Same signature as 0014's room_study_heartbeat, now also returning `coins`. The elapsed time
-- computed for the XP gain (from the gap since the caller's last heartbeat, capped at 75s) is
-- reused as-is for the coin gain — one clock, two payouts at two different rates/divisors.
drop function if exists public.room_study_heartbeat(text, boolean);

create or replace function public.room_study_heartbeat(p_room text, p_running boolean default true)
returns table (xp integer, study_seconds integer, coins integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last timestamptz;
  v_seconds integer;
  v_elapsed integer;
  v_gain integer;
  v_is_timer boolean;
  v_divisor integer;
  v_coin_seconds integer;
  v_coin_divisor integer;
  v_coin_gain integer;
begin
  -- Must match the real, non-lobby room slugs in src/lib/rooms.ts.
  if p_room not in (
    '25-5-1', '25-5-2', '25-5-3',
    '20-5-1', '20-5-2', '20-5-3',
    '50-10-1', '50-10-2', '50-10-3',
    'timer'
  ) then
    raise exception 'unknown_room' using errcode = 'P0001';
  end if;

  v_is_timer := p_room = 'timer';
  v_divisor := case when v_is_timer then 3000 else 300 end;
  -- 1 coin per 60s in study rooms, 1 coin per 600s (0.1/min) in the Timer Room.
  v_coin_divisor := case when v_is_timer then 600 else 60 end;

  if v_is_timer then
    select timer_heartbeat_at, timer_study_seconds, timer_coin_seconds into v_last, v_seconds, v_coin_seconds
    from public.profiles where id = auth.uid() for update;
  else
    select xp_heartbeat_at, study_seconds, coin_seconds into v_last, v_seconds, v_coin_seconds
    from public.profiles where id = auth.uid() for update;
  end if;

  if not found then
    raise exception 'no_profile' using errcode = 'P0001';
  end if;

  -- First heartbeat (ever, after a gap, or right after resuming from pause) only starts the
  -- clock — nothing to credit yet. Elapsed is capped a little above the 60s heartbeat interval
  -- so a backgrounded/stale tab that wakes up later can't award a windfall for the time it was
  -- away. A heartbeat sent while not running (timer paused) never credits elapsed time either.
  v_elapsed := case when v_last is null or not p_running then 0
    else least(greatest(extract(epoch from (now() - v_last))::integer, 0), 75) end;

  v_seconds := v_seconds + v_elapsed;
  v_gain := v_seconds / v_divisor;
  v_seconds := v_seconds % v_divisor;

  v_coin_seconds := v_coin_seconds + v_elapsed;
  v_coin_gain := v_coin_seconds / v_coin_divisor;
  v_coin_seconds := v_coin_seconds % v_coin_divisor;

  if v_is_timer then
    update public.profiles
    set xp = profiles.xp + v_gain,
        timer_study_seconds = v_seconds,
        timer_heartbeat_at = case when p_running then now() else null end,
        coins = profiles.coins + v_coin_gain,
        timer_coin_seconds = v_coin_seconds
    where id = auth.uid();

    return query select profiles.xp, profiles.timer_study_seconds, profiles.coins from public.profiles where id = auth.uid();
  else
    update public.profiles
    set xp = profiles.xp + v_gain,
        study_seconds = v_seconds,
        xp_heartbeat_at = now(),
        coins = profiles.coins + v_coin_gain,
        coin_seconds = v_coin_seconds
    where id = auth.uid();

    return query select profiles.xp, profiles.study_seconds, profiles.coins from public.profiles where id = auth.uid();
  end if;
end;
$$;

grant execute on function public.room_study_heartbeat(text, boolean) to authenticated;

-- profiles already rides the supabase_realtime publication (migration 0002), so a coins update
-- pushes to the owner's own open tabs live (ProfileMenu), same as xp/study_seconds.
