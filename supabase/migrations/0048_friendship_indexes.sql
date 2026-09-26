-- useFriends.ts loads/subskrybuje friendships przez `.or('requester_id.eq.X,addressee_id.eq.X')`,
-- ale jedyny dotychczasowy indeks (friendships_pair_unique, 0042) jest funkcyjny na
-- (least(...), greatest(...)) i nie da się go użyć do zwykłego równościowego OR po pojedynczej
-- kolumnie — ten odczyt zawsze robił sequential scan. Ten sam wzorzec co direct_messages
-- (0041: sender_id_idx + recipient_id_idx dla analogicznego .or(sender_id.eq,recipient_id.eq)) —
-- Postgres może zbić dwa skany indeksów bitmapowym OR-em.
-- Run in Supabase → SQL Editor (jednorazowo, po 0045), on both production and local.

create index if not exists friendships_requester_idx
  on public.friendships (requester_id);

create index if not exists friendships_addressee_idx
  on public.friendships (addressee_id);
