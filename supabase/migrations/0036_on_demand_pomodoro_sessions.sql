-- STU-58: pomodoro rooms move from N phase-offset slug variants (e.g. "25-5-3") sharing one global
-- work/break clock to one door per type, started on demand per group of players (see
-- PomodoroSessionState in realtime-server/shared/types.ts and the "startSession" flow in
-- realtime-server/src/server.ts). Two knock-on effects for room_session_complete:
--   1. v_work_min's slug pattern matched the old numbered-variant slugs ("25-5-1".."25-5-5") —
--      those slugs no longer exist (see src/lib/rooms.ts), so it now matches the new plain type
--      slugs instead.
--   2. There's no more global "cycle number since EPOCH_MS" to dedupe against. Each session now
--      has its own on-demand `startedAt` (epoch ms), unique per session run, which serves exactly
--      the same "highest one wins" idempotency role `cycle` did — src/components/RoomStage.tsx now
--      passes that instead. `cycle` is renamed and widened to bigint accordingly (an epoch-ms
--      value overflows a 4-byte integer); existing rows just hold small legacy cycle numbers, which
--      is harmless — any new session's real epoch-ms value is always larger and so always
--      supersedes them via the same ON CONFLICT comparison below.
alter table public.room_session_credits rename column cycle to session_started_at;
alter table public.room_session_credits alter column session_started_at type bigint;

create or replace function public.room_session_complete(p_room text, p_cycle bigint)
returns table (xp double precision, coins double precision, credited boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_work_min integer;
  v_xp numeric;
  v_coins numeric;
  v_credited boolean;
begin
  v_work_min := case
    when p_room = '25-5' then 25
    when p_room = '20-5' then 20
    when p_room = '50-10' then 50
    else null
  end;
  if v_work_min is null then
    raise exception 'unknown_room' using errcode = 'P0001';
  end if;

  -- Same rounding as xpForMinutes()/coinsForMinutes() (src/lib/xp.ts, src/lib/coins.ts): 1 XP and
  -- 5 coins per 5 minutes of work. Every real workMin (20/25/50) divides evenly, so this is always
  -- a whole number in practice — round() is just belt-and-suspenders against a future odd workMin.
  v_xp := round((v_work_min * 60)::numeric / 300, 1);
  v_coins := round((v_work_min * 60)::numeric / 60, 1);

  insert into public.room_session_credits (user_id, room, session_started_at)
  values (auth.uid(), p_room, p_cycle)
  on conflict (user_id, room) do update
    set session_started_at = excluded.session_started_at, credited_at = now()
    where room_session_credits.session_started_at < excluded.session_started_at;

  v_credited := found;

  if v_credited then
    update public.profiles
    set xp = xp + v_xp,
        coins = coins + v_coins
    where id = auth.uid();
  end if;

  return query
    select profiles.xp::double precision, profiles.coins::double precision, v_credited
    from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.room_session_complete(text, bigint) to authenticated;
-- Old integer-arg overload becomes unreachable from the client (RoomStage.tsx only ever calls the
-- bigint one going forward), but Postgres keeps both signatures around as distinct overloads
-- unless dropped explicitly.
drop function if exists public.room_session_complete(text, integer);

-- messages_room_slug_valid (0006/0011/0018) whitelisted the old numbered-variant pomodoro slugs
-- ("25-5-1" etc) — those no longer exist (see src/lib/rooms.ts), so chat from a pomodoro room
-- would now fail this CHECK. Bare type slugs ("25-5"/"20-5"/"50-10") replace the pattern match.
alter table public.messages drop constraint if exists messages_room_slug_valid;
alter table public.messages
  add constraint messages_room_slug_valid
  check (room_slug in ('lobby', 'timer', 'shop', '25-5', '20-5', '50-10')) not valid;
