-- First item of a new "consumables" type, sold by the chemist NPC in the Shop
-- (src/components/ShopRoom.tsx): potion of swiftness, +50% move speed for 1 minute. Same
-- "ownership/quantity is a Postgres concern, *use* is realtime-server's job" split as flash
-- grenades (0037) and shurikens (0040/0045) — this is a plain stock column, consume_x is the
-- atomic check-and-decrement the client calls right before telling realtime-server to actually
-- start the timed speed buff (see the "useItem" ClientMessage in realtime-server/src/server.ts) —
-- realtime-server never sees or tracks the potion count itself.
-- Run in Supabase → SQL Editor (jednorazowo), on both production and local.

alter table public.profiles
  add column if not exists potions_of_swiftness integer not null default 0;

-- Atomic check-and-decrement, same WHERE-clause-guard pattern as consume_flash_grenade (0037) —
-- two concurrent "drink" clicks from the same account can't both read a positive count and both
-- succeed, the second simply matches no row once the first has committed.
create or replace function public.consume_potion_of_swiftness()
returns table (potions_of_swiftness integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set potions_of_swiftness = profiles.potions_of_swiftness - 1,
      updated_at = now()
  where id = auth.uid() and profiles.potions_of_swiftness > 0;

  if not found then
    if not exists (select 1 from public.profiles where id = auth.uid()) then
      raise exception 'no_profile' using errcode = 'P0001';
    end if;
    raise exception 'no_potions_of_swiftness' using errcode = 'P0001';
  end if;

  return query
    select profiles.potions_of_swiftness from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.consume_potion_of_swiftness() to authenticated;

-- Chemist shop NPC: buys one potion of swiftness for v_cost coins. Same atomic
-- balance-check-and-deduct shape as buy_shuriken_ammo (0040) — `profiles.` self-references
-- qualified from the start, avoiding the ambiguous-column bug 0029/0032/0039 already hit for the
-- same pattern written unqualified.
create or replace function public.buy_potion_of_swiftness()
returns table (potions_of_swiftness integer, coins double precision)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cost constant numeric := 40;
begin
  update public.profiles
  set potions_of_swiftness = profiles.potions_of_swiftness + 1,
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
    select profiles.potions_of_swiftness, profiles.coins::double precision from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.buy_potion_of_swiftness() to authenticated;
