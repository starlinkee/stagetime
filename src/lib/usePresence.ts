"use client";
import { useEffect, useState } from "react";
import { getSupabase } from "./supabase";

/** Liczba osób z otwartą kartą w pokoju (Supabase Realtime Presence). Bez Supabase: 1. */
export function usePresence(roomSlug: string): number {
  const [count, setCount] = useState(1);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    const channel = sb.channel(`room:${roomSlug}`, {
      config: { presence: { key: crypto.randomUUID() } },
    });
    channel
      .on("presence", { event: "sync" }, () => {
        setCount(Object.keys(channel.presenceState()).length);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") await channel.track({ at: Date.now() });
      });
    return () => {
      sb.removeChannel(channel);
    };
  }, [roomSlug]);

  return count;
}
