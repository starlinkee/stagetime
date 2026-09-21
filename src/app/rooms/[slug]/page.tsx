import Link from "next/link";
import { notFound } from "next/navigation";
import { RoomChat } from "@/components/RoomChat";
import { RoomStage } from "@/components/RoomStage";
import { RoomTimer } from "@/components/RoomTimer";
import { getRoom, ROOMS } from "@/lib/rooms";

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
      <RoomTimer room={room} />
      <RoomStage roomSlug={room.slug} />
      <RoomChat roomSlug={room.slug} />
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">
        ← All rooms
      </Link>
    </main>
  );
}
