import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { mintRoomEntryTicket, ROOM_ENTRY_COOKIE, verifyRoomEntryTicket } from "@/lib/roomEntryTicket";

const UNSUPPORTED_DEVICE_PATH = "/unsupported-device";

// Telefony (Android/iPhone/iPod i inne mobilne UA). Celowo bez iPad/tabletów — te mają
// wystarczająco duży ekran, żeby gra była grywalna.
const MOBILE_UA_RE = /Android|iPhone|iPod|Windows Phone|BlackBerry|IEMobile|Opera Mini/i;

function isBlockedMobileRequest(request: NextRequest) {
  if (request.nextUrl.pathname === UNSUPPORTED_DEVICE_PATH) return false;
  const ua = request.headers.get("user-agent") ?? "";
  return MOBILE_UA_RE.test(ua);
}

/**
 * Bramka na /rooms/<slug>: bez ważnego, jednorazowego biletu (patrz roomEntryTicket.ts,
 * mintowanego przez POST /api/rooms/enter dopiero po przytrzymaniu E w grze) odsyła do lobby —
 * samo wklejenie/zmiana linku nie wystarcza, żeby wejść do pokoju.
 */
export function proxy(request: NextRequest) {
  if (isBlockedMobileRequest(request)) {
    return NextResponse.redirect(new URL(UNSUPPORTED_DEVICE_PATH, request.url));
  }

  const slug = request.nextUrl.pathname.match(/^\/rooms\/([^/]+)$/)?.[1];
  if (!slug) return NextResponse.next();

  const ticket = request.cookies.get(ROOM_ENTRY_COOKIE)?.value;
  if (!verifyRoomEntryTicket(ticket, slug)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const response = NextResponse.next();
  // STU-43: re-mint a fresh one-time ticket for the same slug instead of just deleting it. The
  // old behavior (delete, no replacement) made the ticket single-use across the room's entire
  // lifetime, not just single-use per request — so a page refresh (which re-requests this exact
  // route through this same middleware) always found no ticket and got bounced to "/", no matter
  // how legitimately the player was already sitting in that room. Rolling the ticket forward on
  // every successful check keeps the original anti-skip property intact (a URL that was never
  // routed through POST /api/rooms/enter still has no ticket on its very first request, so it
  // still gets redirected) while letting an already-validated room keep re-authorizing itself
  // indefinitely, so refresh/reconnect (see NET_KEY_STORAGE_KEY/GRACE_MS in RoomStage.tsx and
  // realtime-server/src/server.ts) actually gets a chance to run instead of never loading the
  // page at all.
  const fresh = mintRoomEntryTicket(slug);
  response.cookies.set(ROOM_ENTRY_COOKIE, fresh.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/rooms",
    maxAge: fresh.maxAgeSeconds,
  });
  return response;
}

export const config = {
  matcher: [
    "/rooms/:slug",
    /*
     * Blokada telefonów obejmuje resztę serwisu (lobby, ideas itd.), ale pomija API,
     * assety Next.js i pliki statyczne — te nie renderują gry i nie powinny być blokowane.
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
