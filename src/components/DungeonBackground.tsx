import { useId } from "react";

/**
 * Purely decorative ground for every room (STU-52: work rooms/arena had no floor tile at all,
 * just a bare background) — a simple, seamlessly repeating pixel-art tile of damp dungeon brick,
 * rendered once as an SVG `<pattern>` (cheap regardless of world size). No game state, collisions
 * or logic live here (see /client rules in AGENTS.md); it's just a backdrop behind the room zones
 * drawn on RoomStage's canvas.
 */

/** 8×8 running-bond brick tile: "." mortar, B/H/D brick base/highlight/shadow, W a wet glint. */
const TILE_ROWS = [
  "........",
  ".HHHHHHH",
  ".BBBWBBB",
  ".BBBBBBD",
  "........",
  "HHHH.HHH",
  "WBBB.BBB",
  "BBBD.BBB",
];
const TILE_SIZE = TILE_ROWS.length;
const SHADES: Record<string, string> = {
  ".": "#141917",
  B: "#3a4640",
  H: "#57685f",
  D: "#20261f",
  W: "#7fd0c2",
};

/** CSS px per pixel-art pixel — keeps bricks chunky and legible at world scale. */
const PIXEL = 6;

export function DungeonBackground({ width, height }: { width: number; height: number }) {
  const patternId = `dungeon-bricks-${useId()}`;
  const cell = TILE_SIZE * PIXEL;
  return (
    <svg
      className="absolute left-0 top-0 opacity-20"
      width={width}
      height={height}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <defs>
        <pattern id={patternId} width={cell} height={cell} patternUnits="userSpaceOnUse">
          {TILE_ROWS.flatMap((row, y) =>
            [...row].map((c, x) => (
              <rect
                key={`${x}-${y}`}
                x={x * PIXEL}
                y={y * PIXEL}
                width={PIXEL}
                height={PIXEL}
                fill={SHADES[c]}
              />
            )),
          )}
        </pattern>
      </defs>
      <rect width={width} height={height} fill={`url(#${patternId})`} />
    </svg>
  );
}
