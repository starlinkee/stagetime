-- Shurikens become a real backpack item instead of a separate `shuriken_ammo` counter — they now
-- sit in `equipment_bag` (0044) as a stackable slug ("shuriken") with a per-slot quantity, same
-- bag the gear items (iron_helm etc.) already live in. Unlike gear, a bag slot holding "shuriken"
-- can hold more than one unit, so this adds a parallel `equipment_bag_qty` array (same 20 slots,
-- default 1 — meaningless for a non-stackable gear slug, only "shuriken" ever varies it). Run in
-- Supabase → SQL Editor (jednorazowo, po 0044), on both production and local.

alter table public.profiles
  add column if not exists equipment_bag_qty integer[] not null default array_fill(1, array[20]);

-- New signups no longer get shuriken_ammo's `default 10` (column is dropped below) — give them
-- the same starting stock as a pre-filled bag slot 1 instead, so handle_new_user (0002_profiles.sql,
-- which only ever inserts id/nickname and leaves every other column to its default) keeps working
-- unchanged.
alter table public.profiles
  alter column equipment_bag set default array_prepend('shuriken'::text, array_fill(null::text, array[19])),
  alter column equipment_bag_qty set default array_prepend(10, array_fill(1, array[19]));

-- Backfill: move each profile's existing shuriken_ammo stock into the first empty bag slot as a
-- single "shuriken" stack, so nobody's ammo silently disappears when the old column is dropped.
update public.profiles p
set equipment_bag[v.free_index] = 'shuriken',
    equipment_bag_qty[v.free_index] = p.shuriken_ammo
from (
  select id, (select min(i) from generate_subscripts(equipment_bag, 1) as i where equipment_bag[i] is null) as free_index
  from public.profiles
  where shuriken_ammo > 0
) v
where p.id = v.id and v.free_index is not null;

-- purchase_equipment (0044): now also carries equipment_bag_qty alongside equipment_bag so a
-- newly-bought gear item always lands with qty 1 — return-type change (added column), so drop
-- first like 0044 did over 0043.
drop function if exists public.purchase_equipment(text);

create function public.purchase_equipment(p_slug text)
returns table (equipped_helm text, equipped_armor text, equipped_boots text, equipment_bag text[], equipment_bag_qty integer[], coins double precision)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot text := public.equipment_slot_of(p_slug);
  v_cost numeric := public.equipment_cost_of(p_slug);
  v_bag text[];
  v_free_index int;
begin
  select profiles.equipment_bag into v_bag from public.profiles where id = auth.uid();
  if v_bag is null then
    raise exception 'no_profile' using errcode = 'P0001';
  end if;

  update public.profiles
  set updated_at = now()
  where id = auth.uid()
    and (
      (v_slot = 'helm' and profiles.equipped_helm = p_slug)
      or (v_slot = 'armor' and profiles.equipped_armor = p_slug)
      or (v_slot = 'boots' and profiles.equipped_boots = p_slug)
      or p_slug = any(profiles.equipment_bag)
    );

  if not found then
    select min(i) into v_free_index from generate_subscripts(v_bag, 1) as i where v_bag[i] is null;
    if v_free_index is null then
      raise exception 'bag_full' using errcode = 'P0001';
    end if;

    update public.profiles
    set equipment_bag[v_free_index] = p_slug,
        equipment_bag_qty[v_free_index] = 1,
        coins = profiles.coins - v_cost,
        updated_at = now()
    where id = auth.uid() and profiles.coins >= v_cost;

    if not found then
      raise exception 'insufficient_coins' using errcode = 'P0001';
    end if;
  end if;

  return query
    select profiles.equipped_helm, profiles.equipped_armor, profiles.equipped_boots, profiles.equipment_bag, profiles.equipment_bag_qty, profiles.coins::double precision
    from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.purchase_equipment(text) to authenticated;

-- equip_from_bag (0044): swapping gear in/out of a slot always leaves qty 1 behind, whatever ends
-- up sitting in that bag index (either nothing, or the previously-equipped item).
drop function if exists public.equip_from_bag(int);

