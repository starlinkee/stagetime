-- Third weapon (weapon slot 3, see WEAPON_SLOTS in src/components/RoomStage.tsx): shurikens.
-- Starts at 10, buyable in packs of 10 for 10 copper coins from the gunman NPC in the Shop
-- (src/components/ShopRoom.tsx). Same "ownership/quantity is a Postgres concern, *use* is
-- realtime-server's job" split as flash grenades (0037): shuriken_ammo is a plain stock column,
-- consume_shuriken_ammo() is the atomic check-and-decrement the client calls right before telling
-- realtime-server to actually spawn/fly the projectile (see the "shuriken" ClientMessage in
-- realtime-server/src/server.ts) — realtime-server never sees or tracks the ammo count itself.
-- Run in Supabase → SQL Editor (jednorazowo, po 0039), on both production and local.

alter table public.profiles
  add column if not exists shuriken_ammo integer not null default 10;

-- Atomic check-and-decrement, same WHERE-clause-guard pattern as consume_flash_grenade (0037) —
-- two concurrent throws from the same account can't both read a positive count and both succeed,
-- the second simply matches no row once the first has committed.
create or replace function public.consume_shuriken_ammo()
returns table (shuriken_ammo integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set shuriken_ammo = profiles.shuriken_ammo - 1,
      updated_at = now()
  where id = auth.uid() and profiles.shuriken_ammo > 0;

  if not found then
    if not exists (select 1 from public.profiles where id = auth.uid()) then
      raise exception 'no_profile' using errcode = 'P0001';
    end if;
    raise exception 'no_shuriken_ammo' using errcode = 'P0001';
  end if;

  return query
    select profiles.shuriken_ammo from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.consume_shuriken_ammo() to authenticated;

-- Gunman shop NPC: 10 coins buys 10 more shurikens. Same atomic balance-check-and-deduct shape as
-- purchase_cosmetic (0027/0039) — `profiles.` self-references qualified from the start, avoiding
-- the ambiguous-column bug 0029/0032/0039 already hit for the same pattern written unqualified.
create or replace function public.buy_shuriken_ammo()
returns table (shuriken_ammo integer, coins double precision)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cost constant numeric := 10;
  v_pack constant integer := 10;
begin
  update public.profiles
  set shuriken_ammo = profiles.shuriken_ammo + v_pack,
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
    select profiles.shuriken_ammo, profiles.coins::double precision from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.buy_shuriken_ammo() to authenticated;
