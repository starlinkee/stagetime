export type Phase = "work" | "break";

export interface RoomConfig {
  slug: string;
  name: string;
  workMin: number;
  breakMin: number;
}

export interface TimerState {
  phase: Phase;
  /** ms do końca bieżącej fazy */
  remainingMs: number;
  /** długość bieżącej fazy w ms */
  phaseMs: number;
  /** numer cyklu w bieżącym okresie (od 1) */
  cycle: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * Czysta funkcja: stan timera zależy wyłącznie od czasu serwera (UTC) i konfiguracji pokoju.
 * - cykl <= 60 min: cykle startują od pełnej godziny; reszta godziny, w której nie mieści się
 *   pełny cykl, jest doliczana do ostatniej przerwy (wszyscy startują razem o pełnej godzinie).
 * - cykl > 60 min: cykle biegną nieprzerwanie od północy UTC.
 */
export function getTimerState(
  nowMs: number,
  room: Pick<RoomConfig, "workMin" | "breakMin">,
): TimerState {
  const work = room.workMin * MIN;
  const brk = room.breakMin * MIN;
  const cycleMs = work + brk;

  if (cycleMs <= HOUR) {
    const pos = nowMs % HOUR;
    const cycles = Math.floor(HOUR / cycleMs);
    const idx = Math.min(Math.floor(pos / cycleMs), cycles - 1);
    const inCycle = pos - idx * cycleMs;
    if (inCycle < work) {
      return { phase: "work", remainingMs: work - inCycle, phaseMs: work, cycle: idx + 1 };
    }
    const cycleEnd = idx === cycles - 1 ? HOUR - idx * cycleMs : cycleMs;
    return {
      phase: "break",
      remainingMs: cycleEnd - inCycle,
      phaseMs: cycleEnd - work,
      cycle: idx + 1,
    };
  }

  const pos = nowMs % DAY;
  const idx = Math.floor(pos / cycleMs);
  const inCycle = pos - idx * cycleMs;
  if (inCycle < work) {
    return { phase: "work", remainingMs: work - inCycle, phaseMs: work, cycle: idx + 1 };
  }
  return { phase: "break", remainingMs: cycleMs - inCycle, phaseMs: brk, cycle: idx + 1 };
}

export function formatMs(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
