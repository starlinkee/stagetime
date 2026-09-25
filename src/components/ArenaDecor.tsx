/**
 * Purely visual rendering of the arena's solid cover (STU-34) — same furniture sprites as the
 * lobby's solid decor, just placed directly in the arena's own SCREEN_W x SCREEN_H world instead
 * of split across lobby quadrants (see ARENA_OBSTACLE_ITEMS' doc comment in
 * realtime-server/shared/obstacles.ts, the single source of truth both this component and the
 * movement/combat server read).
 */
import { ARENA_OBSTACLE_ITEMS, DECOR_SCALE } from "@realtime-shared/obstacles";

const DECOR_DIR = "/map/props/decor";

export function ArenaDecor() {
  return (
    <div className="absolute left-0 top-0" aria-hidden="true">
      {ARENA_OBSTACLE_ITEMS.map((item, i) => (
        <img
          key={`arena-${item.file}-${i}`}
          src={`${DECOR_DIR}/${item.file}.png`}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            left: item.x * DECOR_SCALE,
            top: item.y * DECOR_SCALE,
            width: item.w * DECOR_SCALE,
            height: item.h * DECOR_SCALE,
            // Same preflight `img{max-width:100%}` override as LobbyDecor.tsx.
            maxWidth: "none",
            imageRendering: "pixelated",
          }}
        />
      ))}
    </div>
  );
}
