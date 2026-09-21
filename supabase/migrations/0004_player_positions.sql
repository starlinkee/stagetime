-- Ostatnia pozycja postaci zalogowanego użytkownika w każdym pokoju.
-- Dzięki temu kolejne okno / przeglądarka na tym samym koncie pokazuje postać tam, gdzie ją zostawiono.
-- Uruchom w Supabase → SQL Editor (jednorazowo, po 0003).

create table if not exists public.player_positions (
  user_id uuid not null references auth.users (id) on delete cascade,
  room text not null,
  x real not null,
  y real not null,
  -- Kierunek 0–7 (jak `Dir` w PixelPerson).
  d smallint not null default 2 check (d between 0 and 7),
  updated_at timestamptz not null default now(),
  primary key (user_id, room)
);

alter table public.player_positions enable row level security;

-- Pozycję widzi i zapisuje tylko właściciel (inni dostają ją przez Realtime).
drop policy if exists "player_positions_select_own" on public.player_positions;
create policy "player_positions_select_own" on public.player_positions
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "player_positions_insert_own" on public.player_positions;
create policy "player_positions_insert_own" on public.player_positions
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "player_positions_update_own" on public.player_positions;
create policy "player_positions_update_own" on public.player_positions
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
