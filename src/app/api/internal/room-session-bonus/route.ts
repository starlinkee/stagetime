import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Internal bridge realtime-server uses to pay out STU-73's room-population XP/coin bonus once a
 * pomodoro session's work phase ends — mirrors /api/internal/combat. realtime-server is the only
 * process that ever knows how many players were actually in the room instance
 * (`rooms.get(instance.slug)`, see server.ts's work->break transition), so it's the only trusted
 * source for `multiplier`, gated the same way as every other internal bridge: a static bearer
 * secret only Next.js and realtime-server know, never reachable from a browser. The base
 * (unmultiplied) reward keeps flowing through the client's own `room_session_complete` call
 * unchanged — this only ever tops that up, and is idempotent per (user, room, session) via
 * room_session_bonus_credits (0060), so it's safe regardless of call ordering or retries.
 */
function authorized(request: Request): boolean {
  const secret = process.env.REALTIME_INTERNAL_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

type Entry = { userId: string; room: string; cycle: number; multiplier: number };

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body: unknown = await request.json().catch(() => null);
  const raw = body && typeof body === "object" && "entries" in body ? (body as { entries: unknown }).entries : null;
  if (!Array.isArray(raw)) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const entries: Entry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const { userId, room, cycle, multiplier } = e as Record<string, unknown>;
    if (typeof userId !== "string" || !userId) continue;
    if (typeof room !== "string" || !room) continue;
    if (typeof cycle !== "number" || !Number.isFinite(cycle)) continue;
    if (typeof multiplier !== "number" || !Number.isFinite(multiplier)) continue;
    entries.push({ userId, room, cycle, multiplier });
  }
  if (entries.length === 0) return NextResponse.json({ ok: true, credited: 0 });

  const sb = getSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const results = await Promise.all(
    entries.map((e) =>
      sb.rpc("admin_award_room_session_bonus", {
        p_user_id: e.userId,
        p_room: e.room,
        p_cycle: e.cycle,
        p_multiplier: e.multiplier,
      }),
    ),
  );
  let credited = 0;
  for (const { error, data } of results) {
    if (error) {
      console.warn("internal/room-session-bonus (see supabase/migrations/0060)", error);
      continue;
    }
    const row = (Array.isArray(data) ? data[0] : data) as { credited: boolean } | undefined;
    if (row?.credited) credited += 1;
  }
  return NextResponse.json({ ok: true, credited });
}
