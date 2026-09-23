import { NextResponse } from "next/server";
import { getRoom } from "@/lib/rooms";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Internal bridge realtime-server uses to read/save players' last-known position in
 * player_positions (Krok 6 / Faza C in docs/stateful_server_plan.md) — the one legitimate
 * service-role path in this codebase, because the caller acts on behalf of many different users
 * at once with no per-request Supabase session to rely on RLS with (see supabaseAdmin.ts). Gated
 * on a static bearer secret (REALTIME_INTERNAL_SECRET) that only Next.js and realtime-server
 * know — unlike the short-lived per-join token from /api/realtime/token, this one is never sent
 * to a browser, so it can authorize an operation RLS itself can't scope (writing arbitrary
 * userId rows).
 */
function authorized(request: Request): boolean {
  const secret = process.env.REALTIME_INTERNAL_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/** "lobby" isn't in ROOMS (see src/lib/rooms.ts) but is a real place players stand in. */
function isValidRoom(room: unknown): room is string {
  return typeof room === "string" && (room === "lobby" || Boolean(getRoom(room)));
}

const isFiniteNumber = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const isDir = (d: unknown): d is number => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 7;

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");
  const room = searchParams.get("room");
  if (!userId || !isValidRoom(room)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const { data, error } = await sb
    .from("player_positions")
    .select("x, y, d")
    .eq("user_id", userId)
    .eq("room", room)
    .maybeSingle();
  if (error) {
    console.warn("internal/positions GET (see supabase/migrations/0004)", error);
    return NextResponse.json({ position: null });
  }
  if (!data || !Number.isFinite(data.x) || !Number.isFinite(data.y)) {
    return NextResponse.json({ position: null });
  }
  return NextResponse.json({ position: { x: data.x, y: data.y, d: data.d } });
}

type PositionRow = { userId: string; room: string; x: number; y: number; d: number };

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body: unknown = await request.json().catch(() => null);
  const raw =
    body && typeof body === "object" && "positions" in body ? (body as { positions: unknown }).positions : null;
  if (!Array.isArray(raw)) return NextResponse.json({ error: "bad request" }, { status: 400 });

  // Keyed by (userId, room): Postgres's ON CONFLICT DO UPDATE errors (21000) if the same row is
  // targeted twice in one upsert, which happens whenever a batch carries two entries for the same
  // player/room (e.g. a reconnect grace-period ghost alongside the new live connection) — last
  // entry in the batch wins, since it's the most recent tick.
  const rowsByKey = new Map<string, PositionRow>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { userId, room, x, y, d } = entry as Record<string, unknown>;
    if (typeof userId !== "string" || !userId) continue;
    if (!isValidRoom(room)) continue;
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isDir(d)) continue;
    rowsByKey.set(`${userId}:${room}`, { userId, room, x, y, d });
  }
  const rows = [...rowsByKey.values()];
  if (rows.length === 0) return NextResponse.json({ saved: 0 });

  const sb = getSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const { error } = await sb.from("player_positions").upsert(
    rows.map((r) => ({
      user_id: r.userId,
      room: r.room,
      x: r.x,
      y: r.y,
      d: r.d,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "user_id,room" },
  );
  if (error) {
    console.warn("internal/positions POST (see supabase/migrations/0004)", error);
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }
  return NextResponse.json({ saved: rows.length });
}
