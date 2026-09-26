-- STU-?? usable consumable slots: adds two equip slots ("usable1"/"usable2") next to
-- helm/armor/boots/extraAttack (0043/0050) for stackable consumable items — potion of swiftness
-- (0056_potion_of_swiftness.sql) used to live only in a bare `potions_of_swiftness` counter that
-- never showed up anywhere in the Tab inventory panel (a purchase silently bumped a number the
-- player never saw). Same "slug + qty, swap-in-place" shape as
-- equipped_extra_attack/equipped_extra_attack_qty (0050), just two slots instead of one so a
-- player isn't limited to a single equipped consumable type. Run in Supabase → SQL Editor
-- (jednorazowo, po 0057), on both production and local.

alter table public.profiles
  add column if not exists equipped_usable_1 text,
  add column if not exists equipped_usable_1_qty integer not null default 0,
  add column if not exists equipped_usable_2 text,
  add column if not exists equipped_usable_2_qty integer not null default 0;

-- Backfill: fold the old plain `potions_of_swiftness` counter into usable slot 1 for anyone who
-- had stock but nothing equipped there yet, so nobody's existing potions vanish on deploy day.
-- The old column itself is left in place (unused from here on) rather than dropped.
update public.profiles
set equipped_usable_1 = 'potion_of_swiftness',
    equipped_usable_1_qty = potions_of_swiftness
where equipped_usable_1 is null
  and potions_of_swiftness > 0;

-- Recognized usable slugs — pulled out so the RPCs below share one place to extend when a second
-- consumable type is added. Source of truth for cost/effect numbers stays POTION_OF_SWIFTNESS_* in
-- realtime-server/shared/constants.ts / POTION_OF_SWIFTNESS_COST in src/lib/coins.ts.
create or replace function public.is_usable_item(p_slug text)
returns boolean
language sql
immutable
as $$
  select p_slug = 'potion_of_swiftness';
$$;

