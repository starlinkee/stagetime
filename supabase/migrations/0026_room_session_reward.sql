-- Pomodoro rooms switch from per-minute XP/coin heartbeats (room_study_heartbeat, see 0010/0014/
-- 0015/0017/0022) to a single lump-sum reward paid out once the room's "work" phase actually
-- finishes (see the work→break transition in src/components/RoomStage.tsx, the same moment that
-- already triggers the "Congratulations" screen). room_study_heartbeat/useStudyXp stays exactly
-- as-is and keeps being used, unchanged, for the Timer Room (a personal stopwatch with no fixed
-- end, so a lump sum makes no sense there).
--
-- The amount must match src/lib/xp.ts's xpForMinutes()/src/lib/coins.ts's coinsForMinutes() for
-- the room's own workMin (5 XP/1 coin per 5 minutes) — v_work_min below is derived from the room
-- slug the same way room_study_heartbeat's whitelist regex does, not trusted from the client,
-- so a client can't claim a bigger room's reward for a smaller one.
--
-- Idempotency: getTimerState's `cycle` (src/lib/timer.ts) numbers every work+break cycle since
-- EPOCH_MS, and is identical for every client watching the same room at the same instant — a
-- pure function of the server clock, nothing to broadcast. room_session_credits remembers the
-- highest cycle already paid out per (user, room); a second call for a cycle already credited
-- (tab refresh, reconnect, a client calling this more than once) is a no-op. There is deliberately
-- no way to claim a cycle whose work phase you didn't stay present for: nothing calls this except
-- the work→break transition itself, which only fires for a client that was actually mounted in
-- the room when it happened (leaving early — see the new "Opuść pokój" forfeit button — never
-- calls it).

create table if not exists public.room_session_credits (
  user_id uuid not null references auth.users(id) on delete cascade,
  room text not null,
  cycle integer not null,
  credited_at timestamptz not null default now(),
  primary key (user_id, room)
);

alter table public.room_session_credits enable row level security;
-- No policies: this table is never read or written directly by a client, only from inside
-- room_session_complete below (security definer, runs as the function owner).

create or replace function public.room_session_complete(p_room text, p_cycle integer)
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
    when p_room ~ '^25-5-[1-9][0-9]*$' then 25
    when p_room ~ '^20-5-[1-9][0-9]*$' then 20
    when p_room ~ '^50-10-[1-9][0-9]*$' then 50
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

  insert into public.room_session_credits (user_id, room, cycle)
  values (auth.uid(), p_room, p_cycle)
  on conflict (user_id, room) do update
    set cycle = excluded.cycle, credited_at = now()
    where room_session_credits.cycle < excluded.cycle;

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

grant execute on function public.room_session_complete(text, integer) to authenticated;
