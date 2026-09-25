"use client";
import { Suspense } from "react";
import { type RoomZone, RoomStage } from "@/components/RoomStage";
import { ROOMS } from "@/lib/rooms";
import { useRoomOccupancy } from "@/lib/useRoomOccupancy";
import { SCREEN_W } from "@realtime-shared/constants";

/**
 * Kwadraty pokoi w lobby: ułożone w kółko wokół wspólnego środka, zamiast kolumny pomodoro +
 * osobnego rzędu timer/shop/arena. Środek i promień muszą być identyczne w
 * realtime-server/shared/rooms.ts's buildLobbyZoneRects — patrz komentarz tam.
 */
const RING_CENTER_X = SCREEN_W / 2;
const RING_CENTER_Y = 550;
const RING_RADIUS = 320;

/** Rozmiar kwadratu pomodoro vs. pozostałych (timer/shop/arena) — jak w starym układzie. */
const POMODORO_ZONE_W = 180;
const POMODORO_ZONE_H = 100;
const WIDE_ZONE_W = 220;
const WIDE_ZONE_H = 140;

/** Kąt (stopnie, 0° = w prawo, rosnąco zgodnie z ruchem wskazówek zegara) każdego pokoju na
 * okręgu — sześć pokoi rozstawionych równo co 60°, zaczynając od góry. */
const RING_ANGLES_DEG: Record<string, number> = {
  "25-5": -90,
  "20-5": -30,
  "50-10": 30,
  arena: 90,
  shop: 150,
  timer: 210,
};

function ringPos(slug: string, w: number, h: number) {
  const rad = (RING_ANGLES_DEG[slug] * Math.PI) / 180;
  return {
    x: RING_CENTER_X + RING_RADIUS * Math.cos(rad) - w / 2,
    y: RING_CENTER_Y + RING_RADIUS * Math.sin(rad) - h / 2,
  };
}

const pomodoroRooms = ROOMS.filter((r) => r.kind === "pomodoro");
const stopwatchRooms = ROOMS.filter((r) => r.kind === "stopwatch");
const shopRooms = ROOMS.filter((r) => r.kind === "shop");
const arenaRooms = ROOMS.filter((r) => r.kind === "arena");

const pomodoroZones: RoomZone[] = pomodoroRooms.map((r) => ({
  slug: r.slug,
  name: r.name,
  ...ringPos(r.slug, POMODORO_ZONE_W, POMODORO_ZONE_H),
  w: POMODORO_ZONE_W,
  h: POMODORO_ZONE_H,
  color: r.color,
  phase: { workMin: r.workMin, breakMin: r.breakMin },
}));

const stopwatchZones: RoomZone[] = stopwatchRooms.map((r) => ({
  slug: r.slug,
  name: "Timer",
  ...ringPos(r.slug, WIDE_ZONE_W, WIDE_ZONE_H),
  w: WIDE_ZONE_W,
  h: WIDE_ZONE_H,
  color: r.color,
}));
const shopZones: RoomZone[] = shopRooms.map((r) => ({
  slug: r.slug,
  name: "Shop",
  ...ringPos(r.slug, WIDE_ZONE_W, WIDE_ZONE_H),
  w: WIDE_ZONE_W,
  h: WIDE_ZONE_H,
  color: r.color,
  requiresAuth: true,
  noReward: true,
  badge: "shop",
}));

// Arena — a quick test room for a room-owned enemy everyone can fight (see ARENA_ROOM_SLUG in
// realtime-server/shared/constants.ts). Must match the "arena" branch in
// realtime-server/shared/rooms.ts's buildLobbyZoneRects exactly.
const arenaZones: RoomZone[] = arenaRooms.map((r) => ({
  slug: r.slug,
  name: "Arena",
  ...ringPos(r.slug, WIDE_ZONE_W, WIDE_ZONE_H),
  w: WIDE_ZONE_W,
  h: WIDE_ZONE_H,
  color: r.color,
  badge: "arena",
}));

const LOBBY_ZONES: RoomZone[] = [...pomodoroZones, ...stopwatchZones, ...shopZones, ...arenaZones];

const ROOM_SLUGS = ROOMS.map((r) => r.slug);

export default function Home() {
  const occupancy = useRoomOccupancy(ROOM_SLUGS);
  return (
    <>
    <Suspense fallback={null}>
      <RoomStage roomSlug="lobby" zones={LOBBY_ZONES} occupancy={occupancy} />
    </Suspense>
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-2 p-8 pt-16 text-center">
      <div className="flex items-center justify-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- animated GIF, next/image would strip the animation on optimization */}
        <img src="/branding/output-onlinegiftools.gif" alt="" width={96} height={96} className="h-24 w-24" />
        <h1 className="title-64 text-5xl sm:text-6xl">StudyQuest.Party</h1>
      </div>
    </main>
    </>
  );
}
