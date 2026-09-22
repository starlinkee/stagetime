import { Suspense } from "react";
import { type RoomZone, RoomStage } from "@/components/RoomStage";
import { ROOMS } from "@/lib/rooms";

/** Kwadraty pokoi w lobby: rząd na środku sceny (świat 1600×900), do wejścia trzymając E. */
const ZONE_W = 220;
const ZONE_H = 220;
const ZONE_GAP = 60;
const zonesStartX = (1600 - (ROOMS.length * ZONE_W + (ROOMS.length - 1) * ZONE_GAP)) / 2;
const LOBBY_ZONES: RoomZone[] = ROOMS.map((r, i) => ({
  slug: r.slug,
  name: r.kind === "stopwatch" ? "Timer" : `${r.workMin}+${r.breakMin}`,
  x: zonesStartX + i * (ZONE_W + ZONE_GAP),
  y: 340,
  w: ZONE_W,
  h: ZONE_H,
}));

export default function Home() {
  return (
    <>
    <Suspense fallback={null}>
      <RoomStage roomSlug="lobby" zones={LOBBY_ZONES} />
    </Suspense>
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-2 p-8 pt-16 text-center">
      <h1 className="title-64 text-5xl sm:text-6xl">StudyQuest.Party</h1>
    </main>
    </>
  );
}
