-- Turns weapon slot 3 (shuriken) into a real equip slot ("extraAttack"), same drag-to-equip
-- gesture as helm/armor/boots (0043/0044) — owning shurikens in the bag is no longer enough to
-- fire them; the stack has to be dragged onto the extraAttack slot first. Unlike gear, this slot
-- holds a quantity (the shuriken stack size), not just a slug, since shurikens are consumed on
-- use (see consume_shuriken_ammo below) while gear never depletes. Run in Supabase → SQL Editor
-- (jednorazowo, po 0049), on both production and local.

alter table public.profiles
  add column if not exists equipped_extra_attack text,
  add column if not exists equipped_extra_attack_qty integer not null default 0;

-- Backfill: nobody should lose a working shuriken attack on deploy day just because the bag
-- stack sat unequipped under the old always-on weapon-3 model — fold any existing "shuriken" bag
-- stack(s) straight into the new slot for anyone who hasn't got something there already.
update public.profiles p
set equipped_extra_attack = 'shuriken',
    equipped_extra_attack_qty = coalesce(
      (select sum(qty) from unnest(p.equipment_bag, p.equipment_bag_qty) as t(slug, qty) where slug = 'shuriken'),
      0
    )
where p.equipped_extra_attack is null
  and exists (select 1 from unnest(p.equipment_bag) as s(slug) where slug = 'shuriken');

update public.profiles p
set equipment_bag = (
      select array_agg(case when b.slug = 'shuriken' then null else b.slug end order by b.ord)
      from unnest(p.equipment_bag) with ordinality as b(slug, ord)
    ),
    equipment_bag_qty = (
      select array_agg(case when b.slug = 'shuriken' then 1 else b.qty end order by b.ord)
      from unnest(p.equipment_bag, p.equipment_bag_qty) with ordinality as b(slug, qty, ord)
    )
where p.equipped_extra_attack = 'shuriken';

-- New signups get the shuriken pre-equipped instead of pre-filled into bag slot 1 (0045's
-- default) — same starting stock (10), just living in the new slot from the start so a fresh
-- account can use weapon slot 3 immediately, same as before this migration. Bag stays the current
-- 8-slot default (0049) — this only changes what's pre-filled, not the size.
alter table public.profiles
  alter column equipment_bag set default array_fill(null::text, array[8]),
  alter column equipment_bag_qty set default array_fill(1, array[8]),
  alter column equipped_extra_attack set default 'shuriken',
  alter column equipped_extra_attack_qty set default 10;

-- equip_from_bag: special-case the "shuriken" slug — moves the whole stack (slug + qty) out of
-- the bag into equipped_extra_attack/_qty, swapping back whatever was equipped there before
-- (again slug + qty, not reset to 1 the way a gear swap is) instead of going through
-- equipment_slot_of (gear-only, raises unknown_item for "shuriken"). Return-type changed (added
-- two columns) — drop first, same as every prior shape change to this function.
drop function if exists public.equip_from_bag(int);

