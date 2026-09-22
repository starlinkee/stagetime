-- Naprawia messages_room_slug_valid z 0004: lista nie nadążyła za ROOMS w src/lib/rooms.ts
-- (55-15 zmienił się w "timer") i nigdy nie uwzględniała lobby (RoomStage na stronie głównej).
-- Bez tego INSERT do public.messages z tych pokoi wywala CHECK i czat milczy z generycznym błędem.
-- Uruchom w Supabase → SQL Editor (jednorazowo, po 0005).

alter table public.messages drop constraint if exists messages_room_slug_valid;
alter table public.messages
  add constraint messages_room_slug_valid
  check (room_slug in ('lobby', '25-5', '20-5', '50-10', 'timer')) not valid;
