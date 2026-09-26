-- STU-83: generalizes the hardcoded 'v_everything' nickname check (see
-- 0008_suggestions_admin_read.sql) into a real admin roster, so the admin panel
-- (src/components/AdminPanel.tsx) can be gated on "is this account an admin" instead of "is this
-- not production" — see isAdminUiEnabled()'s updated doc comment. Run in Supabase → SQL Editor
-- (jednorazowo, po 0053), on both production and local.
create table if not exists public.admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

-- A signed-in user can only ever check their own row (never list who else is an admin) — enough
-- for the client to decide whether to show the admin button.
drop policy if exists "admins_select_own" on public.admins;
create policy "admins_select_own" on public.admins
  for select to authenticated
  using (user_id = auth.uid());

-- Seed the existing hardcoded admin account so nothing regresses.
insert into public.admins (user_id)
select id from public.profiles where nickname = 'v_everything'
on conflict (user_id) do nothing;
