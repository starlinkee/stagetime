import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Dowód, że gracz przeszedł przez normalną akcję "trzymaj E w strefie wyjścia" (patrz
 * RoomStage.tsx), a nie po prostu wkleił link do /rooms/<slug>. Bilet mintuje trasa API
 * `POST /api/rooms/enter` i zapisuje jako httpOnly ciasteczko (JS klienta go nie widzi ani nie
 * podrobi); `proxy.ts` weryfikuje go przy każdym żądaniu do /rooms/<slug> i od razu kasuje —
 * jednorazowy, krótko ważny (patrz TICKET_TTL_MS).
 */
export const ROOM_ENTRY_COOKIE = "room_entry_ticket";
const TICKET_TTL_MS = 15_000;

function getSecret(): string {
  const secret = process.env.ROOM_ENTRY_SECRET;
  if (!secret) throw new Error("ROOM_ENTRY_SECRET is not set");
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

export function mintRoomEntryTicket(slug: string): { value: string; maxAgeSeconds: number } {
  const expiresAt = Date.now() + TICKET_TTL_MS;
  const payload = `${slug}:${expiresAt}`;
  return { value: `${payload}:${sign(payload)}`, maxAgeSeconds: Math.ceil(TICKET_TTL_MS / 1000) };
}

export function verifyRoomEntryTicket(cookieValue: string | undefined, slug: string): boolean {
  if (!cookieValue) return false;
  const parts = cookieValue.split(":");
  if (parts.length !== 3) return false;
  const [ticketSlug, expiresAtRaw, signature] = parts;
  if (ticketSlug !== slug) return false;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  const expected = sign(`${ticketSlug}:${expiresAtRaw}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
