import { notFound } from "next/navigation";
import { Suspense } from "react";
import { RoomStage } from "@/components/RoomStage";
import { RoomTimer } from "@/components/RoomTimer";
import { ShopRoom } from "@/components/ShopRoom";
import { TimerRoom } from "@/components/TimerRoom";
import { coinsForMinutes } from "@/lib/coins";
import { EXIT_ZONE, getRoom, ROOMS } from "@/lib/rooms";
import { xpForMinutes } from "@/lib/xp";

export function generateStaticParams() {
  return ROOMS.map((r) => ({ slug: r.slug }));
}

export default async function RoomPage({ params }: PageProps<"/rooms/[slug]">) {
  const { slug } = await params;
  const room = getRoom(slug);
  if (!room) notFound();

  // Kwadrat wyjścia niesie fazę tego pokoju, żeby RoomStage wiedział, kiedy ostrzec przed
  // wyjściem w trakcie pracy (utrata XP z sesji) — patrz obsługa "lobby" jako wyjścia w RoomStage.
  const exitZone =
    room.kind === "pomodoro"
      ? { ...EXIT_ZONE, phase: { workMin: room.workMin, breakMin: room.breakMin, offsetMs: room.offsetMs } }
      : EXIT_ZONE;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <h1 className="text-2xl font-semibold">{room.name}</h1>
      {/* Długość faz i nagroda XP tego pokoju, widoczne cały czas po wejściu — patrz też etykieta
          pod kwadratem pokoju w lobby (RoomStage) i ostrzeżenie przed utratą XP przy wyjściu
          w trakcie pracy. */}
      {room.kind !== "shop" && (
        <p className="-mt-6 flex flex-col items-center gap-0.5 text-sm">
          {room.kind === "pomodoro" && (
            <span className="text-zinc-400">
              {room.workMin} min work + {room.breakMin} min break
            </span>
          )}
          <span className="font-semibold text-amber-400">
            {room.kind === "pomodoro"
              ? `+${xpForMinutes(room.workMin)} XP and +${coinsForMinutes(room.workMin)} coins for completing this work session`
              : "+0.1 XP every 5 minutes and +0.1 coins every minute while the stopwatch is running"}
          </span>
        </p>
      )}
      {room.kind === "stopwatch" ? (
        <Suspense fallback={null}>
          <TimerRoom roomSlug={room.slug} />
        </Suspense>
      ) : room.kind === "shop" ? (
        <Suspense fallback={null}>
          <ShopRoom roomSlug={room.slug} />
        </Suspense>
      ) : (
        <>
          <RoomTimer room={room} />
          <Suspense fallback={null}>
            <RoomStage roomSlug={room.slug} zones={[exitZone]} spawnZoneSlug={EXIT_ZONE.slug} />
          </Suspense>
        </>
      )}
    </main>
  );
}
