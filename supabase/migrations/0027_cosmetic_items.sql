-- Cosmetic items: purely decorative, timed unlocks bought with copper coins (see AGENTS.md —
-- these carry zero gameplay effect, unlike HP/combat, so unlike purchase_color_change there's no
-- shared-state/realtime-server involvement at all: a cosmetic just rides along on the same
-- Presence "meta" (nick/color) every other player already reads, see Meta in RoomStage.tsx).
-- One active slot per profile (cosmetic + cosmetic_expires_at) — buying any item just overwrites
-- both columns, which is enough for a single "hat slot" and avoids inventory/stacking complexity
-- until there's an actual second concurrent slot to justify it.
-- Run in Supabase → SQL Editor (jednorazowo, po 0026), on both production and local.

alter table public.profiles
  add column if not exists cosmetic text,
  add column if not exists cosmetic_expires_at timestamptz;

-- Same atomic-RPC shape as purchase_color_change (0019): balance check, coin deduction and the
-- cosmetic write happen in one UPDATE, so there's no "coins gone but item not granted" state to
-- land in. Cost/duration are hardcoded per slug here (not client-supplied) for the same reason
-- v_cost is a constant in 0019 — a client could otherwise buy any item for any price.
create or replace function public.purchase_cosmetic(p_slug text)
returns table (cosmetic text, cosmetic_expires_at timestamptz, coins double precision)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cost numeric;
  v_hours numeric;
begin
  if p_slug = 'flower' then
    v_cost := 100;
    v_hours := 24;
  else
    raise exception 'unknown_item' using errcode = 'P0001';
  end if;

  -- The `coins >= v_cost` guard lives in the WHERE clause (not a separate check-then-update), so
  -- two concurrent purchase attempts on the same account can't both read a sufficient balance and
  -- both succeed — the second one simply matches no row once the first has committed.
  update public.profiles
  set cosmetic = p_slug,
      cosmetic_expires_at = now() + (v_hours || ' hours')::interval,
      coins = coins - v_cost,
      updated_at = now()
  where id = auth.uid() and coins >= v_cost;

  if not found then
    if not exists (select 1 from public.profiles where id = auth.uid()) then
      raise exception 'no_profile' using errcode = 'P0001';
    end if;
    raise exception 'insufficient_coins' using errcode = 'P0001';
  end if;

  return query
    select profiles.cosmetic, profiles.cosmetic_expires_at, profiles.coins::double precision
    from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.purchase_cosmetic(text) to authenticated;
