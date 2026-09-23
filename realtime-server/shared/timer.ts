/**
 * Server-side mirror of `getTimerState`'s phase math in src/lib/timer.ts — kept here (not
 * imported, this server can't reach into Next.js code) so `server.ts` can decide, independent of
 * any client, whether a pomodoro room is currently in its "work" phase (see `getRoomPhase` in
 * ./rooms.ts). Only the phase itself is needed here, not `remainingMs`/`phaseMs`/`cycle` — those
 * are purely a client display concern.
 *
 * EPOCH_MS must match src/lib/timer.ts's EPOCH_MS exactly, or this server and every client would
 * disagree about which phase a room is in.
 */

export type Phase = "work" | "break";

const MIN = 60_000;

export const EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

export function getPhase(nowMs: number, workMin: number, breakMin: number, offsetMs = 0): Phase {
  const work = workMin * MIN;
  const brk = breakMin * MIN;
  const cycleMs = work + brk;
  const elapsed = nowMs - EPOCH_MS + offsetMs;
  const idx = Math.floor(elapsed / cycleMs);
  const inCycle = elapsed - idx * cycleMs;
  return inCycle < work ? "work" : "break";
}
