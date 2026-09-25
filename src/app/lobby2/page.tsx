"use client";
import { Suspense } from "react";
import { type RoomZone, RoomStage } from "@/components/RoomStage";
import { ROOMS } from "@/lib/rooms";
import { useRoomOccupancy } from "@/lib/useRoomOccupancy";
import { SCREEN_W } from "@realtime-shared/constants";

/**
 * STU-56: lobby2 — a second, separate location reachable via the portal zone in the main lobby
 * (see LOBBY_ZONES in src/app/page.tsx). Same ring-of-doors pattern as the main lobby, just a
 * 2-slot ring for its own rooms (arena-2, timer-2 — mirrors of existing room kinds, see
 * LOBBY2_ROOMS in src/lib/rooms.ts). Ring center/radius here are only ever read by this page, so
 * they don't need to match src/app/page.tsx's own ring constants — they only need to match
 * RING_ANGLES_DEG_LOBBY2 in realtime-server/shared/rooms.ts, same relationship the main lobby's
 * ring has with that file's RING_ANGLES_DEG.
 */
const RING_CENTER_X = SCREEN_W / 2;
const RING_CENTER_Y = 550;
const RING_RADIUS = 320;
const WIDE_ZONE_W = 220;
const WIDE_ZONE_H = 140;

const RING_ANGLES_DEG: Record<string, number> = {
  "arena-2": -90,
  "timer-2": 90,
};

function ringPos(slug: string, w: number, h: number) {
  const rad = (RING_ANGLES_DEG[slug] * Math.PI) / 180;
  return {
    x: RING_CENTER_X + RING_RADIUS * Math.cos(rad) - w / 2,
    y: RING_CENTER_Y + RING_RADIUS * Math.sin(rad) - h / 2,
  };
}

const lobby2RoomSlugs = new Set(["arena-2", "timer-2"]);
const lobby2Rooms = ROOMS.filter((r) => lobby2RoomSlugs.has(r.slug));

const LOBBY2_ZONES: RoomZone[] = lobby2Rooms.map((r) => ({
  slug: r.slug,
  name: r.name,
  ...ringPos(r.slug, WIDE_ZONE_W, WIDE_ZONE_H),
  w: WIDE_ZONE_W,
  h: WIDE_ZONE_H,
  color: r.color,
  ...(r.kind === "arena" ? { badge: "arena" as const } : {}),
}));

const ROOM_SLUGS = lobby2Rooms.map((r) => r.slug);

export default function Lobby2() {
  const occupancy = useRoomOccupancy(ROOM_SLUGS);
  return (
    <Suspense fallback={null}>
      <RoomStage roomSlug="lobby2" zones={LOBBY2_ZONES} occupancy={occupancy} />
    </Suspense>
  );
}
