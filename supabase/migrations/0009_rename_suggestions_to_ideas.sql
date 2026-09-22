-- Renames the suggestion box to "ideas". Run in Supabase → SQL Editor (after 0008).

alter table public.suggestions rename to ideas;
alter index suggestions_created_idx rename to ideas_created_idx;
alter policy "suggestions_insert_all" on public.ideas rename to "ideas_insert_all";
alter policy "suggestions_select_admin" on public.ideas rename to "ideas_select_admin";
