-- Character (visual look) selection: purely cosmetic, no gameplay effect (see AGENTS.md) — the
-- server has no notion of it at all, exactly like `cosmetic` (0027). Two choices exist today,
-- picked in the Shop (src/components/ShopRoom.tsx) and rendered by CharacterSprite.tsx:
--   'classic' — the fixed-art rotation sprites (public/characters/player/rotation/*.png), default.
--   'pixel'   — the older procedural PixelPerson silhouette (src/components/PixelPerson.tsx).
-- Column/RPC output is named `character_slug`, not `character` — the latter is a reserved SQL
-- keyword (the `character`/`character varying` type name), which Postgres rejects as a bare
-- identifier in a `returns table (...)` column list ("syntax error at or near "character"").
-- Run in Supabase → SQL Editor (jednorazowo, po 0030), on both production and local.

alter table public.profiles
  add column if not exists character_slug text not null default 'classic';

alter table public.profiles
  drop constraint if exists profiles_character_slug_check;
alter table public.profiles
  add constraint profiles_character_slug_check check (character_slug in ('classic', 'pixel'));

-- Same atomic-RPC shape as purchase_color_change (0019)/purchase_cosmetic (0027): balance check,
-- coin deduction and the character write happen in one UPDATE, so there's no "coins gone but
-- character unchanged" state to land in. v_cost must match CHARACTER_CHANGE_COST in
-- src/lib/coins.ts (that copy is display-only; this one is what actually charges the player).
-- No-op switches (picking the character you already have) are free — nothing to charge for.
create or replace function public.purchase_character(p_character text)
returns table (character_slug text, coins double precision)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cost constant numeric := 10;
begin
  if p_character not in ('classic', 'pixel') then
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
        coins = coins - v_cost,
        updated_at = now()
    where id = auth.uid() and coins >= v_cost;

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