-- equip_usable_from_bag: drag a bag stack onto usable slot 1 or 2 — same swap-in-place shape as
-- equip_from_bag's shuriken special-case (0050), generalized to a caller-chosen target slot since
-- there are two usable slots instead of one.
create or replace function public.equip_usable_from_bag(p_bag_index int, p_usable_index int)
returns table (
  equipped_usable_1 text, equipped_usable_1_qty integer,
  equipped_usable_2 text, equipped_usable_2_qty integer,
  equipment_bag text[], equipment_bag_qty integer[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bag text[];
  v_qty integer[];
  v_slug text;
  v_prev_slug text;
  v_prev_qty integer;
begin
  if p_usable_index not in (1, 2) then
    raise exception 'bad_usable_index' using errcode = 'P0001';
  end if;

  select profiles.equipment_bag, profiles.equipment_bag_qty into v_bag, v_qty from public.profiles where id = auth.uid();
  if v_bag is null then
    raise exception 'no_profile' using errcode = 'P0001';
  end if;
  if p_bag_index < 1 or p_bag_index > array_length(v_bag, 1) then
    raise exception 'bad_index' using errcode = 'P0001';
  end if;

  v_slug := v_bag[p_bag_index];
  if v_slug is null then
    raise exception 'empty_slot' using errcode = 'P0001';
  end if;
  if not public.is_usable_item(v_slug) then
    raise exception 'not_usable' using errcode = 'P0001';
  end if;

  select case p_usable_index when 1 then profiles.equipped_usable_1 else profiles.equipped_usable_2 end,
         case p_usable_index when 1 then profiles.equipped_usable_1_qty else profiles.equipped_usable_2_qty end
    into v_prev_slug, v_prev_qty
    from public.profiles where id = auth.uid();

  update public.profiles
  set equipped_usable_1 = case when p_usable_index = 1 then v_slug else profiles.equipped_usable_1 end,
      equipped_usable_1_qty = case when p_usable_index = 1 then coalesce(v_qty[p_bag_index], 1) else profiles.equipped_usable_1_qty end,
      equipped_usable_2 = case when p_usable_index = 2 then v_slug else profiles.equipped_usable_2 end,
      equipped_usable_2_qty = case when p_usable_index = 2 then coalesce(v_qty[p_bag_index], 1) else profiles.equipped_usable_2_qty end,
      equipment_bag[p_bag_index] = v_prev_slug,
      equipment_bag_qty[p_bag_index] = case when v_prev_slug is null then 1 else greatest(coalesce(v_prev_qty, 1), 1) end,
      updated_at = now()
  where id = auth.uid();

  return query
    select profiles.equipped_usable_1, profiles.equipped_usable_1_qty,
           profiles.equipped_usable_2, profiles.equipped_usable_2_qty,
           profiles.equipment_bag, profiles.equipment_bag_qty
    from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.equip_usable_from_bag(int, int) to authenticated;

-- unequip_usable_to_bag: drag a usable slot's stack back into a specific empty bag slot.
create or replace function public.unequip_usable_to_bag(p_usable_index int, p_bag_index int)
returns table (
  equipped_usable_1 text, equipped_usable_1_qty integer,
  equipped_usable_2 text, equipped_usable_2_qty integer,
  equipment_bag text[], equipment_bag_qty integer[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bag text[];
  v_slug text;
  v_qty integer;
begin
  if p_usable_index not in (1, 2) then
    raise exception 'bad_usable_index' using errcode = 'P0001';
  end if;

  select profiles.equipment_bag into v_bag from public.profiles where id = auth.uid();
  if v_bag is null then
    raise exception 'no_profile' using errcode = 'P0001';
  end if;
  if p_bag_index < 1 or p_bag_index > array_length(v_bag, 1) then
    raise exception 'bad_index' using errcode = 'P0001';
  end if;
  if v_bag[p_bag_index] is not null then
    raise exception 'slot_occupied' using errcode = 'P0001';
  end if;

  select case p_usable_index when 1 then profiles.equipped_usable_1 else profiles.equipped_usable_2 end,
         case p_usable_index when 1 then profiles.equipped_usable_1_qty else profiles.equipped_usable_2_qty end
    into v_slug, v_qty
    from public.profiles where id = auth.uid();

  if v_slug is null then
    raise exception 'empty_slot' using errcode = 'P0001';
  end if;

  update public.profiles
  set equipped_usable_1 = case when p_usable_index = 1 then null else profiles.equipped_usable_1 end,
      equipped_usable_1_qty = case when p_usable_index = 1 then 0 else profiles.equipped_usable_1_qty end,
      equipped_usable_2 = case when p_usable_index = 2 then null else profiles.equipped_usable_2 end,
      equipped_usable_2_qty = case when p_usable_index = 2 then 0 else profiles.equipped_usable_2_qty end,
      equipment_bag[p_bag_index] = v_slug,
      equipment_bag_qty[p_bag_index] = greatest(coalesce(v_qty, 1), 1),
      updated_at = now()
  where id = auth.uid();

  if not found then
    raise exception 'no_profile' using errcode = 'P0001';
  end if;

  return query
    select profiles.equipped_usable_1, profiles.equipped_usable_1_qty,
           profiles.equipped_usable_2, profiles.equipped_usable_2_qty,
           profiles.equipment_bag, profiles.equipment_bag_qty
    from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.unequip_usable_to_bag(int, int) to authenticated;

-- buy_potion_of_swiftness: replaces 0056's version, which only bumped the standalone
-- `potions_of_swiftness` counter — never shown anywhere in the inventory. Tops up an
-- already-equipped usable slot directly (mirrors buy_shuriken_ammo's "top up if equipped"
-- shortcut), otherwise adds to (or starts) a "potion_of_swiftness" stack in the bag; fails with
-- `bag_full` when neither usable slot holds a potion stack and the bag has no existing stack and
-- no free slot — this is what lets the client refuse the purchase outright when the backpack is
-- full (see purchasePotionOfSwiftness in src/lib/useProfile.ts).
drop function if exists public.buy_potion_of_swiftness();

create function public.buy_potion_of_swiftness()
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
  v_cost constant numeric := 40;
  v_slug constant text := 'potion_of_swiftness';
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

grant execute on function public.buy_potion_of_swiftness() to authenticated;

-- consume_potion_of_swiftness: decrements whichever usable slot holds the potion stack (slot 1
-- checked first), instead of the old standalone counter — same "no_potions_of_swiftness" error
-- shape as before so src/lib/useProfile.ts's existing error handling didn't need to change.
drop function if exists public.consume_potion_of_swiftness();

create function public.consume_potion_of_swiftness()
returns table (
  equipped_usable_1 text, equipped_usable_1_qty integer,
  equipped_usable_2 text, equipped_usable_2_qty integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug constant text := 'potion_of_swiftness';
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
    raise exception 'no_potions_of_swiftness' using errcode = 'P0001';
  end if;

  return query
    select profiles.equipped_usable_1, profiles.equipped_usable_1_qty,
           profiles.equipped_usable_2, profiles.equipped_usable_2_qty
    from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.consume_potion_of_swiftness() to authenticated;