create function public.equip_from_bag(p_bag_index int)
returns table (
  equipped_helm text, equipped_armor text, equipped_boots text,
  equipped_extra_attack text, equipped_extra_attack_qty integer,
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
  v_slot text;
  v_prev_slug text;
  v_prev_qty integer;
begin
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

  if v_slug = 'shuriken' then
    select profiles.equipped_extra_attack, profiles.equipped_extra_attack_qty
      into v_prev_slug, v_prev_qty
      from public.profiles where id = auth.uid();

    update public.profiles
    set equipped_extra_attack = v_slug,
        equipped_extra_attack_qty = coalesce(v_qty[p_bag_index], 1),
        equipment_bag[p_bag_index] = v_prev_slug,
        equipment_bag_qty[p_bag_index] = case when v_prev_slug is null then 1 else greatest(coalesce(v_prev_qty, 1), 1) end,
        updated_at = now()
    where id = auth.uid();
  else
    -- Gear (iron_helm etc.): same shape as before this migration, just returning the two new
    -- extraAttack columns alongside (unaffected by a gear equip/swap).
    v_slot := public.equipment_slot_of(v_slug);

    select case v_slot
      when 'helm' then profiles.equipped_helm
      when 'armor' then profiles.equipped_armor
      when 'boots' then profiles.equipped_boots
    end into v_prev_slug
    from public.profiles where id = auth.uid();

    update public.profiles
    set equipped_helm = case when v_slot = 'helm' then v_slug else profiles.equipped_helm end,
        equipped_armor = case when v_slot = 'armor' then v_slug else profiles.equipped_armor end,
        equipped_boots = case when v_slot = 'boots' then v_slug else profiles.equipped_boots end,
        equipment_bag[p_bag_index] = v_prev_slug,
        equipment_bag_qty[p_bag_index] = 1,
        updated_at = now()
    where id = auth.uid();
  end if;

  return query
    select profiles.equipped_helm, profiles.equipped_armor, profiles.equipped_boots,
           profiles.equipped_extra_attack, profiles.equipped_extra_attack_qty,
           profiles.equipment_bag, profiles.equipment_bag_qty
    from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.equip_from_bag(int) to authenticated;

-- unequip_to_bag: accepts p_slot = 'extraAttack' alongside helm/armor/boots — moves the whole
-- shuriken stack (slug + qty, not reset to 1) back into a specific empty bag slot.
drop function if exists public.unequip_to_bag(text, int);

create function public.unequip_to_bag(p_slot text, p_bag_index int)
returns table (
  equipped_helm text, equipped_armor text, equipped_boots text,
  equipped_extra_attack text, equipped_extra_attack_qty integer,
  equipment_bag text[], equipment_bag_qty integer[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bag text[];
  v_extra_qty integer;
begin
  if p_slot not in ('helm', 'armor', 'boots', 'extraAttack') then
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

  if p_slot = 'extraAttack' then
    select profiles.equipped_extra_attack_qty into v_extra_qty from public.profiles where id = auth.uid();
    update public.profiles
    set equipped_extra_attack = null,
        equipped_extra_attack_qty = 0,
        equipment_bag[p_bag_index] = 'shuriken',
        equipment_bag_qty[p_bag_index] = greatest(coalesce(v_extra_qty, 0), 1),
        updated_at = now()
    where id = auth.uid();
  else
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
  end if;

  if not found then
    raise exception 'no_profile' using errcode = 'P0001';
  end if;

  return query
    select profiles.equipped_helm, profiles.equipped_armor, profiles.equipped_boots,
           profiles.equipped_extra_attack, profiles.equipped_extra_attack_qty,
           profiles.equipment_bag, profiles.equipment_bag_qty
    from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.unequip_to_bag(text, int) to authenticated;

-- buy_shuriken_ammo: tops up the equipped stack directly when a shuriken is already equipped
-- (the common case once a player has equipped one — no need to buy into the bag and re-drag every
-- time), otherwise falls back to the old bag-stack behavior (existing stack, or first empty slot).
drop function if exists public.buy_shuriken_ammo();

create function public.buy_shuriken_ammo()
returns table (
  equipped_extra_attack text, equipped_extra_attack_qty integer,
  equipment_bag text[], equipment_bag_qty integer[], coins double precision
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cost constant numeric := 10;
  v_pack constant integer := 10;
  v_equipped text;
  v_bag text[];
  v_index int;
begin
  select profiles.equipped_extra_attack, profiles.equipment_bag into v_equipped, v_bag from public.profiles where id = auth.uid();
  if v_bag is null then
    raise exception 'no_profile' using errcode = 'P0001';
  end if;

  if v_equipped = 'shuriken' then
    update public.profiles
    set equipped_extra_attack_qty = profiles.equipped_extra_attack_qty + v_pack,
        coins = profiles.coins - v_cost,
        updated_at = now()
    where id = auth.uid() and profiles.coins >= v_cost;
  else
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
  end if;

  if not found then
    raise exception 'insufficient_coins' using errcode = 'P0001';
  end if;

  return query
    select profiles.equipped_extra_attack, profiles.equipped_extra_attack_qty,
           profiles.equipment_bag, profiles.equipment_bag_qty, profiles.coins::double precision
    from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.buy_shuriken_ammo() to authenticated;

-- consume_shuriken_ammo: now decrements the equipped stack instead of scanning the bag — firing
-- weapon slot 3 requires a shuriken to actually be equipped (see the extraAttack slot above), not
-- merely owned somewhere in the bag. Stays equipped at qty 0 (shown as a red "0" in the hotbar,
-- same as the old depleted-ammo look) rather than auto-unequipping, so hitting zero mid-fight
-- doesn't silently bump the player back to weapon slot 1/2.
drop function if exists public.consume_shuriken_ammo();

create function public.consume_shuriken_ammo()
returns table (equipped_extra_attack text, equipped_extra_attack_qty integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text;
  v_qty integer;
begin
  select profiles.equipped_extra_attack, profiles.equipped_extra_attack_qty
    into v_slug, v_qty
    from public.profiles where id = auth.uid();

  if v_slug is distinct from 'shuriken' or coalesce(v_qty, 0) <= 0 then
    raise exception 'no_shuriken_ammo' using errcode = 'P0001';
  end if;

  update public.profiles
  set equipped_extra_attack_qty = v_qty - 1,
      updated_at = now()
  where id = auth.uid();

  return query
    select profiles.equipped_extra_attack, profiles.equipped_extra_attack_qty
    from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.consume_shuriken_ammo() to authenticated;
