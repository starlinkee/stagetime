/**
 * Large lobby furniture (see src/components/LobbyDecor.tsx, which renders every item here) that
 * blocks movement and stops thrown balls/melee hitboxes — a "no-go box" the size of its own
 * sprite. Everything else LobbyDecor draws (rug, plant, mug, book-open, floor-lamp, chair) stays
 * purely decorative, walkable and passable, same as before this file existed.
 *
 * This is the single source of truth for both the item list AND which of them are solid —
 * LobbyDecor.tsx imports QUADRANT_ITEMS from here instead of keeping its own copy, so a change
 * here (add a solid piece of furniture, move one, mark one non-solid) can't drift out of sync
 * with what's actually drawn. Positions/sizes are native decor-sprite pixels, scaled by
 * DECOR_SCALE and placed relative to each screen quadrant's own top-left corner — see
 * buildLobbyObstacles below for how that becomes a world-space Rect, and LobbyDecor's own doc
 * comment for why this only exists in the lobby's outer margin.
 */

import type { Rect } from "./rooms";
import { HITBOX_H, HITBOX_OFFSET_X, HITBOX_OFFSET_Y, HITBOX_W, worldH, worldW } from "./constants";

export type Quadrant = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type DecorItem = {
  /** File name under /map/props/decor (no extension). */
  file: string;
  /** Native pixel size of the source PNG. */
  w: number;
  h: number;
  /** Position within its quadrant, in native pixels, top-left origin. */
  x: number;
  y: number;
  /** Blocks movement and thrown balls/melee (see buildLobbyObstacles below) — omitted/false for
   * purely decorative items. */
  solid?: boolean;
};

/** Native-pixel -> CSS-px scale, matched to PlayerSprite's 24px source -> 96px-tall box (4x). */
export const DECOR_SCALE = 4;

/**
 * Extra props scattered across the content square itself (SCREEN_W×SCREEN_H, where the room-select
 * zones live — see CONTENT_OX/OY in RoomStage.tsx), not just the outer margin QUADRANT_ITEMS
 * covers. Positioned in the gaps around the room grid (the empty band above it, and the row/column
 * gaps between zones) so they read as scattered clutter without sitting on top of a room tile.
 * LobbyDecor renders decor before the zone tiles (see RoomStage.tsx), so any item here that does
 * end up under a tile is simply hidden behind it rather than looking broken. All traversable
 * (non-solid) by design (see STU-42) — a solid item this close to the room grid risks walling off
 * a tile's entry, so a future solid addition here should double-check that against LOBBY_OBSTACLES.
 */
export const CENTER_ITEMS: DecorItem[] = [
  // Empty band above the room grid (world y 0-220, full width).
  { file: "rug", w: 32, h: 48, x: 40, y: 5 },
  { file: "floor-lamp", w: 15, h: 46, x: 110, y: 2 },
  { file: "plant", w: 10, h: 23, x: 200, y: 10 },
  { file: "mug", w: 10, h: 9, x: 250, y: 30 },
  { file: "rug", w: 32, h: 48, x: 300, y: 5 },
  { file: "book-open", w: 11, h: 8, x: 20, y: 35 },
  // Left/right margins beside the 20-5 row (world y 390-490, x 0-133 / x 1233-1366).
  { file: "plant", w: 10, h: 23, x: 5, y: 98 },
  { file: "mug", w: 10, h: 9, x: 15, y: 115 },
  { file: "plant", w: 10, h: 23, x: 312, y: 98 },
  { file: "book-open", w: 11, h: 8, x: 325, y: 115 },
  // Row gaps (full width, ~70px tall) — short items only so they don't bleed into the next row.
  { file: "mug", w: 10, h: 9, x: 60, y: 82 },
  { file: "book-open", w: 11, h: 8, x: 270, y: 84 },
  { file: "mug", w: 10, h: 9, x: 160, y: 165 },
];

/** One quadrant's worth of props, in native pixels relative to that quadrant's own top-left corner. */
export const QUADRANT_ITEMS: Record<Quadrant, DecorItem[]> = {
  // Reading nook.
  "top-left": [
    { file: "rug", w: 32, h: 48, x: 13, y: 45 },
    { file: "armchair", w: 22, h: 55, x: 20, y: 5, solid: true },
    { file: "bookshelf", w: 46, h: 47, x: 58, y: 3, solid: true },
    { file: "floor-lamp", w: 15, h: 46, x: 110, y: 5 },
  ],
  // Study desk.
  "top-right": [
    { file: "desk", w: 46, h: 30, x: 25, y: 45, solid: true },
    { file: "chair", w: 14, h: 27, x: 75, y: 48 },
    { file: "mug", w: 10, h: 9, x: 38, y: 39 },
    { file: "book-open", w: 11, h: 8, x: 50, y: 40 },
    { file: "plant", w: 10, h: 23, x: 105, y: 15 },
  ],
  // Grandfather clock corner.
  "bottom-left": [
    { file: "grandfather-clock", w: 21, h: 46, x: 38, y: 25, solid: true },
    { file: "plant", w: 10, h: 23, x: 70, y: 45 },
  ],
  // Cozy rug corner.
  "bottom-right": [
    { file: "rug", w: 32, h: 48, x: 113, y: 38 },
    { file: "plant", w: 10, h: 23, x: 125, y: 15 },
    { file: "plant", w: 10, h: 23, x: 38, y: 55 },
  ],
};

