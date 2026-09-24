import type { CharacterSlug } from "@/lib/useProfile";
import { PixelPerson, type Dir } from "@/components/PixelPerson";
import { PlayerSprite } from "@/components/PlayerSprite";

/**
 * Where each character's head actually starts, as a fraction of the box height from the top —
 * used only to reposition the cosmetic overlay (the flower crown) below, not to move the
 * character itself.
 * - "classic" (PlayerSprite, public/characters/player/rotation/*.png): every rotation frame's
 *   alpha bounding box starts at y=8 of a 24px source canvas (checked with Pillow across all 8
 *   directions) — 8/24 = 1/3 of the box is empty headroom above the head.
 * - "pixel" (PixelPerson): draws across the full 12-row grid starting at row 0 — no headroom,
 *   the head sits right at the top of the box.
 * PlayerSprite's own cosmetic overlay ("top: 6%", see PLAYER_COSMETIC_TOP below) was tuned by eye
 * against "classic"'s head. "pixel"'s overlay reuses that same tuning, shifted up by exactly the
 * headroom difference between the two looks, so the crown sits the same visual distance above
 * whichever head is actually there instead of floating over empty space.
 */
const HEAD_TOP_FRACTION: Record<CharacterSlug, number> = {
  classic: 1 / 3,
  pixel: 0,
};

/** Must match the literal "6" in PlayerSprite.tsx's own cosmetic overlay `top`. */
const PLAYER_COSMETIC_TOP_PCT = 6;
const PIXEL_COSMETIC_TOP_PCT =
  PLAYER_COSMETIC_TOP_PCT - (HEAD_TOP_FRACTION.classic - HEAD_TOP_FRACTION.pixel) * 100;

const COSMETIC_IMAGE: Record<string, string> = {
  flower: "/cosmetics/flower.png",
};

/**
 * Picks the equipped character look (see supabase/migrations/0031_character_selection.sql) and
 * renders it — purely a rendering choice, no gameplay effect (AGENTS.md), same as `cosmetic`.
 * Both looks share the same 8x12-cell box (PixelPerson.tsx/PlayerSprite.tsx), so callers don't
 * need to know which one is active to size/position it.
 */
export function CharacterSprite({
  character,
  color,
  label,
  size = 4,
  dir = 2,
  walking = false,
  rolling = false,
  cosmetic = null,
}: {
  character: CharacterSlug;
  /** Only used by "pixel" — "classic" is fixed art, not recolorable (see ShopRoom.tsx). */
  color?: string;
  label?: string;
  size?: number;
  dir?: Dir;
  walking?: boolean;
  rolling?: boolean;
  cosmetic?: string | null;
}) {
  if (character !== "pixel") {
    return (
      <PlayerSprite label={label} size={size} dir={dir} walking={walking} rolling={rolling} cosmetic={cosmetic} />
    );
  }

  const boxW = 8 * size;
  const boxH = 12 * size;
  return (
    <div role="img" aria-label={label ?? "Character"} style={{ position: "relative", width: boxW, height: boxH }}>
      <PixelPerson color={color} size={size} dir={dir} walking={walking} rolling={rolling} />
      {cosmetic && COSMETIC_IMAGE[cosmetic] && (
        <img
          src={COSMETIC_IMAGE[cosmetic]}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            top: `${PIXEL_COSMETIC_TOP_PCT}%`,
            left: "50%",
            width: "24%",
            transform: "translate(-50%, -55%)",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
