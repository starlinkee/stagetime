import { NextResponse } from "next/server";
import { getRoom } from "@/lib/rooms";
import { getSupabase } from "@/lib/supabase";
import { mintEntryToken } from "@realtime-shared/entryToken";

/**
 * Mints the short-lived signed token realtime-server requires on WS `join` (see
 * docs/stateful_server_plan.md, Faza A / A1). This is the only place `userId` is decided: we
 * verify the caller's Supabase access token server-side instead of trusting whatever userId a
 * WebSocket client would otherwise claim directly. No `Authorization` header (or an invalid one)
 * mints a token with `userId: null` — anonymous play is intentionally still allowed, see
 * RoomStage.tsx.
 */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const slug = body && typeof body === "object" && "roomSlug" in body ? (body as { roomSlug: unknown }).roomSlug : null;
  // "lobby" isn't in ROOMS (it's the implicit default area, see src/lib/rooms.ts) but is a valid
  // place to move around in, so it has to be accepted here too.
  const validSlug = typeof slug === "string" && (slug === "lobby" || Boolean(getRoom(slug)));
  if (!validSlug) {
    return NextResponse.json({ error: "unknown room" }, { status: 400 });
  }

  const secret = process.env.REALTIME_SERVER_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const auth = request.headers.get("authorization");
  const accessToken = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const sb = accessToken ? getSupabase() : null;
  const { data } = accessToken && sb ? await sb.auth.getUser(accessToken) : { data: null };
  const userId = data?.user?.id ?? null;

  return NextResponse.json({ token: mintEntryToken(secret, userId, slug as string) });
}
