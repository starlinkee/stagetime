"use client";
import { Suspense } from "react";
import { type RoomZone, RoomStage } from "@/components/RoomStage";
import { ROOMS } from "@/lib/rooms";
import { useRoomOccupancy } from "@/lib/useRoomOccupancy";
import { SCREEN_W } from "@realtime-shared/constants";

/**
 * Kwadraty pokoi w lobby: jeden wiersz na typ pomodoro (25+5, 20+5, 50+10, patrz pomodoroVariants
 * w lib/rooms.ts) — liczba kwadratów w wierszu odpowiada liczbie wariantów tego typu (różna dla
 * każdego typu), plus osobny kwadrat pokoju-stopera pod spodem.
 */
const ZONE_W = 180;
const ZONE_H = 100;
const COL_GAP = 50;
const ROW_GAP = 70;
const gridStartY = 220;

const pomodoroRooms = ROOMS.filter((r) => r.kind === "pomodoro");
const stopwatchRooms = ROOMS.filter((r) => r.kind === "stopwatch");
const shopRooms = ROOMS.filter((r) => r.kind === "shop");

// Grupowanie po typie (slug bez numeru wariantu na końcu, np. "25-5-1" -> "25-5"), w kolejności
// pierwszego wystąpienia, żeby każdy typ trafił do jednego wiersza.
const pomodoroGroups = new Map<string, typeof pomodoroRooms>();
for (const r of pomodoroRooms) {
  const key = r.slug.replace(/-\d+$/, "");
  const group = pomodoroGroups.get(key);
  if (group) group.push(r);
  else pomodoroGroups.set(key, [r]);
}

const pomodoroZones: RoomZone[] = [...pomodoroGroups.values()].flatMap((group, row) => {
  const rowW = group.length * ZONE_W + (group.length - 1) * COL_GAP;
  const rowStartX = (SCREEN_W - rowW) / 2;
  return group.map((r, col) => ({
    slug: r.slug,
    // Slug ma postać "<workMin>-<breakMin>-<wariant>" — ostatni człon to numer wariantu na kwadracie.
    name: r.slug.split("-").pop()!,
    x: rowStartX + col * (ZONE_W + COL_GAP),
    y: gridStartY + row * (ZONE_H + ROW_GAP),
    w: ZONE_W,
    h: ZONE_H,
    color: r.color,
    phase: { workMin: r.workMin, breakMin: r.breakMin, offsetMs: r.offsetMs },
  }));
});

const TIMER_ZONE_Y = gridStartY + pomodoroGroups.size * (ZONE_H + ROW_GAP) + 10;
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
}));

const LOBBY_ZONES: RoomZone[] = [...pomodoroZones, ...stopwatchZones, ...shopZones];

const ROOM_SLUGS = ROOMS.map((r) => r.slug);

export default function Home() {
  const occupancy = useRoomOccupancy(ROOM_SLUGS);
  return (
    <>
    <Suspense fallback={null}>
      <RoomStage roomSlug="lobby" zones={LOBBY_ZONES} occupancy={occupancy} />
    </Suspense>
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-2 p-8 pt-16 text-center">
      <h1 className="title-64 text-5xl sm:text-6xl">StudyQuest.Party</h1>
    </main>
    </>
  );
}
