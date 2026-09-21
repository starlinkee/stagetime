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
  /** numer cyklu od EPOCH_MS (od 1) */
  cycle: number;
}

const MIN = 60_000;

/** Wspólny punkt startu wszystkich pokoi: od tej chwili każdy pokój odlicza swoje cykle w nieskończoność. */
export const EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

/**
 * Czysta funkcja: stan timera zależy wyłącznie od czasu serwera i konfiguracji pokoju.
 * Cykle (praca + przerwa) biegną nieprzerwanie od EPOCH_MS, bez żadnych resetów.
 */
export function getTimerState(
  nowMs: number,
  room: Pick<RoomConfig, "workMin" | "breakMin">,
): TimerState {
  const work = room.workMin * MIN;
  const brk = room.breakMin * MIN;
  const cycleMs = work + brk;

  const elapsed = nowMs - EPOCH_MS;
  const idx = Math.floor(elapsed / cycleMs);
  const inCycle = elapsed - idx * cycleMs;

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
