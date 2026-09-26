-- Gunman's shuriken pack drops from 10 to 2 shurikens per purchase, same 10-coin price (worse
-- deal per shuriken, on purpose) — buy_shuriken_ammo (0045_shuriken_bag_item.sql) is the only
-- place that actually charges the player, so its hardcoded v_pack is what has to change; the
-- client-side SHURIKEN_AMMO_PACK in src/lib/coins.ts is a display-only copy of this value.
drop function if exists public.buy_shuriken_ammo();

create function public.buy_shuriken_ammo()
returns table (equipment_bag text[], equipment_bag_qty integer[], coins double precision)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cost constant numeric := 10;
  v_pack constant integer := 2;
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
