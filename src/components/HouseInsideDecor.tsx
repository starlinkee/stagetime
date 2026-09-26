/**
 * Purely visual backdrop for the House room (src/lib/rooms.ts's HOUSE_ROOM_SLUG) — a single
 * full-bleed interior photo behind DungeonBackground's floor tile, so walking through the house's
 * (currently invisible, see housePortalZone in src/app/page.tsx) entrance actually reads as
 * "you're now inside" instead of the bare dungeon-brick floor every other empty room has.
 */
import { SCREEN_W, SCREEN_H } from "@realtime-shared/constants";

export function HouseInsideDecor() {
  return (
    <img
      src="/map/buildings/house-inside.jpg"
      alt=""
      draggable={false}
      aria-hidden="true"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: SCREEN_W,
        height: SCREEN_H,
        objectFit: "cover",
      }}
    />
  );
}
