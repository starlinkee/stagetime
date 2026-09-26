import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { DUMMY_GOLD_REWARD, DUMMY_XP_REWARD, KILL_GOLD_REWARD, KILL_XP_REWARD } from "@realtime-shared/constants";

/**
 * Internal bridge realtime-server uses to persist kill/death counters after it resolves a PvP hit
 * that kills someone, the Arena's own enemy dying, or the lobby's training dummy dying (STU-65;
 * damage only happens outside the lobby otherwise — see AGENTS.md). Both are decided
 * authoritatively by realtime-server, which has no per-user Supabase session to rely on RLS with —
 * mirrors /api/internal/positions: service-role writes gated on a static bearer secret that only
 * Next.js and realtime-server know, never reachable from a browser.
 */
function authorized(request: Request): boolean {
  const secret = process.env.REALTIME_INTERNAL_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body: unknown = await request.json().catch(() => null);
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const killerUserId = typeof record.killerUserId === "string" ? record.killerUserId : null;
  const victimUserId = typeof record.victimUserId === "string" ? record.victimUserId : null;
  // Arena enemy kill (see ARENA_ROOM_SLUG in realtime-server/shared/constants.ts): same xp/gold
  // reward as a PvP kill, but counted separately (mob_kills, 0030) rather than bumping the PvP
  // `kills` stat — it never has a victimUserId (the enemy isn't a player).
  const enemyKill = record.enemyKill === true;
  // STU-65: the lobby's training dummy died — also a mob_kills, not a PvP `kills`, but its own
  // much bigger DUMMY_XP_REWARD/DUMMY_GOLD_REWARD payout instead of the regular one below (see
  // that constant's doc comment for why: chipping through DUMMY_MAX_HP takes a lot more than one
  // regular kill).
  const dummyKill = record.dummyKill === true;
  if (!killerUserId && !victimUserId) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const sb = getSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const calls: PromiseLike<{ error: { message: string } | null }>[] = [];
  if (killerUserId) {
    calls.push(sb.rpc(enemyKill || dummyKill ? "increment_mob_kills" : "increment_kills", { p_user_id: killerUserId }));
    calls.push(
      sb.rpc("award_kill_reward", {
        p_user_id: killerUserId,
        p_xp: dummyKill ? DUMMY_XP_REWARD : KILL_XP_REWARD,
        p_coins: dummyKill ? DUMMY_GOLD_REWARD : KILL_GOLD_REWARD,
      }),
    );
  }
  if (victimUserId) calls.push(sb.rpc("increment_deaths", { p_user_id: victimUserId }));

  const results = await Promise.all(calls);
  for (const { error } of results) {
    if (error) console.warn("internal/combat (see supabase/migrations/0024, 0025)", error);
  }
  return NextResponse.json({ ok: true });
}
