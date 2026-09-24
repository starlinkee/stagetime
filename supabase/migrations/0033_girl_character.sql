-- Third character look: "girl" — fixed-art rotation sprites in public/characters/girl/*.png
-- (8 directions, 64x64 native, distinct from "classic"'s 24x24 set in
-- public/characters/player/rotation/). Purely cosmetic, no gameplay effect (see AGENTS.md),
-- same as "classic"/"pixel" (0031). No dedicated roll/jump spritesheet exists for it — the client
-- (src/components/PlayerSprite.tsx) spins the static rotation frame instead, like "pixel" does.
-- Run in Supabase → SQL Editor (jednorazowo, po 0032), on both production and local.

alter table public.profiles
  drop constraint if exists profiles_character_slug_check;
alter table public.profiles
  add constraint profiles_character_slug_check check (character_slug in ('classic', 'pixel', 'girl'));

create or replace function public.purchase_character(p_character text)
returns table (character_slug text, coins double precision)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cost constant numeric := 10;
begin
  if p_character not in ('classic', 'pixel', 'girl') then
    raise exception 'unknown_character' using errcode = 'P0001';
  end if;

  update public.profiles
  set character_slug = p_character,
      updated_at = now()
  where id = auth.uid() and profiles.character_slug = p_character;

  if not found then
    -- The `coins >= v_cost` guard lives in the WHERE clause (not a separate check-then-update),
    -- so two concurrent purchase attempts on the same account can't both read a sufficient
    -- balance and both succeed — the second one simply matches no row once the first has committed.
    update public.profiles
    set character_slug = p_character,
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
    select profiles.character_slug, profiles.coins::double precision
    from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.purchase_character(text) to authenticated;
