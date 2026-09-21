"use client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { getSupabase } from "./supabase";
import { useSession } from "./useSession";

export type PresenceCounts = {
  /** Różni zalogowani użytkownicy (kilka kart tej samej osoby liczy się raz). */
  signedIn: number;
  /** Karty bez zalogowanej sesji. */
  signedOut: number;
  /** Id zalogowanych użytkowników z otwartą kartą (każdy raz). */
  users: string[];
};

/** Kanał obecności obejmujący całą stronę, niezależnie od pokoju. */
export const GLOBAL_PRESENCE = "global";

type Meta = { at: number; user: string | null };

/**
 * Osoby z otwartą kartą w danym kanale (Supabase Realtime Presence): zalogowani
 * i niezalogowani — rozłącznie, zalogowany nigdy nie liczy się jako niezalogowany.
 * Bez Supabase: jedna karta niezalogowana (tryb lokalny).
 * `channelKey === null` wyłącza nasłuch — ta sama karta nie może dołączyć do
 * jednego kanału dwa razy, bo policzyłaby się jako dwie osoby.
 */
export function usePresence(channelKey: string | null): PresenceCounts {
  const [counts, setCounts] = useState<PresenceCounts>({ signedIn: 0, signedOut: 1, users: [] });
  const { ready, session } = useSession();
  const userId = session?.user.id ?? null;
  // Stały klucz obecności tej karty — zmiana tożsamości nadpisuje wpis, nie tworzy drugiego.
  // Trzymany w sessionStorage: odświeżenie strony / HMR używa tego samego klucza, więc nie zostaje
  // „duch” poprzedniego ładowania, który serwer usuwa dopiero po timeoucie.
  const [presenceKey] = useState(() => {
    try {
      const saved = sessionStorage.getItem("presenceKey");
      if (saved) return saved;
      const fresh = crypto.randomUUID();
      sessionStorage.setItem("presenceKey", fresh);
      return fresh;
    } catch {
      return crypto.randomUUID();
    }
  });
  const channelRef = useRef<RealtimeChannel | null>(null);
  const userIdRef = useRef(userId);

  useEffect(() => {
    const sb = getSupabase();
    // Czekamy na odczyt sesji, żeby nie dołączać do kanału jako anonim i zaraz ponownie jako zalogowany.
    if (!sb || !ready || !channelKey) return;
    const channel = sb.channel(`presence:${channelKey}`, {
      config: { presence: { key: presenceKey } },
    });
    channelRef.current = channel;
    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<Meta>();
        const users = new Set<string>();
        let signedOut = 0;
        for (const metas of Object.values(state)) {
          // Kolejne track() z tej samej karty dokłada wpis obok poprzedniego,
          // więc o stanie karty decyduje tylko najświeższy z nich.
          const latest = metas.reduce<Meta | null>(
            (best, meta) => (best && best.at >= meta.at ? best : meta),
            null,
          );
          if (!latest) continue;
          if (latest.user) users.add(latest.user);
          else signedOut += 1;
        }
        setCounts({ signedIn: users.size, signedOut, users: [...users].sort() });
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") await channel.track({ at: Date.now(), user: userIdRef.current });
      });
    return () => {
      channelRef.current = null;
      sb.removeChannel(channel);
    };
    // userId celowo poza zależnościami: logowanie aktualizuje wpis, nie przebudowuje kanału.
  }, [channelKey, ready, presenceKey]);

  // Zalogowanie / wylogowanie w otwartej karcie: nadpisujemy własny wpis obecności.
  useEffect(() => {
    userIdRef.current = userId;
    const channel = channelRef.current;
    if (channel?.state !== "joined") return;
    // untrack() usuwa poprzedni wpis tej karty, żeby nie liczyła się dwa razy.
    void channel.untrack().then(() => channel.track({ at: Date.now(), user: userId }));
  }, [userId]);

  return counts;
}
