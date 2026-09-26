import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PomodoroRoom } from "@/components/PomodoroRoom";
import { RoomStage } from "@/components/RoomStage";
import { ShopRoom } from "@/components/ShopRoom";
import { TimerRoom } from "@/components/TimerRoom";
import { coinsForMinutes } from "@/lib/coins";
import { EXIT_ZONE, START_SESSION_ZONE, getRoom, ROOMS } from "@/lib/rooms";
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
  // STU-56: `slug` na kwadracie wyjścia to `room.exitTo` (domyślnie "lobby") zamiast zawsze
  // literału EXIT_ZONE.slug — to on decyduje, do której lokacji trzymanie E tu wróci (patrz
  // LOBBY_ROUTES w RoomStage.tsx).
  const exitZoneBase = { ...EXIT_ZONE, slug: room.exitTo ?? EXIT_ZONE.slug };
  const exitZone = room.kind === "pomodoro" ? { ...exitZoneBase, phase: { workMin: room.workMin, breakMin: room.breakMin } } : exitZoneBase;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      {/* Nazwa pokoju i nagroda XP: przypięte na stałe u góry ekranu (nie w wyśrodkowanym flow),
          żeby nie nakładały się na postać, którą kamera w RoomStage trzyma na środku ekranu —
          patrz też etykieta pod kwadratem pokoju w lobby (RoomStage) i ostrzeżenie przed utratą
          XP przy wyjściu w trakcie pracy. */}
      <div className="pointer-events-none fixed left-1/2 top-20 z-10 flex -translate-x-1/2 flex-col items-center gap-0.5 text-center">
        <h1 className="text-2xl font-semibold">{room.name}</h1>
        {room.kind === "arena" && <p className="font-semibold text-red-400">Watch out — an enemy roams this room</p>}
        {room.kind !== "shop" && room.kind !== "arena" && room.kind !== "empty" && (
          <p className="flex flex-col items-center gap-0.5 text-sm">
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
      </div>
      {room.kind === "stopwatch" ? (
        <Suspense fallback={null}>
          <TimerRoom roomSlug={room.slug} />
        </Suspense>
      ) : room.kind === "shop" ? (
        <Suspense fallback={null}>
          <ShopRoom roomSlug={room.slug} />
        </Suspense>
      ) : room.kind === "arena" ? (
        <Suspense fallback={null}>
          <RoomStage roomSlug={room.slug} zones={[exitZone]} spawnZoneSlug={exitZone.slug} />
        </Suspense>
      ) : room.kind === "empty" ? (
        <Suspense fallback={null}>
          <RoomStage roomSlug={room.slug} zones={[exitZone]} spawnZoneSlug={exitZone.slug} />
        </Suspense>
      ) : (
        <Suspense fallback={null}>
          <PomodoroRoom room={room} zones={[exitZone, START_SESSION_ZONE]} spawnZoneSlug={exitZone.slug} />
        </Suspense>
      )}
    </main>
  );
}
