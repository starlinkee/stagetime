"use client";
import { Suspense } from "react";
import { type RoomZone, RoomStage } from "@/components/RoomStage";
import { ROOMS } from "@/lib/rooms";
import { useRoomOccupancy } from "@/lib/useRoomOccupancy";
import { SCREEN_W } from "@realtime-shared/constants";

/**
 * Kwadraty pokoi w lobby: jeden wiersz na typ pomodoro (25+5, 20+5, 50+10) — od STU-58 to jeden
 * kwadrat ("drzwi") na typ, nie N kwadratów-wariantów, plus osobny kwadrat pokoju-stopera pod spodem.
 */
const ZONE_W = 180;
const ZONE_H = 100;
const ROW_GAP = 70;
const gridStartY = 220;

const pomodoroRooms = ROOMS.filter((r) => r.kind === "pomodoro");
const stopwatchRooms = ROOMS.filter((r) => r.kind === "stopwatch");
const shopRooms = ROOMS.filter((r) => r.kind === "shop");
const arenaRooms = ROOMS.filter((r) => r.kind === "arena");

const pomodoroZones: RoomZone[] = pomodoroRooms.map((r, row) => ({
  slug: r.slug,
  name: `${r.workMin}+${r.breakMin}`,
  x: (SCREEN_W - ZONE_W) / 2,
  y: gridStartY + row * (ZONE_H + ROW_GAP),
  w: ZONE_W,
  h: ZONE_H,
  color: r.color,
  phase: { workMin: r.workMin, breakMin: r.breakMin },
}));

const TIMER_ZONE_Y = gridStartY + pomodoroRooms.length * (ZONE_H + ROW_GAP) + 10;
const stopwatchZones: RoomZone[] = stopwatchRooms.map((r) => ({
  slug: r.slug,
  name: "Timer",
  x: SCREEN_W / 2 - 110 - 150,
  y: TIMER_ZONE_Y,
  w: 220,
  h: 140,
  color: r.color,
}));
// Sklep stoi tuż obok Timer Room, żeby oba pokoje-narzędzia (bez wspólnych cykli) siedziały razem
// w jednym rzędzie, osobno od kratki pomodoro powyżej.
const shopZones: RoomZone[] = shopRooms.map((r) => ({
  slug: r.slug,
  name: "Shop",
  x: SCREEN_W / 2 + 150 - 110,
  y: TIMER_ZONE_Y,
  w: 220,
  h: 140,
  color: r.color,
  requiresAuth: true,
  noReward: true,
  badge: "shop",
}));

// Arena sits right next to Shop, same row — a quick test room for a room-owned enemy everyone can
// fight (see ARENA_ROOM_SLUG in realtime-server/shared/constants.ts). Must match the "arena"
// branch in realtime-server/shared/rooms.ts's buildLobbyZoneRects exactly.
const arenaZones: RoomZone[] = arenaRooms.map((r) => ({
  slug: r.slug,
  name: "Arena",
  x: SCREEN_W / 2 + 150 - 110 + 270,
  y: TIMER_ZONE_Y,
  w: 220,
  h: 140,
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
