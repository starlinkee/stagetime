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
import { CENTER_ITEMS, DECOR_SCALE, QUADRANT_ITEMS, type DecorItem, type Quadrant } from "@realtime-shared/obstacles";

const DECOR_DIR = "/map/props/decor";

export function LobbyDecor({ width, height }: { width: number; height: number }) {
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
          }}
        />
      ))}
    </div>
  );
}
