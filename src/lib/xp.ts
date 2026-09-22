/**
 * Study time worth 1 XP — continuous presence in a study room, work or break alike. The Timer
 * Room is an exception: it accrues at a tenth of this rate (0.1 XP per 5 min, i.e. 1 XP per
 * 50 min) and only while the stopwatch is running — see supabase/migrations/0014_timer_xp_rate.sql
 * and src/lib/useStudyXp.ts.
 */
export const STUDY_SECONDS_PER_XP = 300;

/** XP earned for `minutes` of continuous study time — the reward shown for a room's work session. */
export function xpForMinutes(minutes: number): number {
  return Math.round((minutes * 60) / STUDY_SECONDS_PER_XP);
}

const LEVEL_BASE = 4;
const LEVEL_EXPONENT = 1.3;

/**
 * XP needed to go from `level` to `level + 1`. Growing power curve: level 1→2 takes 4 XP
 * (20 minutes), while reaching level 10 takes roughly 30 hours of cumulative study time —
 * usually a few days for a regular user.
 */
export function xpForLevel(level: number): number {
  return Math.round(LEVEL_BASE * Math.max(1, level) ** LEVEL_EXPONENT);
}

export type LevelInfo = {
  level: number;
  /** XP earned within the current level — fractional (0.1 steps), not floored. */
  intoLevel: number;
  /** XP needed to reach the next level. */
  forNextLevel: number;
};

/** Level (starting at 1) implied by a total XP amount. */
export function levelFromXp(xp: number): LevelInfo {
  let level = 1;
  let remaining = Math.max(0, xp);
  for (;;) {
    const need = xpForLevel(level);
    if (remaining < need) return { level, intoLevel: remaining, forNextLevel: need };
    remaining -= need;
    level += 1;
  }
}
