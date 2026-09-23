-- Bug (reported 2026-09-23): buying the flower crown failed with a console error
-- "purchase_cosmetic {}" that carried no usable message.
--
-- Root cause, confirmed by simulating an authenticated call directly against the dev project:
--
--   ERROR: 42702: column reference "coins" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--
-- Any function whose `RETURNS TABLE (...)` names an output column the same as a `profiles` column
-- (xp, coins) gets an *implicit PL/pgSQL variable* of that same name in its body. A bare `coins`
-- or `xp` used inside the function is then ambiguous between that variable and the table column,
-- and Postgres's default `plpgsql.variable_conflict = error` refuses to guess — it raises 42702
-- instead of silently picking one. The very first coins migration (0015) qualified every such
-- self-reference as `profiles.coins`/`profiles.xp` for exactly this reason; every function written
-- after it (0019, 0026, 0027) dropped the qualification and is broken as a result. 0028 (this same
-- fix pass) reintroduced the identical mistake in room_study_heartbeat's new delta update.
--
-- Practical impact before this migration:
--   - purchase_cosmetic (0027): every purchase attempt fails — this is the bug that was reported.
--   - purchase_color_change (0019): same bug, silent only because Color Change is currently
--     disabled client-side (see the comment atop src/components/ShopRoom.tsx).
--   - room_session_complete (0026): same bug — pomodoro work-session lump-sum XP/coins have never
--     actually been credited since 0026 shipped; the client just logs the RPC error and returns
--     (see the `.then` in src/components/RoomStage.tsx), so no popup and no visible failure either.
--   - room_study_heartbeat as rewritten in 0028: same bug, freshly introduced — if 0028 already
--     ran on this project, ALL heartbeats (every study room + the Timer Room) are currently
--     failing, which blocks XP/coin accrual entirely until this migration runs.
--
-- Fix: qualify every self-referencing `xp`/`coins` with `profiles.` in all four functions, matching
-- the pattern 0015 already used correctly.
-- Run in Supabase → SQL Editor (jednorazowo, po 0028), on both production and local.

create or replace function public.purchase_color_change(p_color text)
returns table (color text, coins double precision)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cost constant numeric := 100;
begin
  if p_color !~ '^#[0-9a-f]{6}$' then
    raise exception 'invalid_color' using errcode = 'P0001';
  end if;

  update public.profiles
  set color = p_color,
      coins = profiles.coins - v_cost,
      updated_at = now()
  where id = auth.uid() and profiles.coins >= v_cost;

  if not found then
    if not exists (select 1 from public.profiles where id = auth.uid()) then
      raise exception 'no_profile' using errcode = 'P0001';
    end if;
    raise exception 'insufficient_coins' using errcode = 'P0001';
  end if;

  return query
    select profiles.color, profiles.coins::double precision
    from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.purchase_color_change(text) to authenticated;

create or replace function public.purchase_cosmetic(p_slug text)
returns table (cosmetic text, cosmetic_expires_at timestamptz, coins double precision)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cost numeric;
  v_hours numeric;
begin
  if p_slug = 'flower' then
    v_cost := 100;
    v_hours := 24;
  else
    raise exception 'unknown_item' using errcode = 'P0001';
  end if;

  update public.profiles
  set cosmetic = p_slug,
      cosmetic_expires_at = now() + (v_hours || ' hours')::interval,
      coins = profiles.coins - v_cost,
      updated_at = now()
  where id = auth.uid() and profiles.coins >= v_cost;

  if not found then
    if not exists (select 1 from public.profiles where id = auth.uid()) then
      raise exception 'no_profile' using errcode = 'P0001';
    end if;
    raise exception 'insufficient_coins' using errcode = 'P0001';
  end if;

  return query
    select profiles.cosmetic, profiles.cosmetic_expires_at, profiles.coins::double precision
    from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.purchase_cosmetic(text) to authenticated;

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
    set xp = profiles.xp + v_xp,
        coins = profiles.coins + v_coins
    where id = auth.uid();
  end if;

  return query
    select profiles.xp::double precision, profiles.coins::double precision, v_credited
    from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.room_session_complete(text, integer) to authenticated;

drop function if exists public.room_study_heartbeat(text, boolean, boolean);

create or replace function public.room_study_heartbeat(p_room text, p_running boolean default true, p_reset boolean default false)
returns table (xp double precision, study_seconds integer, coins double precision)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last timestamptz;
  v_seconds integer;
  v_other_seconds integer;
  v_elapsed integer;
  v_is_timer boolean;
  v_old_time_xp numeric;
  v_old_time_coins numeric;
  v_new_time_xp numeric;
  v_new_time_coins numeric;
begin
  if p_room != 'timer' and p_room !~ '^(25-5|20-5|50-10)-[1-9][0-9]*$' then
    raise exception 'unknown_room' using errcode = 'P0001';
  end if;

  v_is_timer := p_room = 'timer';

  if v_is_timer then
    select timer_heartbeat_at, timer_study_seconds, profiles.study_seconds, time_xp, time_coins
      into v_last, v_seconds, v_other_seconds, v_old_time_xp, v_old_time_coins
    from public.profiles where id = auth.uid() for update;
  else
    select profiles.xp_heartbeat_at, profiles.study_seconds, timer_study_seconds, time_xp, time_coins
      into v_last, v_seconds, v_other_seconds, v_old_time_xp, v_old_time_coins
    from public.profiles where id = auth.uid() for update;
  end if;

  if not found then
    raise exception 'no_profile' using errcode = 'P0001';
  end if;

  v_elapsed := case when v_last is null or not p_running or p_reset then 0
    else least(greatest(extract(epoch from (now() - v_last))::integer, 0), 75) end;

  v_seconds := v_seconds + v_elapsed;

  if v_is_timer then
    v_new_time_xp := round(v_other_seconds::numeric / 300, 1) + round(v_seconds::numeric / 3000, 1);
    v_new_time_coins := round(v_other_seconds::numeric / 60, 1) + round(v_seconds::numeric / 600, 1);

    update public.profiles
    set xp = profiles.xp + (v_new_time_xp - v_old_time_xp),
        coins = profiles.coins + (v_new_time_coins - v_old_time_coins),
        time_xp = v_new_time_xp,
        time_coins = v_new_time_coins,
        timer_study_seconds = v_seconds,
        timer_heartbeat_at = case when p_running then now() else null end
    where id = auth.uid();

    return query
      select profiles.xp::double precision, profiles.timer_study_seconds, profiles.coins::double precision
      from public.profiles where id = auth.uid();
  else
    v_new_time_xp := round(v_seconds::numeric / 300, 1) + round(v_other_seconds::numeric / 3000, 1);
    v_new_time_coins := round(v_seconds::numeric / 60, 1) + round(v_other_seconds::numeric / 600, 1);

    update public.profiles
    set xp = profiles.xp + (v_new_time_xp - v_old_time_xp),
        coins = profiles.coins + (v_new_time_coins - v_old_time_coins),
        time_xp = v_new_time_xp,
        time_coins = v_new_time_coins,
        study_seconds = v_seconds,
        xp_heartbeat_at = now()
    where id = auth.uid();

    return query
      select profiles.xp::double precision, profiles.study_seconds, profiles.coins::double precision
      from public.profiles where id = auth.uid();
  end if;
end;
$$;

grant execute on function public.room_study_heartbeat(text, boolean, boolean) to authenticated;
