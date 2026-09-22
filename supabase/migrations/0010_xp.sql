-- XP and levels: profiles earn XP for continuous time spent in a study room (1 XP per 5
-- minutes present, work or break phase alike — see src/lib/xp.ts for the level curve).
-- Run in Supabase → SQL Editor (jednorazowo, po 0009).

alter table public.profiles
  add column if not exists xp integer not null default 0 check (xp >= 0),
  add column if not exists study_seconds integer not null default 0 check (study_seconds >= 0 and study_seconds < 300),
  add column if not exists xp_heartbeat_at timestamptz;

-- Called every ~60s by a client sitting in a study room (see src/lib/useStudyXp.ts). Elapsed
-- time is computed here from the gap since the caller's last heartbeat, not from anything the
-- client reports — a client can't inflate XP by lying about how long it's been present, only by
-- calling this while genuinely not studying (same trust level as the rest of this app's RLS/
-- trigger-based model, e.g. messages_rate_limit in 0004_security_hardening.sql).
create or replace function public.room_study_heartbeat(p_room text)
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

  select xp_heartbeat_at, study_seconds into v_last, v_seconds
  from public.profiles where id = auth.uid() for update;

  if not found then
    raise exception 'no_profile' using errcode = 'P0001';
  end if;

  -- First heartbeat (ever, or after a gap) only starts the clock — nothing to credit yet.
  -- Elapsed is capped a little above the 60s heartbeat interval so a backgrounded/stale tab
  -- that wakes up later can't award a windfall for the time it was away.
  v_elapsed := case when v_last is null then 0
    else least(greatest(extract(epoch from (now() - v_last))::integer, 0), 75) end;

  v_seconds := v_seconds + v_elapsed;
  v_gain := v_seconds / 300;
  v_seconds := v_seconds % 300;

  update public.profiles
  set xp = profiles.xp + v_gain, study_seconds = v_seconds, xp_heartbeat_at = now()
  where id = auth.uid();

  return query select profiles.xp, profiles.study_seconds from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.room_study_heartbeat(text) to authenticated;

-- profiles already rides the supabase_realtime publication (migration 0002), so xp/study_seconds
-- updates push to everyone watching a profile (level badge in chat, own profile button) live.
