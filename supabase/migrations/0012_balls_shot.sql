-- Stat: how many balls a player has fired (Space release) across all rooms, ever.
-- Run in Supabase → SQL Editor (jednorazowo, po 0011).

alter table public.profiles
  add column if not exists balls_shot integer not null default 0 check (balls_shot >= 0);

-- Called once per real shot (see release() in src/components/RoomStage.tsx). Increment happens
-- server-side so a client can't report an arbitrary count, only how many times it actually fired.
create or replace function public.increment_balls_shot()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balls_shot integer;
begin
  update public.profiles
  set balls_shot = balls_shot + 1
  where id = auth.uid()
  returning balls_shot into v_balls_shot;

  if not found then
    raise exception 'no_profile' using errcode = 'P0001';
  end if;

  return v_balls_shot;
end;
$$;

grant execute on function public.increment_balls_shot() to authenticated;

-- profiles already rides the supabase_realtime publication (migration 0002), so balls_shot
-- updates push to everyone watching a profile live, same as xp.
