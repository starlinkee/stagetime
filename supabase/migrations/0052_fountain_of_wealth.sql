-- Fountain of Wealth: a lobby action zone where a player donates coins into a room-scoped fund.
-- `room_funds` is keyed by room slug (not just "fountain-of-wealth") so a future guild room can
-- reuse the exact same table/RPC instead of a one-off fountain-only column (see AGENTS.md's note
-- on guild rooms). Run in Supabase → SQL Editor (jednorazowo, po 0051), on both production and local.

create table if not exists public.room_funds (
  room text primary key,
  total numeric not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.room_funds enable row level security;

-- Fund totals aren't sensitive — anyone (even signed out) can see how much a room has raised.
drop policy if exists "room_funds_select_all" on public.room_funds;
create policy "room_funds_select_all" on public.room_funds
  for select using (true);

-- Same atomic-RPC shape as purchase_cosmetic (0027): balance check, coin deduction and the fund
-- credit happen in one transaction, so there's no "coins gone but fund not credited" state to land
-- in. p_room defaults to the fountain so today's only caller doesn't need to pass it.
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
  set coins = coins - p_amount,
      updated_at = now()
  where id = auth.uid() and coins >= p_amount;

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
