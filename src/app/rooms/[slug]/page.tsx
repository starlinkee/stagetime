import { notFound } from "next/navigation";
import { Suspense } from "react";
import { RoomStage } from "@/components/RoomStage";
import { RoomTimer } from "@/components/RoomTimer";
import { TimerRoom } from "@/components/TimerRoom";
import { EXIT_ZONE, getRoom, ROOMS } from "@/lib/rooms";

export function generateStaticParams() {
  return ROOMS.map((r) => ({ slug: r.slug }));
}

export default async function RoomPage({ params }: PageProps<"/rooms/[slug]">) {
  const { slug } = await params;
  const room = getRoom(slug);
  if (!room) notFound();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <h1 className="text-2xl font-semibold">{room.name}</h1>
      {room.kind === "stopwatch" ? (
        <Suspense fallback={null}>
          <TimerRoom roomSlug={room.slug} />
        </Suspense>
      ) : (
        <>
          <RoomTimer room={room} />
          <Suspense fallback={null}>
            <RoomStage roomSlug={room.slug} zones={[EXIT_ZONE]} spawnZoneSlug={EXIT_ZONE.slug} />
          </Suspense>
        </>
      )}
    </main>
  );
}
