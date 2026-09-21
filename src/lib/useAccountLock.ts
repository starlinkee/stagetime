"use client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "./supabase";

/** Id tej karty (od załadowania strony) — nie zmienia się przy przechodzeniu między pokojami. */
const TAB_ID = crypto.randomUUID();
/** Kiedy ta karta przejęła konto; nowsza karta tego samego konta wypiera starszą. */
let claim = Date.now();
let claimedFor: string | null = null;

type LockMeta = { claim: number };

/** Czy roszczenie (c, k) wygrywa z naszym; przy remisie decyduje id karty. */
const beatsMine = (c: number, k: string) => c > claim || (c === claim && k > TAB_ID);

/**
 * Jedno konto = jedna aktywna karta, w całym serwisie (nie tylko w jednym pokoju).
 * Kanał zależy tylko od konta, więc karta w innym pokoju też zostaje wyparta.
 * Nowsza karta rozgłasza przejęcie; starsza przechodzi w `superseded` i przestaje działać.
 * Kolejność wyznacza czas przejęcia, ale nowsza karta zawsze ogłasza się po dołączeniu,
 * więc różnice zegarów nie zostawiają dwóch aktywnych kart na dłużej niż moment.
 */
export function useAccountLock(userId: string | null) {
  const [superseded, setSuperseded] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !userId) return;
    // Zalogowanie (albo zmiana konta) w tej karcie to świeże przejęcie; przejście do innego pokoju nie.
    if (claimedFor !== userId) {
      claimedFor = userId;
      claim = Date.now();
    }
    const channel = sb.channel(`lock:${userId}`, { config: { presence: { key: TAB_ID } } });
    channelRef.current = channel;
    channel
      .on("broadcast", { event: "claim" }, ({ payload }) => {
        const { k, c } = payload as { k: string; c: number };
        if (k !== TAB_ID && Number.isFinite(c) && beatsMine(c, k)) setSuperseded(true);
      })
      .on("presence", { event: "sync" }, () => {
        for (const [k, metas] of Object.entries(channel.presenceState<LockMeta>())) {
          if (k === TAB_ID) continue;
          const c = Math.max(...metas.map((m) => m.claim));
          if (Number.isFinite(c) && beatsMine(c, k)) setSuperseded(true);
        }
      })
      .subscribe(async (status) => {
        if (status !== "SUBSCRIBED") return;
        await channel.track({ claim });
        void channel.send({ type: "broadcast", event: "claim", payload: { k: TAB_ID, c: claim } });
      });
    return () => {
      channelRef.current = null;
      setSuperseded(false);
      void sb.removeChannel(channel);
    };
  }, [userId]);

  /** „Play here”: ta karta przejmuje konto z powrotem, tamta zostaje wyparta. */
  const reclaim = useCallback(async () => {
    claim = Date.now();
    setSuperseded(false);
    const channel = channelRef.current;
    if (!channel) return;
    await channel.track({ claim });
    void channel.send({ type: "broadcast", event: "claim", payload: { k: TAB_ID, c: claim } });
  }, []);

  return { superseded, reclaim };
}
