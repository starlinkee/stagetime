-- STU-74: party system — create a party, invite/accept/decline, leave. One active party per user
-- (party_members has a unique index on user_id), same "one active slot" shape as cosmetic/character
-- elsewhere in this repo. All writes go through security definer RPCs (same house style as
-- buy_potion_of_swiftness etc. in 0056) rather than direct table policies, since membership changes
-- need atomic checks (already-in-a-party, invite still pending) a plain RLS insert policy can't
-- express. Run in Supabase -> SQL Editor (jednorazowo, po 0058).

create table if not exists public.parties (
  id uuid primary key default gen_random_uuid(),
  leader_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.party_members (
  party_id uuid not null references public.parties (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (party_id, user_id)
);

-- One party per user at a time.
create unique index if not exists party_members_user_unique on public.party_members (user_id);

create table if not exists public.party_invites (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties (id) on delete cascade,
  inviter_id uuid not null references auth.users (id) on delete cascade,
  invitee_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint party_invites_no_self check (inviter_id <> invitee_id)
);

-- At most one pending invite per (party, invitee) — re-inviting after a decline is fine, re-inviting
-- while already pending just no-ops (see invite_to_party's `on conflict ... do nothing` below).
create unique index if not exists party_invites_pending_unique
  on public.party_invites (party_id, invitee_id)
  where status = 'pending';

alter table public.parties enable row level security;
alter table public.party_members enable row level security;
alter table public.party_invites enable row level security;

-- Security definer helper (bypasses RLS internally, same as any security definer function owned by
-- the migration role) so party_members'/parties' own select policies below can name "my party" as a
-- single scalar instead of a self-referential subquery on party_members.
create or replace function public.my_party_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select party_id from public.party_members where user_id = auth.uid() limit 1;
$$;
grant execute on function public.my_party_id() to authenticated;

-- Only the party's own members can see the party row or its member list.
drop policy if exists "parties_select_member" on public.parties;
create policy "parties_select_member" on public.parties
  for select using (id = public.my_party_id());

drop policy if exists "party_members_select_member" on public.party_members;
create policy "party_members_select_member" on public.party_members
  for select using (party_id = public.my_party_id());

-- Either side of an invite can see it (inviter to track sent invites, invitee to see/answer it).
drop policy if exists "party_invites_select_participant" on public.party_invites;
create policy "party_invites_select_participant" on public.party_invites
  for select using (auth.uid() = inviter_id or auth.uid() = invitee_id);

-- No insert/update/delete policies on any of the three tables — every write goes through one of
-- the RPCs below, which run security definer and check the caller's own auth.uid() internally.

create or replace function public.create_party()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party_id uuid;
begin
  if public.my_party_id() is not null then
    raise exception 'You are already in a party.';
  end if;
  insert into public.parties (leader_id) values (auth.uid()) returning id into v_party_id;
  insert into public.party_members (party_id, user_id) values (v_party_id, auth.uid());
  return v_party_id;
end;
$$;
grant execute on function public.create_party() to authenticated;

create or replace function public.invite_to_party(p_invitee_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party_id uuid := public.my_party_id();
begin
  if v_party_id is null then
    raise exception 'Create a party first.';
  end if;
  if p_invitee_id = auth.uid() then
    raise exception 'You cannot invite yourself.';
  end if;
  if exists (select 1 from public.party_members where party_id = v_party_id and user_id = p_invitee_id) then
    raise exception 'That player is already in your party.';
  end if;
  insert into public.party_invites (party_id, inviter_id, invitee_id)
  values (v_party_id, auth.uid(), p_invitee_id)
  on conflict (party_id, invitee_id) where status = 'pending' do nothing;
end;
$$;
grant execute on function public.invite_to_party(uuid) to authenticated;

create or replace function public.accept_party_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.party_invites%rowtype;
begin
  select * into v_invite from public.party_invites where id = p_invite_id for update;
  if not found then
    raise exception 'Invite not found.';
  end if;
  if v_invite.invitee_id <> auth.uid() then
    raise exception 'This is not your invite.';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'This invite was already answered.';
  end if;
  if public.my_party_id() is not null then
    raise exception 'Leave your current party first.';
  end if;
  insert into public.party_members (party_id, user_id) values (v_invite.party_id, auth.uid());
  update public.party_invites set status = 'accepted', responded_at = now() where id = p_invite_id;
end;
$$;
grant execute on function public.accept_party_invite(uuid) to authenticated;

create or replace function public.decline_party_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.party_invites
  set status = 'declined', responded_at = now()
  where id = p_invite_id and invitee_id = auth.uid() and status = 'pending';
  if not found then
    raise exception 'Invite not found.';
  end if;
end;
$$;
grant execute on function public.decline_party_invite(uuid) to authenticated;

-- Inviter cancels their own still-pending invite.
create or replace function public.cancel_party_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.party_invites
  where id = p_invite_id and inviter_id = auth.uid() and status = 'pending';
  if not found then
    raise exception 'Invite not found.';
  end if;
end;
$$;
grant execute on function public.cancel_party_invite(uuid) to authenticated;

-- Leaving disbands the party if you were its only member; if you were the leader and others
-- remain, leadership passes to whoever joined earliest.
create or replace function public.leave_party()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party_id uuid := public.my_party_id();
  v_leader_id uuid;
  v_next_leader uuid;
begin
  if v_party_id is null then
    raise exception 'You are not in a party.';
  end if;
  delete from public.party_members where party_id = v_party_id and user_id = auth.uid();
  select leader_id into v_leader_id from public.parties where id = v_party_id;
  if v_leader_id = auth.uid() then
    select user_id into v_next_leader
    from public.party_members
    where party_id = v_party_id
    order by joined_at
    limit 1;
    if v_next_leader is not null then
      update public.parties set leader_id = v_next_leader where id = v_party_id;
    else
      delete from public.parties where id = v_party_id;
    end if;
  end if;
end;
$$;
grant execute on function public.leave_party() to authenticated;

-- Realtime: party composition and invite status changes show up live for everyone involved.
alter publication supabase_realtime add table public.parties;
alter publication supabase_realtime add table public.party_members;
alter publication supabase_realtime add table public.party_invites;
