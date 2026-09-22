"use client";
import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase";
import { useSession } from "./useSession";

export type StopwatchSave = { id: string; elapsed_ms: number; created_at: string };

/** Ile ostatnich zapisów wczytujemy przy wejściu do pokoju. */
const HISTORY_LIMIT = 50;

export type StopwatchSavesState = {
  /** Własne zapisane czasy w tym pokoju, najnowsze pierwsze. */
  saves: StopwatchSave[];
  /** Dopisuje czas na listę — do bazy dla zalogowanych, tylko w tej karcie bez konta. */
  save: (elapsedMs: number) => Promise<void>;
  /** false, gdy zapisy nie przetrwają odświeżenia strony (brak konta albo Supabase). */
  persistent: boolean;
};

/** Prywatna lista zapisanych czasów stopera jednej osoby w danym pokoju (tabela `stopwatch_saves`). */
export function useStopwatchSaves(roomSlug: string): StopwatchSavesState {
  const sb = getSupabase();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  // Powiązane z (room, userId), którym wczytano — inaczej po zmianie pokoju/konta
  // przez chwilę widać zapisy sprzed zmiany.
  const [loaded, setLoaded] = useState<{ room: string; userId: string; items: StopwatchSave[] } | null>(null);

  useEffect(() => {
    if (!sb || !userId) return;
    let cancelled = false;
    sb.from("stopwatch_saves")
      .select("id, elapsed_ms, created_at")
      .eq("room", roomSlug)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT)
      .then(({ data, error }) => {
        if (cancelled || error) return;
        setLoaded({ room: roomSlug, userId, items: data as StopwatchSave[] });
      });
    return () => {
      cancelled = true;
    };
  }, [sb, userId, roomSlug]);

  const current = loaded && loaded.room === roomSlug && loaded.userId === userId ? loaded.items : [];

  const save = useCallback(
    async (elapsedMs: number) => {
      const ms = Math.max(0, Math.round(elapsedMs));
      if (!sb || !userId) {
        setLoaded((prev) => ({
          room: roomSlug,
          userId: userId ?? "",
          items: [
            { id: crypto.randomUUID(), elapsed_ms: ms, created_at: new Date().toISOString() },
            ...(prev && prev.room === roomSlug && prev.userId === (userId ?? "") ? prev.items : []),
          ],
        }));
        return;
      }
      const { data, error } = await sb
        .from("stopwatch_saves")
        .insert({ room: roomSlug, user_id: userId, elapsed_ms: ms })
        .select("id, elapsed_ms, created_at")
        .single();
      if (error) {
        console.warn("stopwatch_saves insert (see supabase/migrations/0005)", error);
        return;
      }
      setLoaded((prev) => ({
        room: roomSlug,
        userId,
        items: [data as StopwatchSave, ...(prev && prev.room === roomSlug && prev.userId === userId ? prev.items : [])],
      }));
    },
    [sb, userId, roomSlug],
  );

  return { saves: current, save, persistent: sb !== null && userId !== null };
}
