/**
 * Room roster + lobby-grid layout, enough to answer "where in the lobby is room X's zone" —
 * needed so a player leaving a room back into the lobby can spawn at that room's own zone
 * instead of a generic default (see the "join" handler in ../src/server.ts, which has no other
 * way to learn which room a fresh connection just came from).
 *
 * Every slug and every layout constant below must match src/lib/rooms.ts (ROOMS / EXIT_ZONE) and
 * the ring built in src/app/page.tsx (RING_CENTER_X/Y, RING_RADIUS, RING_ANGLES_DEG, zone sizes) —
 * this is a second copy of that layout, kept here only because this server is a separate deploy
 * that can't import Next.js code. If you change the lobby ring or the room roster on the Next.js
 * side, update this file to match, or exit-to-lobby spawn silently falls out of sync again.
 *
 * That page.tsx grid is defined in "start screen" coordinates (0..SCREEN_W/H) — RoomStage.tsx
 * only turns it into actual world coordinates at render time, via `toWorldZone(z, CONTENT_OX,
 * CONTENT_OY)`, since the lobby's world is 2x the screen in each dimension (see worldW/worldH in
 * constants.ts). LOBBY_ZONE_RECTS below is already shifted by that same CONTENT_OX/OY, so it's
 * directly usable as a world position — don't add the offset again at the call site.
 */

import { SCREEN_W, SCREEN_H, worldH } from "./constants";

export type RoomKind = "pomodoro" | "stopwatch" | "shop" | "arena";

interface RoomMeta {
  slug: string;
  kind: RoomKind;
  workMin?: number;
  breakMin?: number;
}

/**
 * STU-56: every location that behaves like a lobby (2x world size, no combat damage, safe
 * respawn/reconnect home) — was a single hardcoded `"lobby"` literal scattered across server.ts
 * and RoomStage.tsx until lobby2 needed the same behavior. Both files import `isLobbySlug` instead
 * of re-hardcoding the string, so a third location only needs an entry here.
 */
export const LOBBY_SLUGS: ReadonlySet<string> = new Set(["lobby", "lobby2"]);
export function isLobbySlug(slug: string): boolean {
  return LOBBY_SLUGS.has(slug);
}

/**
 * STU-65: the training dummy (see DUMMY_MAX_HP in constants.ts) moved out of the arena into the
 * main lobby specifically — deliberately just `"lobby"`, not every entry in LOBBY_SLUGS, since
 * unlike ARENA_SLUGS this isn't meant to be mirrored onto lobby2 too.
 */
export const MAIN_LOBBY_SLUG = "lobby";

/**
 * STU-56: every room with a room-owned enemy+dummy (see ARENA_ROOM_SLUG's doc comment in
 * constants.ts) — generalized the same way as LOBBY_SLUGS above so arena-2 gets the same
 * enemy/dummy/obstacle treatment as arena without a second hardcoded compare.
 */
export const ARENA_SLUGS: ReadonlySet<string> = new Set(["arena", "arena-2"]);
export function isArenaSlug(slug: string): boolean {
  return ARENA_SLUGS.has(slug);
}

/**
 * Same roster and order as ROOMS in src/lib/rooms.ts (colors/names omitted — irrelevant here).
 * STU-58: one door per pomodoro type, not N phase-offset variants — each type's actual work/break
 * cycle is now decided per on-demand instance (see PomodoroInstance in server.ts), not by a global
 * wall-clock offset, so there's nothing left here for a variant's `offsetMs` to encode.
 */
const ROOM_META: RoomMeta[] = [
  { slug: "25-5", kind: "pomodoro", workMin: 25, breakMin: 5 },
  { slug: "20-5", kind: "pomodoro", workMin: 20, breakMin: 5 },
  { slug: "50-10", kind: "pomodoro", workMin: 50, breakMin: 10 },
  { slug: "timer", kind: "stopwatch" },
  { slug: "shop", kind: "shop" },
  { slug: "arena", kind: "arena" },
];

/**
 * STU-56: lobby2's own tiny roster (mirrors of existing room kinds, no new gameplay) — kept
 * separate from ROOM_META/RING_ANGLES_DEG above since it's a second, independent ring on its own
 * page (src/app/lobby2/page.tsx), not a 7th/8th slot on the main lobby's ring.
 */
const ROOM_META_LOBBY2: RoomMeta[] = [
  { slug: "arena-2", kind: "arena" },
  { slug: "timer-2", kind: "stopwatch" },
];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Ring constants — must match RING_CENTER_X/Y, RING_RADIUS and the zone sizes in src/app/page.tsx
// exactly.
const RING_CENTER_X = SCREEN_W / 2;
const RING_CENTER_Y = 550;
const RING_RADIUS = 320;
const POMODORO_ZONE_W = 180;
const POMODORO_ZONE_H = 100;
const WIDE_ZONE_W = 220;
const WIDE_ZONE_H = 140;

