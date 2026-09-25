/**
 * Room roster + lobby-grid layout, enough to answer "where in the lobby is room X's zone" —
 * needed so a player leaving a room back into the lobby can spawn at that room's own zone
 * instead of a generic default (see the "join" handler in ../src/server.ts, which has no other
 * way to learn which room a fresh connection just came from).
 *
 * Every slug and every layout constant below must match src/lib/rooms.ts (ROOMS / EXIT_ZONE) and
 * the grid built in src/app/page.tsx (ZONE_W/H, COL_GAP, ROW_GAP, gridStartY, TIMER_ZONE_Y) —
 * this is a second copy of that layout, kept here only because this server is a separate deploy
 * that can't import Next.js code. If you change the lobby grid or the room roster on the Next.js
 * side, update this file to match, or exit-to-lobby spawn silently falls out of sync again.
 *
 * That page.tsx grid is defined in "start screen" coordinates (0..SCREEN_W/H) — RoomStage.tsx
 * only turns it into actual world coordinates at render time, via `toWorldZone(z, CONTENT_OX,
 * CONTENT_OY)`, since the lobby's world is 2x the screen in each dimension (see worldW/worldH in
 * constants.ts). LOBBY_ZONE_RECTS below is already shifted by that same CONTENT_OX/OY, so it's
 * directly usable as a world position — don't add the offset again at the call site.
 */

import { SCREEN_W, SCREEN_H } from "./constants";

export type RoomKind = "pomodoro" | "stopwatch" | "shop" | "arena";

interface RoomMeta {
  slug: string;
  kind: RoomKind;
  workMin?: number;
  breakMin?: number;
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

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Grid constants — must match src/app/page.tsx exactly.
const ZONE_W = 180;
const ZONE_H = 100;
const COL_GAP = 50;
const ROW_GAP = 70;
const GRID_START_Y = 220;

// Lobby world is 2x the screen in each dimension (worldW/worldH(true) in constants.ts) — this is
// the same CONTENT_OX/CONTENT_OY RoomStage.tsx's toWorldZone() adds to LOBBY_ZONES before using
// them, so the rects below land on the same world position the client actually renders.
const CONTENT_OX = (SCREEN_W * 2 - SCREEN_W) / 2;
const CONTENT_OY = (SCREEN_H * 2 - SCREEN_H) / 2;

function buildLobbyZoneRects(): ReadonlyMap<string, Rect> {
  const rects = new Map<string, Rect>();

  const pomodoroRooms = ROOM_META.filter((r) => r.kind === "pomodoro");
  const groups = new Map<string, RoomMeta[]>();
  for (const r of pomodoroRooms) {
    const key = r.slug.replace(/-\d+$/, "");
    const group = groups.get(key);
    if (group) group.push(r);
    else groups.set(key, [r]);
  }

  let row = 0;
  for (const group of groups.values()) {
    const rowW = group.length * ZONE_W + (group.length - 1) * COL_GAP;
    const rowStartX = (SCREEN_W - rowW) / 2;
    const y = GRID_START_Y + row * (ZONE_H + ROW_GAP);
    group.forEach((r, col) => {
      rects.set(r.slug, { x: rowStartX + col * (ZONE_W + COL_GAP) + CONTENT_OX, y: y + CONTENT_OY, w: ZONE_W, h: ZONE_H });
    });
    row += 1;
  }

  const timerY = GRID_START_Y + groups.size * (ZONE_H + ROW_GAP) + 10;
  for (const r of ROOM_META) {
    if (r.kind === "stopwatch") {
      rects.set(r.slug, { x: SCREEN_W / 2 - 110 - 150 + CONTENT_OX, y: timerY + CONTENT_OY, w: 220, h: 140 });
    } else if (r.kind === "shop") {
      rects.set(r.slug, { x: SCREEN_W / 2 + 150 - 110 + CONTENT_OX, y: timerY + CONTENT_OY, w: 220, h: 140 });
    } else if (r.kind === "arena") {
      // Sits directly to the right of Shop, same row (see AGENTS.md's request: "one extra room
      // next to the shop") — must match the arenaZones block in src/app/page.tsx exactly.
      rects.set(r.slug, { x: SCREEN_W / 2 + 150 - 110 + 270 + CONTENT_OX, y: timerY + CONTENT_OY, w: 220, h: 140 });
    }
  }

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
