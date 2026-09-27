-- STU-35 follow-up: migrate flash grenades onto the same "usable" equip-slot system that potion of
-- swiftness got in 0058_usable_slots.sql. Until now, flash_grenades (0037_flash_grenade_item.sql)
-- was a standalone counter with no bag/inventory presence and no purchase path — is_usable_item
-- only recognized "potion_of_swiftness", so a player who used up their starting 3 grenades had no
-- way to ever get more. Same "ownership/quantity is a Postgres concern, *use* is realtime-server's
-- job" split as before. Run in Supabase -> SQL Editor (jednorazowo, po 0060), on both production
-- and local.

create or replace function public.is_usable_item(p_slug text)
returns boolean
language sql
immutable
as $$
  select p_slug in ('potion_of_swiftness', 'flash_grenade');
$$;

-- Backfill: fold the old plain `flash_grenades` counter into whichever usable slot is free (slot 1
-- first, then slot 2), same idea as 0058's potion-of-swiftness backfill. The old column is left in
-- place (unused from here on) rather than dropped, same as potions_of_swiftness was in 0058.
update public.profiles
set equipped_usable_1 = 'flash_grenade',
    equipped_usable_1_qty = flash_grenades
where equipped_usable_1 is null
  and flash_grenades > 0;

update public.profiles
set equipped_usable_2 = 'flash_grenade',
    equipped_usable_2_qty = flash_grenades
where equipped_usable_1 <> 'flash_grenade'
  and equipped_usable_2 is null
  and flash_grenades > 0;

-- consume_flash_grenade: replaces 0037's version, which only decremented the standalone counter.
-- Same "decrement whichever usable slot holds the stack, slot 1 checked first" shape as
-- consume_potion_of_swiftness (0058) — same "no_flash_grenades" error shape as before so
-- src/lib/useProfile.ts's existing error handling didn't need to change.
drop function if exists public.consume_flash_grenade();

create function public.consume_flash_grenade()
returns table (
  equipped_usable_1 text, equipped_usable_1_qty integer,
  equipped_usable_2 text, equipped_usable_2_qty integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug constant text := 'flash_grenade';
  v_u1 text;
  v_u1_qty integer;
  v_u2 text;
  v_u2_qty integer;
begin
  select profiles.equipped_usable_1, profiles.equipped_usable_1_qty,
         profiles.equipped_usable_2, profiles.equipped_usable_2_qty
    into v_u1, v_u1_qty, v_u2, v_u2_qty
    from public.profiles where id = auth.uid();

  if v_u1 = v_slug and coalesce(v_u1_qty, 0) > 0 then
    update public.profiles
    set equipped_usable_1_qty = v_u1_qty - 1, updated_at = now()
    where id = auth.uid();
  elsif v_u2 = v_slug and coalesce(v_u2_qty, 0) > 0 then
    update public.profiles
    set equipped_usable_2_qty = v_u2_qty - 1, updated_at = now()
    where id = auth.uid();
  else
    if not exists (select 1 from public.profiles where id = auth.uid()) then
      raise exception 'no_profile' using errcode = 'P0001';
    end if;
    raise exception 'no_flash_grenades' using errcode = 'P0001';
  end if;

  return query
    select profiles.equipped_usable_1, profiles.equipped_usable_1_qty,
           profiles.equipped_usable_2, profiles.equipped_usable_2_qty
    from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.consume_flash_grenade() to authenticated;

-- buy_flash_grenades: sold by the gunman NPC alongside shurikens (src/components/ShopRoom.tsx) —
-- same atomic balance-check-and-grant shape as buy_potion_of_swiftness (0058): tops up an
-- already-equipped usable slot directly, otherwise adds to (or starts) a "flash_grenade" stack in
-- the bag; fails with `bag_full` when neither applies and the backpack has no free slot (see
-- purchaseFlashGrenades in src/lib/useProfile.ts).
create function public.buy_flash_grenades()
returns table (
  equipped_usable_1 text, equipped_usable_1_qty integer,
  equipped_usable_2 text, equipped_usable_2_qty integer,
  equipment_bag text[], equipment_bag_qty integer[], coins double precision
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cost constant numeric := 20;
  v_slug constant text := 'flash_grenade';
  v_u1 text;
  v_u2 text;
  v_bag text[];
  v_index int;
begin
  select profiles.equipped_usable_1, profiles.equipped_usable_2, profiles.equipment_bag
    into v_u1, v_u2, v_bag
    from public.profiles where id = auth.uid();
  if v_bag is null then
    raise exception 'no_profile' using errcode = 'P0001';
  end if;

  if v_u1 = v_slug then
    update public.profiles
    set equipped_usable_1_qty = profiles.equipped_usable_1_qty + 1,
        coins = profiles.coins - v_cost,
        updated_at = now()
    where id = auth.uid() and profiles.coins >= v_cost;
  elsif v_u2 = v_slug then
    update public.profiles
    set equipped_usable_2_qty = profiles.equipped_usable_2_qty + 1,
        coins = profiles.coins - v_cost,
        updated_at = now()
    where id = auth.uid() and profiles.coins >= v_cost;
  else
    select min(i) into v_index from generate_subscripts(v_bag, 1) as i where v_bag[i] = v_slug;
    if v_index is null then
      select min(i) into v_index from generate_subscripts(v_bag, 1) as i where v_bag[i] is null;
      if v_index is null then
        raise exception 'bag_full' using errcode = 'P0001';
      end if;
    end if;

    update public.profiles
    set equipment_bag[v_index] = v_slug,
        equipment_bag_qty[v_index] = coalesce(profiles.equipment_bag_qty[v_index], 0) + 1,
        coins = profiles.coins - v_cost,
        updated_at = now()
    where id = auth.uid() and profiles.coins >= v_cost;
  end if;

  if not found then
    raise exception 'insufficient_coins' using errcode = 'P0001';
  end if;

  return query
    select profiles.equipped_usable_1, profiles.equipped_usable_1_qty,
           profiles.equipped_usable_2, profiles.equipped_usable_2_qty,
           profiles.equipment_bag, profiles.equipment_bag_qty, profiles.coins::double precision
    from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.buy_flash_grenades() to authenticated;
