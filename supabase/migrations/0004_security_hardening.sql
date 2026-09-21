-- Utwardzenie czatu i profili. Uruchom w Supabase → SQL Editor (jednorazowo, po 0003).

-- 1. Autor wiadomości pochodzi z bazy, nie od klienta ------------------------
-- Dotąd klient sam wpisywał `author`, więc mógł podszyć się pod dowolną osobę.
create or replace function public.messages_set_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select p.nickname into new.author from public.profiles p where p.id = new.user_id;
  if new.author is null then
    new.author := 'User';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_set_author on public.messages;
create trigger messages_set_author
  before insert on public.messages
  for each row execute function public.messages_set_author();

-- 2. Tylko istniejące pokoje + limit częstotliwości --------------------------
-- Lista musi odpowiadać ROOMS w src/lib/rooms.ts. NOT VALID: stare wiersze
-- z nieznanym pokojem nie blokują migracji, a nowe są już sprawdzane.
alter table public.messages drop constraint if exists messages_room_slug_valid;
alter table public.messages
  add constraint messages_room_slug_valid
  check (room_slug in ('25-5', '20-5', '50-10', '55-15')) not valid;

-- Max 1 wiadomość na 1 s i 15 na minutę na użytkownika.
create or replace function public.messages_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.messages
    where user_id = new.user_id and created_at > now() - interval '1 second'
  ) or (
    select count(*) from public.messages
    where user_id = new.user_id and created_at > now() - interval '1 minute'
  ) >= 15 then
    raise exception 'rate_limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_rate_limit on public.messages;
create trigger messages_rate_limit
  before insert on public.messages
  for each row execute function public.messages_rate_limit();

-- 3. Nick zmienia tylko serwer -----------------------------------------------
-- Klient może zmieniać wyłącznie kolor. Nick powstaje w triggerze przy rejestracji,
-- a późniejsza zmiana (np. za kredyty) ma iść przez funkcję security definer,
-- która sprawdzi saldo — nie przez bezpośredni UPDATE z przeglądarki.
drop policy if exists "profiles_insert_own" on public.profiles;

revoke insert, update on public.profiles from anon, authenticated;
grant update (color, updated_at) on public.profiles to authenticated;
