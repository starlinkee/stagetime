-- Stat: how many fist swings (melee attack, Space with attack 1 selected) a player has thrown
-- across all rooms, ever. Run in Supabase → SQL Editor (jednorazowo, po 0022).

alter table public.profiles
  add column if not exists fist_swings integer not null default 0 check (fist_swings >= 0);

-- Called once per real swing (see onKeyDown/Space in src/components/RoomStage.tsx). Increment
-- happens server-side so a client can't report an arbitrary count, only how many times it
-- actually swung — mirrors increment_balls_shot from migration 0012.
create or replace function public.increment_fist_swings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fist_swings integer;
begin
  update public.profiles
  set fist_swings = fist_swings + 1
  where id = auth.uid()
  returning fist_swings into v_fist_swings;

  if not found then
    raise exception 'no_profile' using errcode = 'P0001';
  end if;

  return v_fist_swings;
end;
$$;

grant execute on function public.increment_fist_swings() to authenticated;

-- profiles already rides the supabase_realtime publication (migration 0002), so fist_swings
-- updates push to everyone watching a profile live, same as balls_shot.
