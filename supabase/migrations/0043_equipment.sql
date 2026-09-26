-- STU-77: real gear slots (helm/armor/boots) shown in the Tab inventory panel (RoomStage.tsx).
-- One active item per slot, same "one active slot" shape as `cosmetic` (0027_cosmetic_items.sql),
-- just three independent slots instead of one — buying an item equips it directly, unequipping is
-- free. Unlike cosmetic these carry a real gameplay stat bonus (see EQUIPMENT_ITEMS in
-- realtime-server/shared/constants.ts, the single source of truth for cost/bonus numbers both
-- this RPC and src/app/api/realtime/token/route.ts read from), so ownership/equip stays a Postgres
-- concern here while the *bonus itself* travels to realtime-server signed on the entry token (see
-- mintEntryToken in realtime-server/shared/entryToken.ts) — realtime-server never queries Postgres.
-- Run in Supabase → SQL Editor (jednorazowo, po 0042), on both production and local.

alter table public.profiles
  add column if not exists equipped_helm text,
  add column if not exists equipped_armor text,
  add column if not exists equipped_boots text;

-- Same atomic-RPC shape as purchase_cosmetic (0027): balance check, coin deduction and the equip
-- write happen in one UPDATE, so a crash mid-purchase never lands in a "coins gone, item not
-- equipped" state. Free (no coin check) when the item is already equipped in its slot, same
-- "free re-pick" carve-out as purchase_character (0031) — that's the "already owns it" case,
-- since owning without equipping doesn't exist in this simple one-slot-per-category model.
create or replace function public.purchase_equipment(p_slug text)
returns table (equipped_helm text, equipped_armor text, equipped_boots text, coins double precision)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot text;
  v_cost numeric;
begin
  if p_slug = 'iron_helm' then
    v_slot := 'helm';
    v_cost := 150;
  elsif p_slug = 'iron_armor' then
    v_slot := 'armor';
    v_cost := 200;
  elsif p_slug = 'swift_boots' then
    v_slot := 'boots';
    v_cost := 150;
  else
    raise exception 'unknown_item' using errcode = 'P0001';
  end if;

  -- Already equipped in its own slot: free re-pick, same shape as purchase_character. Bare column
  -- names here are ambiguous against this function's own RETURNS TABLE output parameters (same
  -- bug 0029/0032/0039 already hit for this exact pattern) — qualified from the start.
  update public.profiles
  set updated_at = now()
  where id = auth.uid()
    and (
      (v_slot = 'helm' and profiles.equipped_helm = p_slug)
      or (v_slot = 'armor' and profiles.equipped_armor = p_slug)
      or (v_slot = 'boots' and profiles.equipped_boots = p_slug)
    );

  if not found then
    -- The `coins >= v_cost` guard lives in the WHERE clause (not check-then-update), so two
    -- concurrent purchases can't both read a sufficient balance and both succeed.
    update public.profiles
    set equipped_helm = case when v_slot = 'helm' then p_slug else profiles.equipped_helm end,
        equipped_armor = case when v_slot = 'armor' then p_slug else profiles.equipped_armor end,
        equipped_boots = case when v_slot = 'boots' then p_slug else profiles.equipped_boots end,
        coins = profiles.coins - v_cost,
        updated_at = now()
    where id = auth.uid() and profiles.coins >= v_cost;

    if not found then
      if not exists (select 1 from public.profiles where id = auth.uid()) then
        raise exception 'no_profile' using errcode = 'P0001';
      end if;
      raise exception 'insufficient_coins' using errcode = 'P0001';
    end if;
  end if;

  return query
    select profiles.equipped_helm, profiles.equipped_armor, profiles.equipped_boots, profiles.coins::double precision
    from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.purchase_equipment(text) to authenticated;

-- Free: clearing a slot never costs coins, same as choosing "no cosmetic" would (cosmetic has no
-- such button today only because it expires on its own; equipment has no expiry, so it needs one).
create or replace function public.unequip_equipment(p_slot text)
returns table (equipped_helm text, equipped_armor text, equipped_boots text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_slot not in ('helm', 'armor', 'boots') then
    raise exception 'unknown_slot' using errcode = 'P0001';
  end if;

  update public.profiles
  set equipped_helm = case when p_slot = 'helm' then null else profiles.equipped_helm end,
      equipped_armor = case when p_slot = 'armor' then null else profiles.equipped_armor end,
      equipped_boots = case when p_slot = 'boots' then null else profiles.equipped_boots end,
      updated_at = now()
  where id = auth.uid();

  if not found then
    raise exception 'no_profile' using errcode = 'P0001';
  end if;

  return query
    select profiles.equipped_helm, profiles.equipped_armor, profiles.equipped_boots
    from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.unequip_equipment(text) to authenticated;
