-- Shop purchase: character color change for copper coins (see src/components/ShopRoom.tsx).
-- One security-definer function does the balance check, the coin deduction and the color write
-- in a single UPDATE, so the two effects can never happen separately — a browser crash, dropped
-- response or anything else between the click and seeing the result either changed nothing (the
-- request never reached Postgres) or changed both coins and color together (it did and committed).
-- There is no "coins gone but color unchanged" state to land in.
--
-- v_cost must match COLOR_CHANGE_COST in src/lib/coins.ts (that copy is display-only; this one
-- is what actually charges the player).
-- Run in Supabase → SQL Editor (jednorazowo, po 0018), on both production and local.

create or replace function public.purchase_color_change(p_color text)
returns table (color text, coins double precision)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cost constant numeric := 100;
begin
  if p_color !~ '^#[0-9a-f]{6}$' then
    raise exception 'invalid_color' using errcode = 'P0001';
  end if;

  -- The `coins >= v_cost` guard lives in the WHERE clause (not a separate check-then-update), so
  -- two concurrent purchase attempts on the same account can't both read a sufficient balance and
  -- both succeed — the second one simply matches no row once the first has committed.
  update public.profiles
  set color = p_color,
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
    select profiles.color, profiles.coins::double precision
    from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.purchase_color_change(text) to authenticated;
