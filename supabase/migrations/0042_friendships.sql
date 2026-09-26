-- Lista znajomych: wzajemne zaproszenia (requester wysyła, addressee akceptuje/odrzuca).
-- Uruchom w Supabase → SQL Editor (jednorazowo, po 0041).

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users (id) on delete cascade,
  addressee_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friendships_no_self_friend check (requester_id <> addressee_id)
);

-- Jedna para użytkowników = jeden wiersz, niezależnie od tego, kto był requesterem.
create unique index if not exists friendships_pair_unique
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

alter table public.friendships enable row level security;

-- Widzą tylko obie strony relacji.
drop policy if exists "friendships_select_participant" on public.friendships;
create policy "friendships_select_participant" on public.friendships
  for select using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Zaproszenie może wysłać tylko requester, we własnym imieniu.
drop policy if exists "friendships_insert_own" on public.friendships;
create policy "friendships_insert_own" on public.friendships
  for insert to authenticated with check (auth.uid() = requester_id);

-- Status (accept/decline) zmienia dowolna ze stron — w praniu tylko addressee ma po co to robić,
-- ale requester też może np. odrzucić własne, jeszcze nieodebrane zaproszenie.
drop policy if exists "friendships_update_participant" on public.friendships;
create policy "friendships_update_participant" on public.friendships
  for update to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id)
  with check (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Cofnięcie własnego, jeszcze nierozpatrzonego zaproszenia.
drop policy if exists "friendships_delete_requester" on public.friendships;
create policy "friendships_delete_requester" on public.friendships
  for delete to authenticated using (auth.uid() = requester_id);

-- Realtime: zaproszenia i ich akceptacja/odrzucenie widać od razu u obu stron.
alter publication supabase_realtime add table public.friendships;
