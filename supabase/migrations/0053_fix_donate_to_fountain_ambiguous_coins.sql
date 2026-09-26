-- Bug (reported 2026-09-26): "Donation failed: column reference "coins" is ambiguous" when
-- donating at the Fountain of Wealth.
--
-- Same root cause 0029/0032/0039 already fixed for purchase_color_change/room_session_complete/
-- room_study_heartbeat/purchase_character/purchase_cosmetic: donate_to_fountain (0052) declares
-- `returns table (coins double precision, fund_total double precision)`, which creates an
-- implicit plpgsql variable named `coins`. The bare `coins` self-references in the UPDATE's SET
-- and WHERE clauses are then ambiguous against the `profiles.coins` column — 0052 just missed the
-- qualification 0029/0032/0039 already established as the pattern.
--
-- Fix: qualify every self-reference with `profiles.`, matching 0039.
-- Run in Supabase → SQL Editor (jednorazowo, po 0052), on both production and local.

create or replace function public.donate_to_fountain(p_amount numeric, p_room text default 'fountain-of-wealth')
returns table (coins double precision, fund_total double precision)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;

  -- The `coins >= p_amount` guard lives in the WHERE clause (not a separate check-then-update),
  -- so two concurrent donations from the same account can't both read a sufficient balance and
  -- both succeed — the second simply matches no row once the first has committed.
  update public.profiles
  set coins = profiles.coins - p_amount,
      updated_at = now()
  where id = auth.uid() and profiles.coins >= p_amount;

  if not found then
    if not exists (select 1 from public.profiles where id = auth.uid()) then
      raise exception 'no_profile' using errcode = 'P0001';
    end if;
    raise exception 'insufficient_coins' using errcode = 'P0001';
  end if;

  insert into public.room_funds (room, total, updated_at)
  values (p_room, p_amount, now())
  on conflict (room) do update
    set total = room_funds.total + excluded.total,
        updated_at = now();

  return query
    select profiles.coins::double precision, room_funds.total::double precision
    from public.profiles
    join public.room_funds on room_funds.room = p_room
    where profiles.id = auth.uid();
end;
$$;

grant execute on function public.donate_to_fountain(numeric, text) to authenticated;
