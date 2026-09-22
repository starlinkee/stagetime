-- Notatka do zapisanego czasu stopera + prawo do jej edycji (tylko własne wiersze).

alter table public.stopwatch_saves add column if not exists note text;

drop policy if exists "stopwatch_saves_update_own" on public.stopwatch_saves;
create policy "stopwatch_saves_update_own" on public.stopwatch_saves
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
