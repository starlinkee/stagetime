-- Player suggestion box (bottom-right button). Run in Supabase → SQL Editor.

create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  body text not null check (char_length(body) between 1 and 1000),
  author text not null check (char_length(author) between 1 and 80),
  created_at timestamptz not null default now()
);

create index if not exists suggestions_created_idx
  on public.suggestions (created_at desc);

alter table public.suggestions enable row level security;

-- Anyone can write, even without an account — this is an anonymous suggestion box.
-- Read intentionally has no policy (default deny): content is only visible in Supabase → Table editor.
drop policy if exists "suggestions_insert_all" on public.suggestions;
create policy "suggestions_insert_all" on public.suggestions
  for insert to anon, authenticated with check (true);
