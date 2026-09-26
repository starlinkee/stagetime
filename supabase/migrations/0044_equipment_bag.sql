-- STU-?? full bag/drag&drop equipment system: buying gear now drops it into a 20-slot bag
-- (equipment_bag, shown as a 4x5 grid in the Tab inventory panel, RoomStage.tsx) instead of
-- auto-equipping it, and equipping/unequipping becomes a drag between a bag slot and a gear slot
-- (helm/armor/boots) — both ends live in this table so a crash mid-drag never loses the item.
-- Supersedes 0043's "owning without equipping doesn't exist in this simple model" note: it now
-- does, via the bag. Run in Supabase → SQL Editor (jednorazowo, po 0043), on both production and
-- local.

alter table public.profiles
  add column if not exists equipment_bag text[] not null default array_fill(null::text, array[20]);

-- Slug → slot/cost lookup, pulled out of purchase_equipment (0043) so equip_from_bag below can
-- reuse it instead of duplicating the same if/elsif chain. Source of truth for these numbers is
-- still EQUIPMENT_ITEMS in realtime-server/shared/constants.ts — keep both in sync by hand.
create or replace function public.equipment_slot_of(p_slug text)
returns text
language plpgsql
immutable
as $$
begin
  if p_slug = 'iron_helm' then return 'helm';
  elsif p_slug = 'iron_armor' then return 'armor';
  elsif p_slug = 'swift_boots' then return 'boots';
  else raise exception 'unknown_item' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.equipment_cost_of(p_slug text)
returns numeric
language plpgsql
immutable
as $$
begin
  if p_slug = 'iron_helm' then return 150;
  elsif p_slug = 'iron_armor' then return 200;
  elsif p_slug = 'swift_boots' then return 150;
  else raise exception 'unknown_item' using errcode = 'P0001';
  end if;
end;
$$;

-- purchase_equipment: now buys INTO the bag (first empty slot) instead of equipping directly —
-- equipping is a separate, free drag gesture (equip_from_bag below). Still free/no-op when already
-- owned, but "owned" now means equipped OR already sitting in the bag (items stay unique per slug).
create or replace function public.purchase_equipment(p_slug text)
returns table (equipped_helm text, equipped_armor text, equipped_boots text, equipment_bag text[], coins double precision)
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

    -- The `coins >= v_cost` guard lives in the WHERE clause (not check-then-update), so two
    -- concurrent purchases can't both read a sufficient balance and both succeed.
    update public.profiles
    set equipment_bag[v_free_index] = p_slug,
        coins = profiles.coins - v_cost,
        updated_at = now()
    where id = auth.uid() and profiles.coins >= v_cost;

    if not found then
      raise exception 'insufficient_coins' using errcode = 'P0001';
    end if;
  end if;

  return query
    select profiles.equipped_helm, profiles.equipped_armor, profiles.equipped_boots, profiles.equipment_bag, profiles.coins::double precision
    from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.purchase_equipment(text) to authenticated;

-- equip_from_bag: the "drag a bag item onto a gear slot" gesture — equips bag[p_bag_index] into
-- its slot, swapping whatever was equipped there (if anything) back into that same bag index, so
-- nothing is ever silently dropped.
create or replace function public.equip_from_bag(p_bag_index int)
returns table (equipped_helm text, equipped_armor text, equipped_boots text, equipment_bag text[])
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
      updated_at = now()
  where id = auth.uid();

  return query
    select profiles.equipped_helm, profiles.equipped_armor, profiles.equipped_boots, profiles.equipment_bag
    from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.equip_from_bag(int) to authenticated;

-- unequip_to_bag: the "drag an equipped item back into an empty bag slot" gesture — replaces
-- 0043's unequip_equipment, which just deleted the item; now that the bag can hold it, plain
-- deletion would lose it for no reason.
create or replace function public.unequip_to_bag(p_slot text, p_bag_index int)
returns table (equipped_helm text, equipped_armor text, equipped_boots text, equipment_bag text[])
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
      updated_at = now()
  where id = auth.uid();

  if not found then
    raise exception 'no_profile' using errcode = 'P0001';
  end if;

  return query
    select profiles.equipped_helm, profiles.equipped_armor, profiles.equipped_boots, profiles.equipment_bag
    from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.unequip_to_bag(text, int) to authenticated;

-- move_bag_item: the "drag within the bag" gesture — swaps two bag slots so items can be
-- reordered without going through a gear slot.
create or replace function public.move_bag_item(p_from_index int, p_to_index int)
returns table (equipment_bag text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bag text[];
  v_len int;
  v_tmp text;
begin
  select profiles.equipment_bag into v_bag from public.profiles where id = auth.uid();
  if v_bag is null then
    raise exception 'no_profile' using errcode = 'P0001';
  end if;
  v_len := array_length(v_bag, 1);
  if p_from_index < 1 or p_from_index > v_len or p_to_index < 1 or p_to_index > v_len then
    raise exception 'bad_index' using errcode = 'P0001';
  end if;

  v_tmp := v_bag[p_from_index];
  update public.profiles
  set equipment_bag[p_from_index] = profiles.equipment_bag[p_to_index],
      equipment_bag[p_to_index] = v_tmp,
      updated_at = now()
  where id = auth.uid();

  return query select profiles.equipment_bag from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.move_bag_item(int, int) to authenticated;

-- Replaced by unequip_to_bag above — deleting an unequipped item is no longer this repo's model.
drop function if exists public.unequip_equipment(text);
