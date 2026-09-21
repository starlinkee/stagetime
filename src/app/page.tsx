import Link from "next/link";
import { RoomStage } from "@/components/RoomStage";
import { ROOMS } from "@/lib/rooms";

export default function Home() {
  return (
    <>
    <RoomStage />
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 p-8">
      <div>
        <h1 className="text-4xl font-bold">stagetime.io</h1>
        <p className="mt-2 text-zinc-400">
          One shared timer for everyone — accurate to the second. Pick a room.
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {ROOMS.map((r) => (
          <li key={r.slug}>
            <Link
              href={`/rooms/${r.slug}`}
              className="block rounded-xl border border-zinc-800 p-5 hover:border-zinc-600"
            >
              <div className="text-2xl font-semibold">
                {r.workMin} + {r.breakMin}
              </div>
              <div className="text-sm text-zinc-400">{r.name}</div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
    </>
  );
}
