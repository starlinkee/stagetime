/**
 * Copper coins — a second reward on top of XP (see src/lib/xp.ts), earned at its own rate:
 * 1 coin per minute of continuous presence in a study room (5 coins per 5 min, work or break
 * phase alike). The Timer Room pays a tenth of that, 0.1 coin per minute, and only while the
 * stopwatch is running — see src/components/TimerRoom.tsx and supabase/migrations/0015_coins.sql.
 */
export const STUDY_SECONDS_PER_COIN = 60;

/** Copper coins earned for `minutes` of continuous study time — the reward shown for a room's work session. */
export function coinsForMinutes(minutes: number): number {
  return Math.round((minutes * 60) / STUDY_SECONDS_PER_COIN);
}
