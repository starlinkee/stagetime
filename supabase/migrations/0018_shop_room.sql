-- Shop room (src/components/ShopRoom.tsx): a place to spend copper coins, next to Timer Room in
-- the lobby. It's another non-pomodoro room slug the chat's CHECK constraint must whitelist —
-- same problem 0006/0011 already fixed for 'lobby'/'timer'.
-- Run in Supabase → SQL Editor (jednorazowo, po 0017), on both production and local.

alter table public.messages drop constraint if exists messages_room_slug_valid;
alter table public.messages
  add constraint messages_room_slug_valid
  check (
    room_slug in ('lobby', 'timer', 'shop')
    or room_slug ~ '^(25-5|20-5|50-10)-[1-9][0-9]*$'
  ) not valid;