// Same angle-per-slug map as RING_ANGLES_DEG in src/app/page.tsx — six rooms spaced 60° apart
// around the ring, starting at the top.
const RING_ANGLES_DEG: Record<string, number> = {
  "25-5": -90,
  "20-5": -30,
  "50-10": 30,
  arena: 90,
  shop: 150,
  timer: 210,
};

// STU-56: lobby2's own 2-slot ring — same RING_CENTER/RADIUS numbers as the main lobby's ring
// above (no visual collision: this ring renders on lobby2's own separate page/world), just its own
// angle-per-slug map since it has its own room count. Must match RING_ANGLES_DEG_LOBBY2 in
// src/app/lobby2/page.tsx exactly, same as RING_ANGLES_DEG above does for src/app/page.tsx.
const RING_ANGLES_DEG_LOBBY2: Record<string, number> = {
  "arena-2": -90,
  "timer-2": 90,
};

// Lobby world is 2x the screen in each dimension (worldW/worldH(true) in constants.ts) — this is
// the same CONTENT_OX/CONTENT_OY RoomStage.tsx's toWorldZone() adds to LOBBY_ZONES before using
// them, so the rects below land on the same world position the client actually renders.
const CONTENT_OX = (SCREEN_W * 2 - SCREEN_W) / 2;
const CONTENT_OY = (SCREEN_H * 2 - SCREEN_H) / 2;

function ringRect(slug: string, w: number, h: number, angles: Record<string, number>): Rect {
  const rad = (angles[slug] * Math.PI) / 180;
  return {
    x: RING_CENTER_X + RING_RADIUS * Math.cos(rad) - w / 2 + CONTENT_OX,
    y: RING_CENTER_Y + RING_RADIUS * Math.sin(rad) - h / 2 + CONTENT_OY,
    w,
    h,
  };
}

// House: hand-placed entrance behind the decorative house sprite, not on the ring — mirrors
// housePortalZone in src/app/page.tsx (HOUSE_SIZE must match HOUSE_SIZE in
// src/components/LobbyDecor.tsx exactly). Since that zone's screen-relative x/y already cancel out
// the CONTENT_OX/OY offset RoomStage adds (see the comment there), its final world position is just
// the house sprite's own center minus half the zone box — no ringRect() needed.
const HOUSE_SIZE = 450;
const HOUSE_PORTAL_W = 220;
const HOUSE_PORTAL_H = 140;
const HOUSE_RECT: Rect = {
  x: HOUSE_SIZE / 2 - HOUSE_PORTAL_W / 2,
  y: worldH(true) / 2 - HOUSE_PORTAL_H / 2,
  w: HOUSE_PORTAL_W,
  h: HOUSE_PORTAL_H,
};

function buildLobbyZoneRects(): ReadonlyMap<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const r of ROOM_META) {
    const [w, h] = r.kind === "pomodoro" ? [POMODORO_ZONE_W, POMODORO_ZONE_H] : [WIDE_ZONE_W, WIDE_ZONE_H];
    rects.set(r.slug, ringRect(r.slug, w, h, RING_ANGLES_DEG));
  }
  // STU-56: lobby2's own rooms, same flat map (slugs are globally unique across both lobbies).
  for (const r of ROOM_META_LOBBY2) {
    rects.set(r.slug, ringRect(r.slug, WIDE_ZONE_W, WIDE_ZONE_H, RING_ANGLES_DEG_LOBBY2));
  }
  rects.set("house", HOUSE_RECT);
  return rects;
}

/** slug -> lobby zone rect, for every room in ROOM_META. */
export const LOBBY_ZONE_RECTS: ReadonlyMap<string, Rect> = buildLobbyZoneRects();

/**
 * STU-58: workMin/breakMin for every pomodoro type slug — server.ts's on-demand instance registry
 * (PomodoroInstance) reads this to know how long a started instance's work/break phases actually
 * last. There's no more per-room `getRoomPhase` here: with instances started on demand instead of
 * running on a shared wall-clock offset, "what phase is this room in" is now instance state only
 * server.ts holds, not a pure function of time.
 */
export const POMODORO_TYPES: ReadonlyMap<string, { workMin: number; breakMin: number }> = new Map(
  ROOM_META.filter((r): r is RoomMeta & { workMin: number; breakMin: number } => r.kind === "pomodoro" && r.workMin !== undefined && r.breakMin !== undefined).map(
    (r) => [r.slug, { workMin: r.workMin, breakMin: r.breakMin }],
  ),
);
