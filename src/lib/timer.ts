export type Phase = "waiting" | "work" | "break";

export interface PomodoroRoomConfig {
  slug: string;
  name: string;
  kind: "pomodoro";
  workMin: number;
  breakMin: number;
  /** Kolor kwadratu pokoju w lobby. */
  color?: string;
  /** STU-56: which lobby this room's exit zone leads back to (a slug in
   * realtime-server/shared/rooms.ts's LOBBY_SLUGS) — defaults to `"lobby"` when omitted. Used by
   * /rooms/[slug]/page.tsx to build the room's `exitZone` from EXIT_ZONE, so e.g. arena-2/timer-2
   * (lobby2's own rooms) exit back into lobby2 instead of the main lobby. */
  exitTo?: string;
}

/** Pokój z prywatnym stoperem każdej osoby (bez wspólnych cykli pracy/przerwy). */
export interface StopwatchRoomConfig {
  slug: string;
  name: string;
  kind: "stopwatch";
  color?: string;
  exitTo?: string;
}

/** Sklep: nie zarabia się tu XP/coinów, można je za to wydać (patrz src/components/ShopRoom.tsx). */
export interface ShopRoomConfig {
  slug: string;
  name: string;
  kind: "shop";
  color?: string;
  exitTo?: string;
}

/** Arena: no timer/XP here either (like Shop) — one room-owned enemy everyone can fight, spawned
 * server-side at full HP whenever the room isn't empty (see ARENA_ROOM_SLUG in
 * realtime-server/shared/constants.ts). */
export interface ArenaRoomConfig {
  slug: string;
  name: string;
  kind: "arena";
  color?: string;
  exitTo?: string;
}

/** A room with nothing in it beyond its exit zone — no timer, no shop, no enemy, no XP/coins. */
export interface EmptyRoomConfig {
  slug: string;
  name: string;
  kind: "empty";
  color?: string;
  exitTo?: string;
}

export type RoomConfig = PomodoroRoomConfig | StopwatchRoomConfig | ShopRoomConfig | ArenaRoomConfig | EmptyRoomConfig;

export interface SessionTimerState {
  phase: Phase;
  /** ms do końca bieżącej fazy (dla "waiting": pełna długość fazy work, nic jeszcze nie płynie). */
  remainingMs: number;
  /** długość bieżącej fazy w ms */
  phaseMs: number;
}

const MIN = 60_000;

/**
 * STU-58: instance-relative, not a pure function of wall-clock time — a pomodoro room no longer
 * runs on a shared, always-ticking global cycle (there's no more EPOCH_MS/offsetMs). Each room
 * instance starts its own work/break cycle on demand (see PomodoroSessionState in
 * @realtime-shared/types, set from the realtime-server's own instance state — RoomStage.tsx is the
 * only thing that ever calls this, fed by that server broadcast, never a locally-guessed clock).
 * `session` is `null`/`state: "waiting"` before anyone's started it — the client shows the full
 * work length instead of counting down, and there's nothing running yet to disagree about.
 */
export function getSessionTimerState(
  now: number,
  session: { state: Exclude<Phase, "waiting"> | "waiting"; startedAt: number | null },
  room: Pick<PomodoroRoomConfig, "workMin" | "breakMin">,
): SessionTimerState {
  const workMs = room.workMin * MIN;
  const breakMs = room.breakMin * MIN;
  if (session.state === "waiting" || session.startedAt === null) {
    return { phase: "waiting", remainingMs: workMs, phaseMs: workMs };
  }
  const elapsed = Math.max(0, now - session.startedAt);
  if (elapsed < workMs) return { phase: "work", remainingMs: workMs - elapsed, phaseMs: workMs };
  return { phase: "break", remainingMs: Math.max(0, workMs + breakMs - elapsed), phaseMs: breakMs };
}

export function formatMs(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