/**
 * World-space no-go boxes for every `solid` item above, computed once at module load (positions
 * are static) — off the lobby world's own width/height (worldW(true)/worldH(true)), never
 * anything per-room, since decor only exists in the lobby (see LobbyDecor's doc comment). Same
 * quadrant-origin math as LobbyDecor's own render: each quadrant is exactly a quarter of the
 * world.
 */
function buildLobbyObstacles(): Rect[] {
  const width = worldW(true);
  const height = worldH(true);
  const marginX = width / 4;
  const marginY = height / 4;
  const origin: Record<Quadrant, { x: number; y: number }> = {
    "top-left": { x: 0, y: 0 },
    "top-right": { x: width - marginX, y: 0 },
    "bottom-left": { x: 0, y: height - marginY },
    "bottom-right": { x: width - marginX, y: height - marginY },
  };
  const rects: Rect[] = [];
  for (const [quadrant, items] of Object.entries(QUADRANT_ITEMS) as [Quadrant, DecorItem[]][]) {
    for (const item of items) {
      if (!item.solid) continue;
      rects.push({
        x: origin[quadrant].x + item.x * DECOR_SCALE,
        y: origin[quadrant].y + item.y * DECOR_SCALE,
        w: item.w * DECOR_SCALE,
        h: item.h * DECOR_SCALE,
      });
    }
  }
  // Same content-square origin LobbyDecor uses for CENTER_ITEMS (marginX/marginY == top-left
  // corner of the content square, see that component's doc comment).
  for (const item of CENTER_ITEMS) {
    if (!item.solid) continue;
    rects.push({
      x: marginX + item.x * DECOR_SCALE,
      y: marginY + item.y * DECOR_SCALE,
      w: item.w * DECOR_SCALE,
      h: item.h * DECOR_SCALE,
    });
  }
  return rects;
}

export const LOBBY_OBSTACLES: ReadonlyArray<Rect> = buildLobbyObstacles();

/** Obstacles only exist in the lobby (see LOBBY_OBSTACLES' doc comment) — every other room passes
 * an empty array through the same collision helpers below, so callers don't need a second,
 * obstacle-free code path. */
export function obstaclesFor(isLobby: boolean): ReadonlyArray<Rect> {
  return isLobby ? LOBBY_OBSTACLES : [];
}

function aabbOverlaps(x: number, y: number, w: number, h: number, r: Rect): boolean {
  return x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y;
}

/**
 * Per-axis "slide": tries the full move, then X-only, then Y-only, falling back to staying put —
 * lets a player/ghost slide along an obstacle's edge instead of just stopping dead the instant
 * either axis would overlap it. Same shape box (PERSON_W x PERSON_H) as clampPos's own world-
 * bounds clamp; must be applied to the box AFTER that clamp, same order server.ts/RoomStage.tsx
 * use, since an obstacle can sit right at the world edge.
 */
export function resolveObstacleMove(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  w: number,
  h: number,
  obstacles: ReadonlyArray<Rect>,
): { x: number; y: number } {
  if (obstacles.length === 0) return { x: x1, y: y1 };
  // Ignore any obstacle the box is already overlapping at its starting position — otherwise
  // someone already standing there (a saved position from before this obstacle existed, or
  // anyone who's simply already touching its edge) could never move again: every candidate below
  // would still overlap that same box, so this would always fall through to "stay put" forever.
  // Excluding it here just means it can't newly wall someone off who's already past its edge;
  // once the box clears entirely, normal collision resumes on the very next tick.
  const active = obstacles.filter((r) => !aabbOverlaps(x0, y0, w, h, r));
  if (active.length === 0) return { x: x1, y: y1 };
  const blocked = (x: number, y: number) => active.some((r) => aabbOverlaps(x, y, w, h, r));
  if (!blocked(x1, y1)) return { x: x1, y: y1 };
  if (!blocked(x1, y0)) return { x: x1, y: y0 };
  if (!blocked(x0, y1)) return { x: x0, y: y1 };
  return { x: x0, y: y0 };
}

/**
 * Same as resolveObstacleMove above, but for a player's own (x, y) top-left-of-head position —
 * translates to/from the trimmed HITBOX_W x HITBOX_H box (see its doc comment in constants.ts)
 * before/after resolving, so a solid obstacle (desk, bookshelf, ...) blocks starting from roughly
 * the character's waist, not its head (STU-53). `x0/y0/x1/y1` and the return value stay in the
 * same head-anchored coordinate space every other caller (world clamp, zone overlap, spawn) uses —
 * only the box handed to the actual collision math is narrower/shorter.
 */
export function resolveObstacleMoveHitbox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  obstacles: ReadonlyArray<Rect>,
): { x: number; y: number } {
  const resolved = resolveObstacleMove(
    x0 + HITBOX_OFFSET_X,
    y0 + HITBOX_OFFSET_Y,
    x1 + HITBOX_OFFSET_X,
    y1 + HITBOX_OFFSET_Y,
    HITBOX_W,
    HITBOX_H,
    obstacles,
  );
  return { x: resolved.x - HITBOX_OFFSET_X, y: resolved.y - HITBOX_OFFSET_Y };
}

/** Nearest-point circle-vs-rect test, same method as the ball/melee-vs-player hitbox check in
 * server.ts/RoomStage.tsx's `hits()` — used to stop a thrown ball or melee hitbox dead against a
 * solid obstacle instead of letting it fly/reach through. */
export function circleIntersectsObstacles(cx: number, cy: number, r: number, obstacles: ReadonlyArray<Rect>): boolean {
  return obstacles.some((rect) => {
    const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
    const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
    return Math.hypot(cx - nx, cy - ny) <= r;
  });
}
