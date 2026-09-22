-- 0006 fixed messages_room_slug_valid to include 'lobby'/'timer', but still checked bare
-- '25-5' / '20-5' / '50-10' — pomodoroVariants() in src/lib/rooms.ts actually emits numbered
-- variants ("25-5-1".."25-5-6", "20-5-1".."20-5-5", "50-10-1".."50-10-6"), none of which matched,
-- so every real pomodoro room insert into public.messages still failed the CHECK.
-- Use a pattern instead of an explicit list so future variant-count changes don't break this again.

alter table public.messages drop constraint if exists messages_room_slug_valid;
alter table public.messages
  add constraint messages_room_slug_valid
  check (
    room_slug in ('lobby', 'timer')
    or room_slug ~ '^(25-5|20-5|50-10)-[1-9][0-9]*$'
  ) not valid;
