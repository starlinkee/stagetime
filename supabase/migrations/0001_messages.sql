-- Czat pokoi. Uruchom w Supabase → SQL Editor (jednorazowo).

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  room_slug text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Nazwa autora zapisana w chwili wysłania: czat czytają też niezalogowani,
  -- którzy nie mają dostępu do auth.users.
  author text not null,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists messages_room_created_idx
  on public.messages (room_slug, created_at desc);

alter table public.messages enable row level security;

-- Czytać może każdy (także obserwator bez konta); pisać tylko zalogowany, we własnym imieniu.
drop policy if exists "messages_select_all" on public.messages;
create policy "messages_select_all" on public.messages
  for select using (true);

drop policy if exists "messages_insert_own" on public.messages;
create policy "messages_insert_own" on public.messages
  for insert to authenticated with check (auth.uid() = user_id);

-- Realtime: nowe wiadomości trafiają do subskrybentów.
alter publication supabase_realtime add table public.messages;