create function public.equip_from_bag(p_bag_index int)
returns table (equipped_helm text, equipped_armor text, equipped_boots text, equipment_bag text[], equipment_bag_qty integer[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bag text[];
  v_slug text;
  v_slot text;
  v_prev text;
begin
  select profiles.equipment_bag into v_bag from public.profiles where id = auth.uid();
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
  -- equipment_slot_of raises 'unknown_item' for a non-gear slug (e.g. "shuriken") — shurikens are
  -- used directly from the bag, never dragged onto a gear slot.
  v_slot := public.equipment_slot_of(v_slug);

  select case v_slot
    when 'helm' then profiles.equipped_helm
    when 'armor' then profiles.equipped_armor
    when 'boots' then profiles.equipped_boots
  end into v_prev
  from public.profiles where id = auth.uid();

  update public.profiles
  set equipped_helm = case when v_slot = 'helm' then v_slug else profiles.equipped_helm end,
      equipped_armor = case when v_slot = 'armor' then v_slug else profiles.equipped_armor end,
      equipped_boots = case when v_slot = 'boots' then v_slug else profiles.equipped_boots end,
      equipment_bag[p_bag_index] = v_prev,
      equipment_bag_qty[p_bag_index] = 1,
      updated_at = now()
  where id = auth.uid();

  return query
    select profiles.equipped_helm, profiles.equipped_armor, profiles.equipped_boots, profiles.equipment_bag, profiles.equipment_bag_qty
    from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.equip_from_bag(int) to authenticated;

-- unequip_to_bag (0044): dropping gear back into an empty bag slot always sets qty 1 there.
drop function if exists public.unequip_to_bag(text, int);

create function public.unequip_to_bag(p_slot text, p_bag_index int)
returns table (equipped_helm text, equipped_armor text, equipped_boots text, equipment_bag text[], equipment_bag_qty integer[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bag text[];
begin
  if p_slot not in ('helm', 'armor', 'boots') then
    raise exception 'unknown_slot' using errcode = 'P0001';
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

  update public.profiles
  set equipped_helm = case when p_slot = 'helm' then null else profiles.equipped_helm end,
      equipped_armor = case when p_slot = 'armor' then null else profiles.equipped_armor end,
      equipped_boots = case when p_slot = 'boots' then null else profiles.equipped_boots end,
      equipment_bag[p_bag_index] = case p_slot
        when 'helm' then profiles.equipped_helm
        when 'armor' then profiles.equipped_armor
        when 'boots' then profiles.equipped_boots
      end,
      equipment_bag_qty[p_bag_index] = 1,
      updated_at = now()
  where id = auth.uid();

  if not found then
    raise exception 'no_profile' using errcode = 'P0001';
  end if;

  return query
    select profiles.equipped_helm, profiles.equipped_armor, profiles.equipped_boots, profiles.equipment_bag, profiles.equipment_bag_qty
    from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.unequip_to_bag(text, int) to authenticated;

-- move_bag_item (0044): swap the qty array alongside the slug array, same "drag within the bag"
-- reorder gesture — a shuriken stack keeps its count when moved to another slot.
drop function if exists public.move_bag_item(int, int);

create function public.move_bag_item(p_from_index int, p_to_index int)
returns table (equipment_bag text[], equipment_bag_qty integer[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bag text[];
  v_qty integer[];
  v_len int;
  v_tmp_slug text;
  v_tmp_qty integer;
begin
  select profiles.equipment_bag, profiles.equipment_bag_qty into v_bag, v_qty from public.profiles where id = auth.uid();
  if v_bag is null then
    raise exception 'no_profile' using errcode = 'P0001';
  end if;
  v_len := array_length(v_bag, 1);
  if p_from_index < 1 or p_from_index > v_len or p_to_index < 1 or p_to_index > v_len then
    raise exception 'bad_index' using errcode = 'P0001';
  end if;

  v_tmp_slug := v_bag[p_from_index];
  v_tmp_qty := v_qty[p_from_index];
  update public.profiles
  set equipment_bag[p_from_index] = profiles.equipment_bag[p_to_index],
      equipment_bag[p_to_index] = v_tmp_slug,
      equipment_bag_qty[p_from_index] = profiles.equipment_bag_qty[p_to_index],
      equipment_bag_qty[p_to_index] = v_tmp_qty,
      updated_at = now()
  where id = auth.uid();

  return query select profiles.equipment_bag, profiles.equipment_bag_qty from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.move_bag_item(int, int) to authenticated;

-- buy_shuriken_ammo: now grants a pack of 10 into the bag as a "shuriken" stack instead of
-- incrementing the (now-gone) shuriken_ammo column — adds to an existing stack if one is already
-- in the bag, otherwise starts a new one in the first empty slot. Same atomic balance-check-and-
-- deduct shape as before.
drop function if exists public.buy_shuriken_ammo();

create function public.buy_shuriken_ammo()
returns table (equipment_bag text[], equipment_bag_qty integer[], coins double precision)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cost constant numeric := 10;
  v_pack constant integer := 10;
  v_bag text[];
  v_index int;
begin
  select profiles.equipment_bag into v_bag from public.profiles where id = auth.uid();
  if v_bag is null then
    raise exception 'no_profile' using errcode = 'P0001';
  end if;

  select min(i) into v_index from generate_subscripts(v_bag, 1) as i where v_bag[i] = 'shuriken';
  if v_index is null then
    select min(i) into v_index from generate_subscripts(v_bag, 1) as i where v_bag[i] is null;
    if v_index is null then
      raise exception 'bag_full' using errcode = 'P0001';
    end if;
  end if;

  update public.profiles
  set equipment_bag[v_index] = 'shuriken',
      equipment_bag_qty[v_index] = coalesce(profiles.equipment_bag_qty[v_index], 0) + v_pack,
      coins = profiles.coins - v_cost,
      updated_at = now()
  where id = auth.uid() and profiles.coins >= v_cost;

  if not found then
    raise exception 'insufficient_coins' using errcode = 'P0001';
  end if;

  return query
    select profiles.equipment_bag, profiles.equipment_bag_qty, profiles.coins::double precision from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.buy_shuriken_ammo() to authenticated;

-- consume_shuriken_ammo: decrements whichever bag slot holds the "shuriken" stack, same atomic
-- check-and-decrement WHERE-clause guard as before — clears the slot back to empty once its stack
-- hits zero, since a depleted stack is no longer an item sitting in the bag.
drop function if exists public.consume_shuriken_ammo();

create function public.consume_shuriken_ammo()
returns table (equipment_bag text[], equipment_bag_qty integer[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bag text[];
  v_qty integer[];
  v_index int;
  v_new_qty integer;
begin
  select profiles.equipment_bag, profiles.equipment_bag_qty into v_bag, v_qty from public.profiles where id = auth.uid();
  if v_bag is null then
    raise exception 'no_profile' using errcode = 'P0001';
  end if;

  select min(i) into v_index from generate_subscripts(v_bag, 1) as i where v_bag[i] = 'shuriken' and v_qty[i] > 0;
  if v_index is null then
    raise exception 'no_shuriken_ammo' using errcode = 'P0001';
  end if;
  v_new_qty := v_qty[v_index] - 1;

  update public.profiles
  set equipment_bag[v_index] = case when v_new_qty <= 0 then null else 'shuriken' end,
      equipment_bag_qty[v_index] = case when v_new_qty <= 0 then 1 else v_new_qty end,
      updated_at = now()
  where id = auth.uid();

  return query
    select profiles.equipment_bag, profiles.equipment_bag_qty from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.consume_shuriken_ammo() to authenticated;

-- shuriken_ammo is now fully superseded by the bag stack above.
alter table public.profiles drop column if exists shuriken_ammo;
