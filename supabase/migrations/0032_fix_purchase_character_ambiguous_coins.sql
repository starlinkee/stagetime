-- Bug (reported 2026-09-24): buying/switching character in the shop failed with
--   ERROR: 42702: column reference "coins" is ambiguous
--
-- Same root cause 0029 already fixed for purchase_color_change/purchase_cosmetic/
-- room_session_complete/room_study_heartbeat: purchase_character (0031) declares
-- `returns table (character_slug text, coins double precision)`, which creates implicit
-- plpgsql variables named `character_slug` and `coins`. The bare `character_slug`/`coins`/`id`
-- self-references in the function body are then ambiguous against the `profiles` columns of the
-- same name — 0031 just missed the qualification 0029 already established as the pattern.
--
-- Fix: qualify every self-reference with `profiles.`, matching 0029.
-- Run in Supabase → SQL Editor (jednorazowo, po 0031), on both production and local.

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
