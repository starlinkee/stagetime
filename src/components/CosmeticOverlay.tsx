import type { CSSProperties } from "react";

/**
 * Renders the equipped cosmetic (see supabase/migrations/0027_cosmetic_items.sql,
 * 0035_sparkles_cosmetic.sql) over a character sprite box. Pulled out of PlayerSprite.tsx/
 * CharacterSprite.tsx (which both render a cosmetic at the same three call sites — "classic",
 * "girl", "pixel") so a new item only needs a branch added here, not in all three.
 */
const FLOWER_IMAGE = "/cosmetics/flower.png";

const SPARKLE_DOTS: { top: string; left: string; delay: string }[] = [
  { top: "6%", left: "50%", delay: "0s" },
  { top: "22%", left: "12%", delay: "0.3s" },
  { top: "22%", left: "88%", delay: "0.6s" },
  { top: "55%", left: "2%", delay: "0.9s" },
  { top: "55%", left: "98%", delay: "1.2s" },
  { top: "85%", left: "50%", delay: "0.45s" },
];

export function CosmeticOverlay({
  cosmetic,
  transform,
  variant = "overlay",
}: {
  cosmetic: string | null | undefined;
  transform?: string;
  /** "overlay" (default): small hat-sized icon positioned for sitting on a character's head, used
   * by PlayerSprite.tsx/CharacterSprite.tsx. "preview": centered and much larger, filling most of
   * the box — used by ShopRoom.tsx's purchase dialog, which shows the item on its own, not on top
   * of a character. */
  variant?: "overlay" | "preview";
}) {
  if (cosmetic === "flower") {
    return variant === "preview" ? (
      <img
        src={FLOWER_IMAGE}
        alt=""
        draggable={false}
        style={{ position: "absolute", top: "50%", left: "50%", width: "70%", transform: "translate(-50%, -50%)", pointerEvents: "none" }}
      />
    ) : (
      <img
        src={FLOWER_IMAGE}
        alt=""
        draggable={false}
        style={{
          position: "absolute",
          top: "6%",
          left: "50%",
          width: "24%",
          transform: transform ?? "translate(-50%, -55%)",
          pointerEvents: "none",
        }}
      />
    );
  }
  if (cosmetic === "sparkles") {
    return (
      <div className="cosmetic-sparkles" aria-hidden="true">
        {SPARKLE_DOTS.map((dot, i) => (
          <span
            key={i}
            style={
              {
                top: dot.top,
                left: dot.left,
                transform: "translate(-50%, -50%)",
                "--sparkle-delay": dot.delay,
              } as CSSProperties
            }
          />
        ))}
      </div>
    );
  }
  return null;
}
