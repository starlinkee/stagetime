-- Second cosmetic item alongside 'flower' (0027): a "shining" sparkle overlay around the player
-- (STU-54). Same single active slot (profiles.cosmetic/cosmetic_expires_at) — buying this just
-- overwrites whatever cosmetic was equipped before, same as buying flower does today.
-- Run in Supabase → SQL Editor (jednorazowo, po 0027), on both production and local.

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
  elsif p_slug = 'sparkles' then
    v_cost := 150;
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
