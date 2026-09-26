"use client";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { getSupabase } from "./supabase";
import { useSession } from "./useSession";

export type FriendshipStatus = "pending" | "accepted" | "declined";

export type Friendship = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: FriendshipStatus;
  created_at: string;
};

export type FriendsState = {
  /** userId znajomych (status accepted). */
  friends: string[];
  /** Zaproszenia, które ktoś wysłał do nas i jeszcze nie odpowiedzieliśmy. */
  incomingRequests: Friendship[];
  /** Zaproszenia, które wysłaliśmy i wciąż czekają na odpowiedź. */
  outgoingRequests: Friendship[];
  error: string | null;
  loaded: boolean;
  sendRequest: (userId: string) => Promise<boolean>;
  acceptRequest: (id: string) => Promise<boolean>;
  declineRequest: (id: string) => Promise<boolean>;
  /** Cofa własne, jeszcze nierozpatrzone zaproszenie. */
  cancelRequest: (id: string) => Promise<boolean>;
};

/**
 * Znajomi + zaproszenia bieżącego użytkownika (patrz supabase/migrations/0042_friendships.sql).
 * Ten sam wzorzec co useChat/useConversations: wczytanie + Realtime, dwie subskrypcje bo Postgres
 * Changes filtruje tylko po jednej kolumnie, a relacja dotyczy dwóch (requester/addressee).
 */
export function useFriends(): FriendsState {
  const sb = getSupabase();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const [rows, setRows] = useState<Friendship[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const instanceId = useId();

  useEffect(() => {
    setLoaded(false);
    if (!sb || !userId) return;
    let cancelled = false;

    sb.from("friendships")
      .select("*")
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setError("Friends unavailable — the `friendships` table is missing (see supabase/migrations).");
          setLoaded(true);
          return;
        }
        setError(null);
        setRows(data as Friendship[]);
        setLoaded(true);
      });

    const upsert = (row: Friendship) => (prev: Friendship[]) =>
      prev.some((r) => r.id === row.id) ? prev.map((r) => (r.id === row.id ? row : r)) : [...prev, row];
    const remove = (id: string) => (prev: Friendship[]) => prev.filter((r) => r.id !== id);

    const channel = sb
      .channel(`friendships:${userId}:${instanceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "friendships", filter: `requester_id=eq.${userId}` },
        (payload) => {
          if (payload.eventType === "DELETE") setRows(remove((payload.old as Friendship).id));
          else setRows(upsert(payload.new as Friendship));
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "friendships", filter: `addressee_id=eq.${userId}` },
        (payload) => {
          if (payload.eventType === "DELETE") setRows(remove((payload.old as Friendship).id));
          else setRows(upsert(payload.new as Friendship));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      sb.removeChannel(channel);
    };
  }, [sb, userId, instanceId]);

  const friends = useMemo(
    () =>
      rows
        .filter((r) => r.status === "accepted")
        .map((r) => (r.requester_id === userId ? r.addressee_id : r.requester_id)),
    [rows, userId],
  );
  const incomingRequests = useMemo(
    () => rows.filter((r) => r.status === "pending" && r.addressee_id === userId),
    [rows, userId],
  );
  const outgoingRequests = useMemo(
    () => rows.filter((r) => r.status === "pending" && r.requester_id === userId),
    [rows, userId],
  );

  const sendRequest = useCallback(
    async (peerId: string) => {
      if (!sb || !userId || peerId === userId) return false;
      const { data, error } = await sb
        .from("friendships")
        .insert({ requester_id: userId, addressee_id: peerId })
        .select()
        .single();
      if (error) {
        console.warn("friendships insert", error);
        setError("Failed to send the friend request.");
        return false;
      }
      setError(null);
      setRows((prev) => (prev.some((r) => r.id === (data as Friendship).id) ? prev : [...prev, data as Friendship]));
      return true;
    },
    [sb, userId],
  );

  const respond = useCallback(
    async (id: string, status: "accepted" | "declined") => {
      if (!sb) return false;
      const { data, error } = await sb
        .from("friendships")
        .update({ status, responded_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) {
        console.warn("friendships update", error);
        setError("Failed to update the friend request.");
        return false;
      }
      setError(null);
      setRows((prev) => prev.map((r) => (r.id === id ? (data as Friendship) : r)));
      return true;
    },
    [sb],
  );

  const acceptRequest = useCallback((id: string) => respond(id, "accepted"), [respond]);
  const declineRequest = useCallback((id: string) => respond(id, "declined"), [respond]);

  const cancelRequest = useCallback(
    async (id: string) => {
      if (!sb) return false;
      const { error } = await sb.from("friendships").delete().eq("id", id);
      if (error) {
        console.warn("friendships delete", error);
        setError("Failed to cancel the friend request.");
        return false;
      }
      setError(null);
      setRows((prev) => prev.filter((r) => r.id !== id));
      return true;
    },
    [sb],
  );

  return { friends, incomingRequests, outgoingRequests, error, loaded, sendRequest, acceptRequest, declineRequest, cancelRequest };
}
