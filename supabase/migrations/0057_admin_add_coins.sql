-- Admin panel "add gold to my account" button (src/components/AdminPanel.tsx): lets an account
-- listed in public.admins (0054_admins_table.sql) credit itself copper coins directly, instead of
-- an admin hand-editing the database. Self-only (no p_user_id param) — matches how public.admins'
-- own RLS policy only ever lets a caller see their own row, so there's no path here to add coins
-- to someone else's account either. Run in Supabase -> SQL Editor (jednorazowo, po 0056), on both
-- production and local.

create or replace function public.admin_add_coins(p_amount integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_coins integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.admins where user_id = auth.uid()) then
    raise exception 'not_admin' using errcode = 'P0001';
  end if;

  update public.profiles
  set coins = coins + p_amount,
      updated_at = now()
  where id = auth.uid()
  returning coins into v_new_coins;

  if not found then
    raise exception 'no_profile' using errcode = 'P0001';
  end if;

  return v_new_coins;
end;
$$;

grant execute on function public.admin_add_coins(integer) to authenticated;
