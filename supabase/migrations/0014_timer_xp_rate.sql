-- Timer Room XP at a lower, gated rate: 0.1 XP per 5 minutes (1 XP per 50 min), credited only
-- while the stopwatch is actually running (see src/components/TimerRoom.tsx) — pausing or
-- leaving the room stops accrual. Other rooms are unaffected (still 1 XP per 5 min, work or
-- break phase alike — see 0010_xp.sql).
-- Run in Supabase → SQL Editor (jednorazowo, po 0013).

alter table public.profiles
  add column if not exists timer_study_seconds integer not null default 0 check (timer_study_seconds >= 0 and timer_study_seconds < 3000),
  add column if not exists timer_heartbeat_at timestamptz;

-- Called every ~60s by a client sitting in a study room (see src/lib/useStudyXp.ts). Elapsed
-- time is computed here from the gap since the caller's last heartbeat, not from anything the
-- client reports. For the timer room, `p_running` (whether the stopwatch is currently started)
-- gates accrual: a heartbeat sent while paused credits nothing and nulls the room's heartbeat
-- clock, so the next heartbeat after resuming starts fresh instead of crediting the paused gap
-- (same "first heartbeat only starts the clock" trick as a genuine first call, see below).

-- Drop the old single-arg signature from 0010 — `create or replace` below would otherwise add an
-- overload, and an exact-arity match beats a default-parameter match, so calls without p_running
-- would keep silently hitting the pre-gating version.
drop function if exists public.room_study_heartbeat(text);

create or replace function public.room_study_heartbeat(p_room text, p_running boolean default true)
returns table (xp integer, study_seconds integer)
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

  if v_is_timer then
    select timer_heartbeat_at, timer_study_seconds into v_last, v_seconds
    from public.profiles where id = auth.uid() for update;
  else
    select xp_heartbeat_at, study_seconds into v_last, v_seconds
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

  if v_is_timer then
    update public.profiles
    set xp = profiles.xp + v_gain,
        timer_study_seconds = v_seconds,
        timer_heartbeat_at = case when p_running then now() else null end
    where id = auth.uid();

    return query select profiles.xp, profiles.timer_study_seconds from public.profiles where id = auth.uid();
  else
    update public.profiles
    set xp = profiles.xp + v_gain, study_seconds = v_seconds, xp_heartbeat_at = now()
    where id = auth.uid();

    return query select profiles.xp, profiles.study_seconds from public.profiles where id = auth.uid();
  end if;
end;
$$;

grant execute on function public.room_study_heartbeat(text, boolean) to authenticated;
