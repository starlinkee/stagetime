-- Profile użytkowników: nickname pokazywany w czacie i na liście obecnych.
-- Uruchom w Supabase → SQL Editor (jednorazowo, po 0001).

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 24),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Nickname widzi każdy (czat czytają też niezalogowani); zmienić może tylko właściciel.
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all" on public.profiles
  for select using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Nazwa startowa z danych dostawcy OAuth, przycięta do limitu kolumny.
create or replace function public.default_nickname(meta jsonb, email text)
returns text
language sql
immutable
as $$
  select left(
    coalesce(
      nullif(meta ->> 'full_name', ''),
      nullif(meta ->> 'name', ''),
      nullif(meta ->> 'preferred_username', ''),
      nullif(split_part(coalesce(email, ''), '@', 1), ''),
      'User'
    ),
    24
  );
$$;

-- Profil powstaje razem z kontem, żeby czat nigdy nie musiał zgadywać nazwy.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nickname)
  values (new.id, public.default_nickname(new.raw_user_meta_data, new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Konta założone przed tą migracją.
insert into public.profiles (id, nickname)
select u.id, public.default_nickname(u.raw_user_meta_data, u.email)
from auth.users u
on conflict (id) do nothing;

-- Realtime: zmiana nicku od razu odświeża czat u wszystkich.
alter publication supabase_realtime add table public.profiles;
