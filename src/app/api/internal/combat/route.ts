import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { KILL_GOLD_REWARD, KILL_XP_REWARD } from "@realtime-shared/constants";

/**
 * Internal bridge realtime-server uses to persist kill/death counters after it resolves a PvP hit
 * that kills someone (damage only happens outside the lobby — see AGENTS.md). Kills/deaths are
 * decided authoritatively by realtime-server, which has no per-user Supabase session to rely on
 * RLS with — mirrors /api/internal/positions: service-role writes gated on a static bearer secret
 * that only Next.js and realtime-server know, never reachable from a browser.
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
  if (!killerUserId && !victimUserId) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const sb = getSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const calls: PromiseLike<{ error: { message: string } | null }>[] = [];
  if (killerUserId) {
    calls.push(sb.rpc("increment_kills", { p_user_id: killerUserId }));
    calls.push(sb.rpc("award_kill_reward", { p_user_id: killerUserId, p_xp: KILL_XP_REWARD, p_coins: KILL_GOLD_REWARD }));
  }
  if (victimUserId) calls.push(sb.rpc("increment_deaths", { p_user_id: victimUserId }));

  const results = await Promise.all(calls);
  for (const { error } of results) {
    if (error) console.warn("internal/combat (see supabase/migrations/0024, 0025)", error);
  }
  return NextResponse.json({ ok: true });
}
