"use client";
import { useEffect, useRef } from "react";
import { getSupabase } from "./supabase";
import { useSession } from "./useSession";

/** How often a heartbeat credits study XP while the room tab is open and visible. */
const HEARTBEAT_MS = 60_000;

export type StudyXpUpdate = { xp: number; study_seconds: number; coins: number };

/**
 * Credits XP and copper coins for time spent in a study room by calling `room_study_heartbeat`
 * (see supabase/migrations/0010_xp.sql, 0014_timer_xp_rate.sql and 0015_coins.sql), which measures elapsed time
 * itself from the gap between heartbeats — this hook only has to keep sending them, it can't
 * inflate XP by reporting a bigger gap than actually happened. Paused while the tab is hidden,
 * so a backgrounded tab doesn't keep earning XP. No-op in the lobby or Shop (not study rooms) or
 * when signed out.
 *
 * `running` (default true) gates accrual — used by the Timer Room to only credit XP while the
 * stopwatch is started (see src/components/TimerRoom.tsx and RoomStage's `xpRunning` prop).
 * Sent as `p_running` on every heartbeat, including an immediate one fired right when it
 * flips, so pausing stops the clock (and doesn't leave a stale gap to credit on resume) without
 * waiting for the next 60s tick.
 *
 * The very first heartbeat of a mount is sent with `p_reset: true` — it only syncs the clock to
 * now and fetches current totals, crediting nothing. Without this, entering a room would credit
 * whatever time had passed since the user's last heartbeat *anywhere* (a different room, or the
 * lobby in between), i.e. free reward for walking in and immediately back out. Only the periodic
 * 60s ticks and visibility-change beats after that credit real elapsed time.
 */
const NON_STUDY_ROOMS = new Set(["lobby", "shop"]);

export function useStudyXp(
  roomSlug: string,
  running = true,
  /**
   * `credited` is false only for the very first (p_reset) heartbeat of a mount, which syncs the
   * clock without crediting anything — see doc above. Every other call means real xp/coins may
   * have just been added, which is what RoomStage uses to trigger the "+1 coin / +xp" popup.
   */
  onUpdate?: (u: StudyXpUpdate, credited: boolean) => void,
) {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !userId || NON_STUDY_ROOMS.has(roomSlug)) return;
    let cancelled = false;
    let isFirstBeat = true;

    const beat = () => {
      if (document.visibilityState !== "visible") return;
      const p_reset = isFirstBeat;
      isFirstBeat = false;
      void sb
        .rpc("room_study_heartbeat", { p_room: roomSlug, p_running: running, p_reset })
        .then(({ data, error }) => {
          if (cancelled || error || !data) return;
          const row = (Array.isArray(data) ? data[0] : data) as StudyXpUpdate | undefined;
          if (row) onUpdateRef.current?.(row, !p_reset);
        });
    };

    beat();
    const interval = running ? setInterval(beat, HEARTBEAT_MS) : null;
    const onVisibilityChange = () => beat();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [roomSlug, userId, running]);
}
