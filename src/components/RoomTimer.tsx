"use client";
import { formatMs, getTimerState, type RoomConfig } from "@/lib/timer";
import { useServerNow } from "@/lib/useServerClock";
import { usePresence } from "@/lib/usePresence";

export function RoomTimer({ room }: { room: RoomConfig }) {
  const now = useServerNow();
  const viewers = usePresence(room.slug);

  if (now === null) return <p className="text-zinc-400">Synchronizuję zegar…</p>;

  const s = getTimerState(now, room);
  const isWork = s.phase === "work";
  const progress = 1 - s.remainingMs / s.phaseMs;

  return (
    <div className="flex flex-col items-center gap-6">
      <span
        className={`rounded-full px-4 py-1 text-sm font-medium ${
          isWork ? "bg-rose-500/20 text-rose-300" : "bg-emerald-500/20 text-emerald-300"
        }`}
      >
        {isWork ? "Praca" : "Przerwa"}
      </span>
      <div className="font-mono text-8xl tabular-nums">{formatMs(s.remainingMs)}</div>
      <div className="h-2 w-72 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full ${isWork ? "bg-rose-400" : "bg-emerald-400"}`}
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <p className="text-zinc-400">👀 Obserwujących: {viewers}</p>
    </div>
  );
}
