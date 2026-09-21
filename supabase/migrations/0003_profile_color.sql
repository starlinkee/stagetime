-- Kolor postaci pixelart użytkownika. Domyślnie biało-szary.
-- Uruchom w Supabase → SQL Editor (jednorazowo, po 0002).

alter table public.profiles
  add column if not exists color text not null default '#d4d4d8'
  check (color ~ '^#[0-9a-f]{6}$');
