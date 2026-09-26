-- Public stats: distinct accounts that have signed in at least once, for the "About the game"
-- panel (src/app/api/stats/route.ts). Run in Supabase → SQL Editor (jednorazowo, po 0050).
--
-- auth.users.last_sign_in_at is set on the first successful sign-in and never cleared, so
-- "not null" is exactly "has logged in at least once" (as opposed to count_distinct_players in
-- 0047, which only counts accounts that actually moved a character in a room). auth.users isn't
-- exposed via PostgREST, so this is a security-definer function that only ever returns an
-- aggregate count — no row-level data leaks through it — same pattern as 0047.
create or replace function public.count_logged_in_users()
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::integer from auth.users where last_sign_in_at is not null;
$$;

grant execute on function public.count_logged_in_users() to anon, authenticated;
