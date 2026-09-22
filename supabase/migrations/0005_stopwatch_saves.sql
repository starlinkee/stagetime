-- Prywatna lista zapisanych czasów stopera (pokój "timer"). Uruchom w Supabase → SQL Editor.

create table if not exists public.stopwatch_saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  room text not null,
  elapsed_ms integer not null check (elapsed_ms >= 0),
  created_at timestamptz not null default now()
);

create index if not exists stopwatch_saves_user_room_idx
  on public.stopwatch_saves (user_id, room, created_at desc);

alter table public.stopwatch_saves enable row level security;

-- Każdy widzi i zapisuje tylko swoje własne czasy.
drop policy if exists "stopwatch_saves_select_own" on public.stopwatch_saves;
create policy "stopwatch_saves_select_own" on public.stopwatch_saves
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "stopwatch_saves_insert_own" on public.stopwatch_saves;
create policy "stopwatch_saves_insert_own" on public.stopwatch_saves
  for insert to authenticated with check (auth.uid() = user_id);
