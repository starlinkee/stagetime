"use client";
import { useEffect, useRef } from "react";
import { getSupabase } from "./supabase";
import { useSession } from "./useSession";

/** How often a heartbeat credits study XP while the room tab is open and visible. */
const HEARTBEAT_MS = 60_000;

export type StudyXpUpdate = { xp: number; study_seconds: number };

/**
 * Credits XP for time spent in a study room by calling `room_study_heartbeat` (see
 * supabase/migrations/0010_xp.sql), which measures elapsed time itself from the gap between
 * heartbeats — this hook only has to keep sending them, it can't inflate XP by reporting a
 * bigger gap than actually happened. Paused while the tab is hidden, so a backgrounded tab
 * doesn't keep earning XP. No-op in the lobby (not a study room) or when signed out.
 */
export function useStudyXp(roomSlug: string, onUpdate?: (u: StudyXpUpdate) => void) {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !userId || roomSlug === "lobby") return;
    let cancelled = false;

    const beat = () => {
      if (document.visibilityState !== "visible") return;
      void sb.rpc("room_study_heartbeat", { p_room: roomSlug }).then(({ data, error }) => {
        if (cancelled || error || !data) return;
        const row = (Array.isArray(data) ? data[0] : data) as StudyXpUpdate | undefined;
        if (row) onUpdateRef.current?.(row);
      });
    };

    beat();
    const interval = setInterval(beat, HEARTBEAT_MS);
    const onVisibilityChange = () => beat();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [roomSlug, userId]);
}
