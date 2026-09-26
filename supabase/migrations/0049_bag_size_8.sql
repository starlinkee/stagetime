-- Shrinks the backpack from 20 slots down to 8 for now (matches the new EQUIPMENT_BAG_SIZE in
-- src/lib/useProfile.ts and the 4x2 grid in RoomStage.tsx's inventory panel). Run in Supabase →
-- SQL Editor (once, after 0045), on both production and local.
--
-- Existing rows may still have a 20-element equipment_bag/equipment_bag_qty array. Compact each
-- one (move non-null items to the front, keeping qty aligned) before truncating to 8, so nothing
-- already owned in slots 1-8 worth of items gets lost — any owned items beyond the new 8-slot cap
-- are dropped (this repo has no real player backpacks deep enough for that to matter yet).

alter table public.profiles
  alter column equipment_bag set default array_fill(null::text, array[8]);

alter table public.profiles
  alter column equipment_bag_qty set default array_fill(1, array[8]);

with compacted as (
  select
    p.id,
    array(
      select item
      from unnest(p.equipment_bag) with ordinality as u(item, ord)
      where item is not null
      order by ord
    ) as items,
    array(
      select coalesce(q.qty, 1)
      from unnest(p.equipment_bag) with ordinality as u(item, ord)
      left join unnest(p.equipment_bag_qty) with ordinality as q(qty, qord) on q.qord = u.ord
      where item is not null
      order by u.ord
    ) as qtys
  from public.profiles p
  where p.equipment_bag is not null
)
update public.profiles p
set equipment_bag = (
      select array(
        select compacted.items[i]
        from generate_series(1, 8) as i
      )
    ),
    equipment_bag_qty = (
      select array(
        select coalesce(compacted.qtys[i], 1)
        from generate_series(1, 8) as i
      )
    )
from compacted
where compacted.id = p.id;
