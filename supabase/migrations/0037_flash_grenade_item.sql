-- STU-35: first consumable item in this repo (everything under 0027/0035 is a permanent-until-
-- expiry cosmetic slot, not a stock/quantity item — see cosmetic/cosmetic_expires_at). A flash
-- grenade has an actual gameplay effect (blinds the room), unlike a cosmetic, so its *use* is
-- validated by realtime-server (see EMOJI_EMOTES-style cooldown pattern for "emote", and the new
-- "useItem" handler in realtime-server/src/server.ts) — but *ownership/quantity* is a Postgres
-- concern, same as coins, so it lives here.
-- Run in Supabase → SQL Editor (jednorazowo), on both production and local.

alter table public.profiles
  add column if not exists flash_grenades integer not null default 3;

-- Atomic check-and-decrement, same WHERE-clause-guard pattern as purchase_cosmetic (0035) — two
-- concurrent "use" clicks from the same account can't both read a positive count and both
-- succeed, the second simply matches no row once the first has committed.
create or replace function public.consume_flash_grenade()
returns table (flash_grenades integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set flash_grenades = flash_grenades - 1,
      updated_at = now()
  where id = auth.uid() and flash_grenades > 0;

  if not found then
    if not exists (select 1 from public.profiles where id = auth.uid()) then
      raise exception 'no_profile' using errcode = 'P0001';
    end if;
    raise exception 'no_flash_grenades' using errcode = 'P0001';
  end if;

  return query
    select profiles.flash_grenades from public.profiles where id = auth.uid();
end;
$$;

grant execute on function public.consume_flash_grenade() to authenticated;
