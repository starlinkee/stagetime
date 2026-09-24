import type { CSSProperties } from "react";
import type { Dir } from "@/components/PixelPerson";
import { ROLL_MS } from "@realtime-shared/constants";

/** Directional rotation art, provided pre-rendered (no walk-cycle frames — see PLAYER_ROTATION_DIR). */
const PLAYER_ROTATION_DIR = "/characters/player/rotation";
const DIR_IMAGE: Record<Dir, string> = {
  0: `${PLAYER_ROTATION_DIR}/east.png`,
  1: `${PLAYER_ROTATION_DIR}/south-east.png`,
  2: `${PLAYER_ROTATION_DIR}/south.png`,
  3: `${PLAYER_ROTATION_DIR}/south-west.png`,
  4: `${PLAYER_ROTATION_DIR}/west.png`,
  5: `${PLAYER_ROTATION_DIR}/north-west.png`,
  6: `${PLAYER_ROTATION_DIR}/north.png`,
  7: `${PLAYER_ROTATION_DIR}/north-east.png`,
};

/** Native size of every rotation frame (all 8 are 24x24). */
const SRC_SIZE = 24;

/**
 * Roll's visual: plays the pack's Jump spritesheet instead of spinning the static rotation frame.
 * Purely cosmetic — roll's actual direction/cooldown/movement stay server-authoritative in
 * realtime-server/src/server.ts (see AGENTS.md); ROLL_MS is imported only to size this CSS
 * animation to the same duration the server already rolls for.
 * public/characters/player/jump/*.png: 5 rows exported from the pack (down/down-side/side/
 * up-side/up), each a 120x22 horizontal strip of 5 frames (24x22 each). The 3 west-facing
 * directions reuse the matching east-facing row mirrored via scaleX(-1) — the pack only draws
 * one side.
 */
const JUMP_DIR = "/characters/player/jump";
const JUMP_ROW: Record<Dir, { file: string; mirror: boolean }> = {
  0: { file: "side", mirror: false }, // east
  1: { file: "down-side", mirror: false }, // south-east
  2: { file: "down", mirror: false }, // south
  3: { file: "down-side", mirror: true }, // south-west
  4: { file: "side", mirror: true }, // west
  5: { file: "up-side", mirror: true }, // north-west
  6: { file: "up", mirror: false }, // north
  7: { file: "up-side", mirror: false }, // north-east
};
const JUMP_FRAME_W = 24;
const JUMP_FRAME_H = 22;

/**
 * Cosmetic items — purely decorative (see AGENTS.md), never affect stats/collision. One static
 * image per slug, no per-direction art (unlike DIR_IMAGE above): it's small enough, and sits
 * centered near the top of the sprite, to read fine at any facing without one.
 */
const COSMETIC_IMAGE: Record<string, string> = {
  flower: "/cosmetics/flower.png",
};

/**
 * Character sprite: one static image per direction (no walk-cycle frames), so "walking" is faked
 * with a step bob (.ps-walk) instead of leg animation. Position/collision anchoring still uses
 * PixelPerson's 8x12-cell box (boxW/boxH below), but the art itself is scaled to the box's height
 * and allowed to overflow its width — the source is square (SRC_SIZE), the old box was narrow and
 * portrait-shaped (8:12), and fitting to the narrower dimension made the character noticeably
 * smaller than PixelPerson was and left a gap under the NameTag above it.
 */
export function PlayerSprite({
  label,
  size = 4,
  dir = 2,
  walking = false,
  rolling = false,
  cosmetic = null,
}: {
  label?: string;
  /** Size of one PixelPerson pixel-grid cell, in px — same unit callers already use. */
  size?: number;
  dir?: Dir;
  walking?: boolean;
  rolling?: boolean;
  /** Active cosmetic slug (see supabase/migrations/0027_cosmetic_items.sql), or null/unknown for
   * none — arrives via Presence "meta" (see Meta in RoomStage.tsx), same path as color/nick. */
  cosmetic?: string | null;
}) {
  const boxW = 8 * size;
  const boxH = 12 * size;
  const scale = boxH / SRC_SIZE;
  const imgW = SRC_SIZE * scale;
  const imgH = SRC_SIZE * scale;

  const jump = JUMP_ROW[dir];
  const jumpW = JUMP_FRAME_W * scale;
  const jumpH = JUMP_FRAME_H * scale;
  const cosmeticTransform = jump.mirror ? "translate(-50%, -55%) scaleX(-1)" : "translate(-50%, -55%)";

  return (
    <div role="img" aria-label={label ?? "Character"} style={{ position: "relative", width: boxW, height: boxH }}>
      {rolling ? (
        <div
          className="ps-jump"
          style={
            {
              position: "absolute",
              left: (boxW - jumpW) / 2,
              bottom: 0,
              width: jumpW,
              height: jumpH,
              backgroundImage: `url(${JUMP_DIR}/${jump.file}.png)`,
              transform: jump.mirror ? "scaleX(-1)" : undefined,
              "--ps-jump-ms": `${ROLL_MS}ms`,
            } as CSSProperties
          }
        >
          {cosmetic && COSMETIC_IMAGE[cosmetic] && (
            <img
              src={COSMETIC_IMAGE[cosmetic]}
              alt=""
              draggable={false}
              style={{
                position: "absolute",
                top: "6%",
                left: "50%",
                width: "24%",
                transform: cosmeticTransform,
                pointerEvents: "none",
              }}
            />
          )}
        </div>
      ) : (
        <div style={{ position: "absolute", left: (boxW - imgW) / 2, bottom: 0, width: imgW, height: imgH }}>
          <img
            src={DIR_IMAGE[dir]}
            alt=""
            draggable={false}
            className={walking ? "ps-walk" : undefined}
            style={{ display: "block", width: "100%", height: "100%", imageRendering: "pixelated" }}
          />
          {cosmetic && COSMETIC_IMAGE[cosmetic] && (
            <img
              src={COSMETIC_IMAGE[cosmetic]}
              alt=""
              draggable={false}
              style={{
                position: "absolute",
                top: "6%",
                left: "50%",
                width: "24%",
                transform: "translate(-50%, -55%)",
                pointerEvents: "none",
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
