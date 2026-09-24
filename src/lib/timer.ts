export type Phase = "work" | "break";

export interface PomodoroRoomConfig {
  slug: string;
  name: string;
  kind: "pomodoro";
  workMin: number;
  breakMin: number;
  /** Kolor kwadratu pokoju w lobby (odcień wspólny dla wariantów tego samego typu). */
  color?: string;
  /**
   * Przesunięcie fazy względem EPOCH_MS — warianty tego samego typu są rozłożone równomiernie
   * w cyklu (liczba wariantów zależy od typu, patrz pomodoroVariants w lib/rooms.ts), tak żeby
   * zawsze przynajmniej jeden był akurat na przerwie.
   */
  offsetMs?: number;
}

/** Pokój z prywatnym stoperem każdej osoby (bez wspólnych cykli pracy/przerwy). */
export interface StopwatchRoomConfig {
  slug: string;
  name: string;
  kind: "stopwatch";
  color?: string;
}

/** Sklep: nie zarabia się tu XP/coinów, można je za to wydać (patrz src/components/ShopRoom.tsx). */
export interface ShopRoomConfig {
  slug: string;
  name: string;
  kind: "shop";
  color?: string;
}

/** Arena: no timer/XP here either (like Shop) — one room-owned enemy everyone can fight, spawned
 * server-side at full HP whenever the room isn't empty (see ARENA_ROOM_SLUG in
 * realtime-server/shared/constants.ts). */
export interface ArenaRoomConfig {
  slug: string;
  name: string;
  kind: "arena";
  color?: string;
}

export type RoomConfig = PomodoroRoomConfig | StopwatchRoomConfig | ShopRoomConfig | ArenaRoomConfig;

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
  room: Pick<PomodoroRoomConfig, "workMin" | "breakMin" | "offsetMs">,
): TimerState {
  const work = room.workMin * MIN;
  const brk = room.breakMin * MIN;
  const cycleMs = work + brk;

  const elapsed = nowMs - EPOCH_MS + (room.offsetMs ?? 0);
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
