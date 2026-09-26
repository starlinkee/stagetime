-- Fountain of Wealth: track how much each individual player has donated, so the donate dialog can
-- show "you've donated X coins" (room_funds, added in 0052, only ever held the room-wide total —
-- fine for the shared "Donated: X coins" caption, but there was no per-player breakdown at all).
-- Run in Supabase → SQL Editor (jednorazowo, po 0053), on both production and local.

create table if not exists public.room_fund_donors (
  room text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  total numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (room, user_id)
);

alter table public.room_fund_donors enable row level security;

-- Unlike room_funds' room-wide total (public), a per-player breakdown is only ever shown to that
-- player themselves — restrict select to the donor's own row.
drop policy if exists "room_fund_donors_select_own" on public.room_fund_donors;
create policy "room_fund_donors_select_own" on public.room_fund_donors
  for select using (user_id = auth.uid());

-- Same signature as 0053's donate_to_fountain plus a third return column (my_total): the RPC now
-- also upserts the donor's own running total in the same transaction as the coin deduction and the
-- room_funds credit, so "coins gone but donor total not credited" can't happen either.
create or replace function public.donate_to_fountain(p_amount numeric, p_room text default 'fountain-of-wealth')
returns table (coins double precision, fund_total double precision, my_total double precision)
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

  insert into public.room_fund_donors (room, user_id, total, updated_at)
  values (p_room, auth.uid(), p_amount, now())
  on conflict (room, user_id) do update
    set total = room_fund_donors.total + excluded.total,
        updated_at = now();

  return query
    select profiles.coins::double precision, room_funds.total::double precision, room_fund_donors.total::double precision
    from public.profiles
    join public.room_funds on room_funds.room = p_room
    join public.room_fund_donors on room_fund_donors.room = p_room and room_fund_donors.user_id = auth.uid()
    where profiles.id = auth.uid();
end;
$$;

grant execute on function public.donate_to_fountain(numeric, text) to authenticated;
