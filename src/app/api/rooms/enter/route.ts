import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getRoom } from "@/lib/rooms";
import { mintRoomEntryTicket, ROOM_ENTRY_COOKIE } from "@/lib/roomEntryTicket";
import { getSupabase } from "@/lib/supabase";
import { getTimerState } from "@/lib/timer";

/**
 * Wywoływane z RoomStage.tsx dopiero po przytrzymaniu E w strefie wyjścia przez roomEnterMs() —
 * dopiero to mintuje bilet wejścia, który `proxy.ts` sprawdza przy /rooms/<slug>. Sam POST tutaj
 * (bez uprzedniego przejścia tej ścieżki w grze) nie da bezpośredniego wejścia na stronę pokoju,
 * ale legalny klient zawsze najpierw trafia tędy — to on rozdaje bilety.
 */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const slug = body && typeof body === "object" && "slug" in body ? (body as { slug: unknown }).slug : null;
  const room = typeof slug === "string" ? getRoom(slug) : undefined;
  if (typeof slug !== "string" || !room) {
    return NextResponse.json({ error: "unknown room" }, { status: 400 });
  }

  // Pokoje pomodoro wpuszczają tylko na przerwie — stopwatch (bez fazy work/break) nie podlega.
  if (room.kind === "pomodoro" && getTimerState(Date.now(), room).phase === "work") {
    return NextResponse.json({ error: "work-in-progress" }, { status: 403 });
  }

  // Shop wymaga konta — RoomStage.tsx blokuje to już po stronie klienta (kwadrat pokazuje kłódkę
  // i nie wysyła w ogóle tego żądania bez sesji), to tylko druga linia obrony, żeby samo POST-owanie
  // /api/rooms/enter bez konta nie dało biletu. Zakupy same w sobie i tak są chronione przez
  // RLS/security-definer w bazie (auth.uid()), niezależnie od tego biletu.
  if (room.kind === "shop") {
    const auth = request.headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    const sb = token ? getSupabase() : null;
    const { data } = token && sb ? await sb.auth.getUser(token) : { data: null };
    if (!data?.user) {
      return NextResponse.json({ error: "auth-required" }, { status: 401 });
    }
  }

  const ticket = mintRoomEntryTicket(slug);
  const cookieStore = await cookies();
  cookieStore.set(ROOM_ENTRY_COOKIE, ticket.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/rooms",
    maxAge: ticket.maxAgeSeconds,
  });

  return NextResponse.json({ ok: true });
}
