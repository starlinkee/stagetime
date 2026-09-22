import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ROOM_ENTRY_COOKIE, verifyRoomEntryTicket } from "@/lib/roomEntryTicket";

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
  // Ciasteczko zostało ustawione z Path=/rooms (patrz api/rooms/enter) — kasujące ustawienie
  // musi mieć tę samą ścieżkę, inaczej przeglądarka potraktuje je jako osobne ciasteczko i
  // oryginalny bilet przetrwa, pozwalając użyć go ponownie w oknie ważności.
  response.cookies.set(ROOM_ENTRY_COOKIE, "", { path: "/rooms", maxAge: 0 });
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
