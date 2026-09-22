-- Diagnostic only — safe to run, makes no changes. Paste into Supabase SQL Editor (production).
-- Checks whether 0010_xp.sql / 0014_timer_xp_rate.sql / 0015_coins.sql actually landed.

-- 2) Do the reward columns exist on profiles?
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
  and column_name in (
    'xp', 'study_seconds', 'xp_heartbeat_at',
    'timer_study_seconds', 'timer_heartbeat_at',
    'coins', 'coin_seconds', 'timer_coin_seconds'
  )
order by column_name;
-- Expect all 8 rows. Any missing = the corresponding migration didn't run.

-- 3) What does room_study_heartbeat actually look like right now?
select
  p.oid,
  pg_get_function_identity_arguments(p.oid) as args,
  pg_get_function_result(p.oid) as returns
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'room_study_heartbeat';
-- Expect exactly ONE row:
--   args:    p_room text, p_running boolean DEFAULT true
--   returns: TABLE(xp integer, study_seconds integer, coins integer)
-- If you see the OLD single-arg version (text) instead/also, or a returns type without
-- `coins`, the client's rpc() call is either hitting the wrong overload or erroring outright
-- (function does not exist for these arg types) -- and useStudyXp.ts swallows that error
-- silently, which matches "session finished, nothing credited, no visible error".

-- 4) Sanity check the grant is in place for the current signature.
select grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public' and routine_name = 'room_study_heartbeat';
-- Expect a row granting EXECUTE to 'authenticated'.
