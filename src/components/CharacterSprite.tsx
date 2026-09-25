import type { CharacterSlug } from "@/lib/useProfile";
import { CosmeticOverlay } from "@/components/CosmeticOverlay";
import { PixelPerson, type Dir } from "@/components/PixelPerson";
import { PlayerSprite } from "@/components/PlayerSprite";

/**
 * "pixel" (PixelPerson) draws across its own full 12-row grid with no headroom, unlike "classic"/
 * "girl" (PlayerSprite) whose source art only fills the bottom 2/3 of their box (top 1/3 is empty
 * headroom — see PlayerSprite.tsx's own comment). Left unscaled, that made "pixel" render visibly
 * bigger than the other two looks despite all three sharing the same box and the same server
 * hitbox (STU-51). PIXEL_VISUAL_SCALE shrinks "pixel" to the same 2/3-of-box-height silhouette,
 * bottom-anchored and centered like the other looks, so all three now match.
 */
const PIXEL_VISUAL_SCALE = 2 / 3;

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
      <PlayerSprite
        pack={character}
        label={label}
        size={size}
        dir={dir}
        walking={walking}
        rolling={rolling}
        cosmetic={cosmetic}
      />
    );
  }

  const boxW = 8 * size;
  const boxH = 12 * size;
  const pixelSize = size * PIXEL_VISUAL_SCALE;
  const pixelW = 8 * pixelSize;
  const pixelH = 12 * pixelSize;
  return (
    <div role="img" aria-label={label ?? "Character"} style={{ position: "relative", width: boxW, height: boxH }}>
      <div style={{ position: "absolute", left: (boxW - pixelW) / 2, bottom: 0, width: pixelW, height: pixelH }}>
        <PixelPerson color={color} size={pixelSize} dir={dir} walking={walking} rolling={rolling} />
      </div>
      <CosmeticOverlay cosmetic={cosmetic} />
    </div>
  );
}
