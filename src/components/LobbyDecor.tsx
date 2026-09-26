/**
 * Purely visual rendering of furniture scattered in the lobby's outer margin — the "dead space"
 * outside the SCREEN_W×SCREEN_H content square (see CONTENT_OX/OY in RoomStage.tsx), which
 * otherwise only shows DungeonBackground's floor tile. Revealed by walking toward the map edges,
 * same as the rest of that margin (see worldW/worldH's doc comment in
 * realtime-server/shared/constants.ts) — not visible from the default spawn view.
 *
 * The item list itself (position/size/which pieces are `solid`) lives in
 * realtime-server/shared/obstacles.ts, not here — that's the single source of truth both this
 * component and the movement/combat server read, so a solid item's no-go box (see
 * LOBBY_OBSTACLES there) can never silently drift from where it's actually drawn.
 */
import { CENTER_ITEMS, DECOR_SCALE, LOBBY_LAMPS, QUADRANT_ITEMS, type DecorItem, type Quadrant } from "@realtime-shared/obstacles";

const DECOR_DIR = "/map/props/decor";

/** Diameter (CSS px) of a lit lamp's glow — big enough to read as ambient light without swallowing
 * nearby furniture. */
const LAMP_GLOW_SIZE = 160;

export function LobbyDecor({
  width,
  height,
  lampsOn,
}: {
  width: number;
  height: number;
  /** Per-lamp on/off state keyed by LOBBY_LAMPS' own ids (realtime-server/shared/obstacles.ts) —
   * from the server's own lobby broadcast (see RoomStage.tsx). Missing/false means off. */
  lampsOn?: Record<string, boolean>;
}) {
  // Quadrant margins are each exactly a quarter of the world (see CONTENT_OX/OY in RoomStage.tsx:
  // the lobby world is 2× the screen in both axes, so the empty border on every side is width/4 /
  // height/4 wide/tall).
  const marginX = width / 4;
  const marginY = height / 4;
  const origin: Record<Quadrant, { x: number; y: number }> = {
    "top-left": { x: 0, y: 0 },
    "top-right": { x: width - marginX, y: 0 },
    "bottom-left": { x: 0, y: height - marginY },
    "bottom-right": { x: width - marginX, y: height - marginY },
  };

  // Content square's own top-left corner — see CENTER_ITEMS' doc comment in obstacles.ts: it's
  // exactly (marginX, marginY), the same origin math the quadrants above use.
  const centerOrigin = { x: marginX, y: marginY };

  return (
    <div className="absolute left-0 top-0" aria-hidden="true">
      {(Object.entries(QUADRANT_ITEMS) as [Quadrant, DecorItem[]][]).flatMap(([quadrant, items]) =>
        items.map((item, i) => (
          <img
            key={`${quadrant}-${item.file}-${i}`}
            src={`${DECOR_DIR}/${item.file}.png`}
            alt=""
            draggable={false}
            style={{
              position: "absolute",
              left: origin[quadrant].x + item.x * DECOR_SCALE,
              top: origin[quadrant].y + item.y * DECOR_SCALE,
              width: item.w * DECOR_SCALE,
              height: item.h * DECOR_SCALE,
              // Tailwind's preflight sets `img{max-width:100%}`; this wrapper has no in-flow
              // content (every child is itself position:absolute) so it collapses to width:0,
              // which then caps every image at 0px via that percentage — override it back off.
              maxWidth: "none",
              imageRendering: "pixelated",
              opacity: item.opacity,
            }}
          />
        )),
      )}
      {CENTER_ITEMS.map((item, i) => (
        <img
          key={`center-${item.file}-${i}`}
          src={`${DECOR_DIR}/${item.file}.png`}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            left: centerOrigin.x + item.x * DECOR_SCALE,
            top: centerOrigin.y + item.y * DECOR_SCALE,
            width: item.w * DECOR_SCALE,
            height: item.h * DECOR_SCALE,
            maxWidth: "none",
            imageRendering: "pixelated",
            opacity: item.opacity,
          }}
        />
      ))}
      {/* One-off decorative sprite, not part of the QUADRANT_ITEMS/obstacles system above (it's
          not under DECOR_DIR and it's purely visual — no solid box needed). Tucked into the
          bottom-right quadrant's open corner, away from its plants. Source PNG has a real alpha
          channel (re-exported from the original house.jfif, whose "transparent" background was
          actually a baked-in gray checkerboard — see archive/public/map/buildings/house.jfif). */}
      <img
        src="/map/buildings/house.png"
        alt=""
        draggable={false}
        style={{
          position: "absolute",
          left: origin["bottom-right"].x + 15 * DECOR_SCALE,
          top: origin["bottom-right"].y + 5 * DECOR_SCALE,
          width: 45 * DECOR_SCALE,
          height: 45 * DECOR_SCALE,
          maxWidth: "none",
          imageRendering: "pixelated",
        }}
      />
      {LOBBY_LAMPS.filter((lamp) => lampsOn?.[lamp.id]).map((lamp) => (
        <div
          key={`lamp-glow-${lamp.id}`}
          style={{
            position: "absolute",
            // Centered on the lamp's shade, roughly its top quarter, not the whole sprite's box.
            left: lamp.x + lamp.w / 2 - LAMP_GLOW_SIZE / 2,
            top: lamp.y + lamp.h * 0.15 - LAMP_GLOW_SIZE / 2,
            width: LAMP_GLOW_SIZE,
            height: LAMP_GLOW_SIZE,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(255,214,120,0.55) 0%, rgba(255,214,120,0.22) 40%, rgba(255,214,120,0) 72%)",
            mixBlendMode: "screen",
          }}
        />
      ))}
    </div>
  );
}
