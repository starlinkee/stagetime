import type { CSSProperties } from "react";
import type { Dir } from "@/components/PixelPerson";

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

/** Native size of every rotation frame (all 8 are 64x64). */
const SRC_SIZE = 64;

/**
 * Character sprite: one static image per direction (no walk-cycle frames), so "walking" is faked
 * with a step bob (.ps-walk) instead of leg animation. Position/collision anchoring still uses
 * PixelPerson's 8x12-cell box (boxW/boxH below), but the art itself is scaled to the box's height
 * and allowed to overflow its width — the source is square (64x64), the old box was narrow and
 * portrait-shaped (8:12), and fitting to the narrower dimension made the character noticeably
 * smaller than PixelPerson was and left a gap under the NameTag above it.
 */
export function PlayerSprite({
  label,
  size = 4,
  dir = 2,
  walking = false,
  rolling = false,
  dashing = false,
}: {
  label?: string;
  /** Size of one PixelPerson pixel-grid cell, in px — same unit callers already use. */
  size?: number;
  dir?: Dir;
  walking?: boolean;
  rolling?: boolean;
  dashing?: boolean;
}) {
  const boxW = 8 * size;
  const boxH = 12 * size;
  const scale = boxH / SRC_SIZE;
  const imgW = SRC_SIZE * scale;
  const imgH = SRC_SIZE * scale;

  // Same per-direction roll variant as PixelPerson: horizontal component decides spin direction,
  // vertical component decides how much of the roll is a forward/backward squash instead.
  const rollRotDeg = ["360deg", "360deg", "0deg", "-360deg", "-360deg", "-360deg", "0deg", "360deg"][dir];
  const rollSquash = [0, 0.5, 1, 0.5, 0, 0.5, 1, 0.5][dir];

  return (
    <div role="img" aria-label={label ?? "Character"} style={{ position: "relative", width: boxW, height: boxH }}>
      <div
        className={rolling ? "ps-roll" : dashing ? "ps-dash" : undefined}
        style={
          {
            position: "absolute",
            left: (boxW - imgW) / 2,
            bottom: 0,
            width: imgW,
            height: imgH,
            ...(rolling ? { "--roll-rot": rollRotDeg, "--roll-squash": rollSquash } : undefined),
          } as CSSProperties
        }
      >
        <img
          src={DIR_IMAGE[dir]}
          alt=""
          draggable={false}
          className={walking ? "ps-walk" : undefined}
          style={{ display: "block", width: "100%", height: "100%", imageRendering: "pixelated" }}
        />
      </div>
      {dashing && <div className="ps-dash-cloud" style={{ position: "absolute", inset: 0 }} />}
    </div>
  );
}
