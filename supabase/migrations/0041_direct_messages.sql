-- Prywatny czat (DM) między dwoma konkretnymi graczami. Uruchom w Supabase → SQL Editor (jednorazowo).

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  constraint direct_messages_no_self_dm check (sender_id <> recipient_id)
);

create index if not exists direct_messages_sender_created_idx
  on public.direct_messages (sender_id, created_at desc);

create index if not exists direct_messages_recipient_created_idx
  on public.direct_messages (recipient_id, created_at desc);

alter table public.direct_messages enable row level security;

-- Widzą tylko nadawca i odbiorca; pisać można tylko we własnym imieniu.
drop policy if exists "direct_messages_select_participant" on public.direct_messages;
create policy "direct_messages_select_participant" on public.direct_messages
  for select using (auth.uid() = sender_id or auth.uid() = recipient_id);

drop policy if exists "direct_messages_insert_own" on public.direct_messages;
create policy "direct_messages_insert_own" on public.direct_messages
  for insert to authenticated with check (auth.uid() = sender_id);

-- Realtime: nowe wiadomości trafiają do subskrybentów.
alter publication supabase_realtime add table public.direct_messages;
