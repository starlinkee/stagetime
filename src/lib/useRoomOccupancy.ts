"use client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { getSupabase } from "./supabase";

type Meta = { at: number; user?: string | null };

/**
 * Ile odrębnych osób jest naprawdę w danym pokoju (kanał `world3:<slug>` w RoomStage), dla listy
 * slugów naraz — bez dołączania do tych pokoi (tylko podgląd presence, bez track()), więc podgląd
 * z lobby nie liczy się jako obecność w pokoju. Brak wpisu w wyniku = dane jeszcze nie doszły.
 */
export function useRoomOccupancy(slugs: string[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const slugsKey = slugs.join(",");

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !slugsKey) return;
    const list = slugsKey.split(",");
    const channels = list.map((slug) => {
      const channel: RealtimeChannel = sb.channel(`world3:${slug}`, {
        config: { presence: { key: crypto.randomUUID() } },
      });
      channel
        .on("presence", { event: "sync" }, () => {
          const state = channel.presenceState<Meta>();
          const users = new Set<string>();
          let anon = 0;
          for (const metas of Object.values(state)) {
            // Kilka wpisów tej samej karty (kolejne track()) — liczy się tylko najświeższy.
            const latest = metas.reduce<Meta | null>((best, m) => (best && best.at >= m.at ? best : m), null);
            if (!latest) continue;
            if (latest.user) users.add(latest.user);
            else anon += 1;
          }
          setCounts((prev) => ({ ...prev, [slug]: users.size + anon }));
        })
        .subscribe();
      return channel;
    });
    return () => {
      for (const channel of channels) void sb.removeChannel(channel);
    };
  }, [slugsKey]);

  return counts;
}
