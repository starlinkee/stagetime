import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ROOM_ENTRY_COOKIE, verifyRoomEntryTicket } from "@/lib/roomEntryTicket";

/**
 * Bramka na /rooms/<slug>: bez ważnego, jednorazowego biletu (patrz roomEntryTicket.ts,
 * mintowanego przez POST /api/rooms/enter dopiero po przytrzymaniu E w grze) odsyła do lobby —
 * samo wklejenie/zmiana linku nie wystarcza, żeby wejść do pokoju.
 */
export function proxy(request: NextRequest) {
  const slug = request.nextUrl.pathname.match(/^\/rooms\/([^/]+)$/)?.[1];
  if (!slug) return NextResponse.next();

  const ticket = request.cookies.get(ROOM_ENTRY_COOKIE)?.value;
  if (!verifyRoomEntryTicket(ticket, slug)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const response = NextResponse.next();
  // Ciasteczko zostało ustawione z Path=/rooms (patrz api/rooms/enter) — kasujące ustawienie
  // musi mieć tę samą ścieżkę, inaczej przeglądarka potraktuje je jako osobne ciasteczko i
  // oryginalny bilet przetrwa, pozwalając użyć go ponownie w oknie ważności.
  response.cookies.set(ROOM_ENTRY_COOKIE, "", { path: "/rooms", maxAge: 0 });
  return response;
}

export const config = {
  matcher: "/rooms/:slug",
};
