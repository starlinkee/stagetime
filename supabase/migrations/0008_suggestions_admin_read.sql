-- Lets the "v_everything" account read the suggestion box. Run in Supabase → SQL Editor (after 0007).

drop policy if exists "suggestions_select_admin" on public.suggestions;
create policy "suggestions_select_admin" on public.suggestions
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.nickname = 'v_everything'
    )
  );
