-- STU-41: 5 separate ball ("kula") skins. Purely decorative (like cosmetic/character_slug), no
-- gameplay effect, and free — unlike cosmetic/character there's no coin cost, so this is a plain
-- column + a direct client update (see saveBallSkin in src/lib/useProfile.ts), not a
-- purchase_*-style RPC. Rides on Presence like cosmetic/character (see Meta.ballSkin in
-- RoomStage.tsx) — realtime-server never needs to know about it.
-- Run in Supabase → SQL Editor (jednorazowo), on both production and local.

alter table public.profiles
  add column if not exists ball_skin text not null default 'classic';

alter table public.profiles
  drop constraint if exists profiles_ball_skin_check;
alter table public.profiles
  add constraint profiles_ball_skin_check
  check (ball_skin in ('classic', 'ring', 'spiky', 'striped', 'halo'));

-- Column-level grant, same as color's own grant in 0004_security_hardening.sql — without this,
-- the direct client-side `.update({ ball_skin })` in saveBallSkin (src/lib/useProfile.ts) is
-- silently rejected by RLS/grants exactly like an ungranted color write would be.
grant update (ball_skin) on public.profiles to authenticated;

