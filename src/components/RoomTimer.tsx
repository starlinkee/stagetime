"use client";
import { useEffect, useRef } from "react";
import { playSessionEndChime } from "@/lib/chime";
import { formatMs, getSessionTimerState, type Phase, type PomodoroRoomConfig } from "@/lib/timer";
import { useServerNow } from "@/lib/useServerClock";
import type { PomodoroSessionState } from "@realtime-shared/types";

function Counter({
  label,
  time,
  active,
  color,
}: {
  label: string;
  time: string;
  active: boolean;
  color: "sky" | "emerald";
}) {
  const tone = color === "sky" ? "text-sky-300" : "text-emerald-300";
  return (
    <div className={`flex flex-col items-center gap-2 ${active ? "" : "opacity-40"}`}>
      <span className={`text-sm font-medium ${tone}`}>{label}</span>
      <span className="font-mono text-6xl tabular-nums sm:text-7xl">{time}</span>
    </div>
  );
}

/**
 * STU-58: `session` comes from the realtime-server's own broadcast (see PomodoroSessionState),
 * relayed by RoomStage.tsx via `onPomodoroState` — never computed locally. `null` covers both
 * "not connected yet" and "not a pomodoro room", same as before this session model existed.
 */
export function RoomTimer({ room, session }: { room: PomodoroRoomConfig; session: PomodoroSessionState | null }) {
  const now = useServerNow();
  const s = now === null || !session ? null : getSessionTimerState(now, session, room);
  const remainingLabel = s ? formatMs(s.remainingMs) : null;
  const isWork = s?.phase === "work";
  const isWaiting = s?.phase === "waiting";

  // Pokazuje pozostały czas fazy w tytule karty, żeby było go widać bez przełączania się na tę
  // kartę (STU-7) — tylko przy zmianie wyświetlanej sekundy, nie co tick zegara (250ms). Reset
  // tytułu w osobnym efekcie (tylko przy odmontowaniu), żeby nie migać nim przy każdej sekundzie.
  // Hooki muszą biec przed ewentualnym wczesnym returnem (rules-of-hooks) — stąd `s` może być null.
  useEffect(() => {
    if (!remainingLabel || isWaiting) return;
    document.title = `${remainingLabel} · ${isWork ? "Work" : "Break"} — StudyQuest.Party`;
  }, [remainingLabel, isWork, isWaiting]);
  useEffect(() => {
    return () => {
      document.title = "StudyQuest.Party";
    };
  }, []);

  // Dźwięk gdy sesja pracy się kończy (STU-24) — tylko na przejściu work -> break, nie przy
  // pierwszym renderze (prevPhaseRef zaczyna jako null, więc wejście w trakcie przerwy nie gra).
  const phase: Phase | null = s?.phase ?? null;
  const prevPhaseRef = useRef<Phase | null>(null);
  useEffect(() => {
    if (prevPhaseRef.current === "work" && phase === "break") playSessionEndChime();
    prevPhaseRef.current = phase;
  }, [phase]);

  if (!s) return <p className="text-zinc-400">Syncing clock…</p>;

  if (isWaiting) {
    return <p className="text-zinc-400">Nobody's started this session yet — hold E on the button in the middle to start it for everyone here.</p>;
  }

  const progress = 1 - s.remainingMs / s.phaseMs;
  const workMs = room.workMin * 60_000;
  const breakMs = room.breakMin * 60_000;

  // Aktywna faza pokazuje pozostały czas, nieaktywna — pełną długość.
  const workFill = isWork ? progress : 1;
  const breakFill = isWork ? 0 : progress;

  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-6">
      <div className="flex w-full items-start justify-center gap-10">
        <Counter
          label="Work"
          time={formatMs(isWork ? s.remainingMs : workMs)}
          active={isWork}
          color="sky"
        />
        <Counter
          label="Break"
          time={formatMs(isWork ? breakMs : s.remainingMs)}
          active={!isWork}
          color="emerald"
        />
      </div>
      {/* Szerokość segmentów proporcjonalna do długości faz */}
      <div className="flex h-3 w-full gap-1">
        <div
          className={`overflow-hidden rounded-full bg-sky-500/20 ${isWork ? "" : "opacity-50"}`}
          style={{ flexGrow: workMs, flexBasis: 0 }}
        >
          <div className="h-full bg-sky-400" style={{ width: `${workFill * 100}%` }} />
        </div>
        <div
          className={`min-w-2 overflow-hidden rounded-full bg-emerald-500/20 ${isWork ? "opacity-50" : ""}`}
          style={{ flexGrow: breakMs, flexBasis: 0 }}
        >
          <div className="h-full bg-emerald-400" style={{ width: `${breakFill * 100}%` }} />
        </div>
      </div>
    </div>
  );
}
