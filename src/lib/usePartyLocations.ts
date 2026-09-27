"use client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { ROOMS } from "./rooms";
import { getSupabase } from "./supabase";

type Meta = { at: number; user?: string | null };

/** Every world3:<slug> channel that can carry presence — the two lobbies plus every room in
 * ROOMS (see RoomStage.tsx, which tracks into `world3:${roomSlug}` for whichever slug it's
 * mounted as). Module-level since ROOMS is static. */
const ALL_SLUGS = ["lobby", "lobby2", ...ROOMS.map((r) => r.slug)];

/** userId -> room slug they're currently present in. A user id absent from the result is offline
 * (not present in any known room, including the lobby). */
export type PartyLocations = Record<string, string>;

/**
 * STU-74: read-only presence lookup across every known room, for the Party panel's "online in
 * <room>" per member — same non-tracking subscribe-only pattern as useRoomOccupancy.ts, but keyed
 * by user id instead of counted, and only subscribed while `userIds` is non-empty (the panel
 * passes `[]` while closed, so this costs nothing when nobody's looking at it).
 */
export function usePartyLocations(userIds: string[]): PartyLocations {
  const [locations, setLocations] = useState<PartyLocations>({});
  const idsKey = userIds.slice().sort().join(",");

  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !idsKey) {
      setLocations({});
      return;
    }
    const wanted = new Set(idsKey.split(","));
    const perSlug = new Map<string, Set<string>>();
    const recompute = () => {
      const next: PartyLocations = {};
      for (const [slug, users] of perSlug) {
        for (const u of users) if (wanted.has(u)) next[u] = slug;
      }
      setLocations(next);
    };
    const channels: RealtimeChannel[] = ALL_SLUGS.map((slug) => {
      const channel: RealtimeChannel = sb.channel(`world3:${slug}`, {
        config: { presence: { key: crypto.randomUUID() } },
      });
      channel
        .on("presence", { event: "sync" }, () => {
          const state = channel.presenceState<Meta>();
          const users = new Set<string>();
          for (const metas of Object.values(state)) {
            const latest = metas.reduce<Meta | null>((best, m) => (best && best.at >= m.at ? best : m), null);
            if (latest?.user) users.add(latest.user);
          }
          perSlug.set(slug, users);
          recompute();
        })
        .subscribe();
      return channel;
    });
    return () => {
      for (const channel of channels) void sb.removeChannel(channel);
    };
  }, [idsKey]);

  return locations;
}
