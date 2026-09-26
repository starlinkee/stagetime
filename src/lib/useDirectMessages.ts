"use client";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { getSupabase } from "./supabase";
import { useSession } from "./useSession";

export type DirectMessage = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
};

/** Ile ostatnich wiadomości wczytujemy przy otwarciu wątku. */
const HISTORY_LIMIT = 50;
/** Limit długości wiadomości — taki sam jak CHECK w bazie (supabase/migrations/0041). */
export const MAX_DM_BODY = 500;

export type Conversation = {
  /** Drugi uczestnik rozmowy. */
  peerId: string;
  lastMessage: DirectMessage;
};

/**
 * Lista rozmów: jeden wiersz na osobę, z którą kiedykolwiek wymieniono DM, posortowana
 * po czasie ostatniej wiadomości. Nowe wiadomości (przychodzące i wysłane z innej karty/instancji)
 * dokładają się na żywo przez Realtime — Postgres Changes filtruje tylko po jednej kolumnie, więc
 * potrzebne są dwie osobne subskrypcje (przychodzące i wychodzące), tak jak w `useFriends`.
 */
export function useConversations(): {
  conversations: Conversation[];
  error: string | null;
  loaded: boolean;
} {
  const sb = getSupabase();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const instanceId = useId();

  useEffect(() => {
    setLoaded(false);
    if (!sb || !userId) return;
    let cancelled = false;

    sb.from("direct_messages")
      .select("*")
      .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setError("Direct messages unavailable — the `direct_messages` table is missing (see supabase/migrations).");
          setLoaded(true);
          return;
        }
        setError(null);
        setMessages(data as DirectMessage[]);
        setLoaded(true);
      });

    const channel = sb
      .channel(`dm-conversations:${userId}:${instanceId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "direct_messages", filter: `recipient_id=eq.${userId}` },
        ({ new: row }) => setMessages((prev) => appendDm(prev, row as DirectMessage)),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "direct_messages", filter: `sender_id=eq.${userId}` },
        ({ new: row }) => setMessages((prev) => appendDm(prev, row as DirectMessage)),
      )
      .subscribe();

    return () => {
      cancelled = true;
      sb.removeChannel(channel);
    };
  }, [sb, userId, instanceId]);

  const conversations = useMemo(() => {
    if (!userId) return [];
    const byPeer = new Map<string, DirectMessage>();
    for (const m of messages) {
      const peerId = m.sender_id === userId ? m.recipient_id : m.sender_id;
      const existing = byPeer.get(peerId);
      if (!existing || existing.created_at < m.created_at) byPeer.set(peerId, m);
    }
    return [...byPeer.entries()]
      .map(([peerId, lastMessage]) => ({ peerId, lastMessage }))
      .sort((a, b) => (a.lastMessage.created_at < b.lastMessage.created_at ? 1 : -1));
  }, [messages, userId]);

  return { conversations, error, loaded };
}

/** Dodaje wiadomość do lokalnej listy, jeśli jeszcze jej tam nie ma (echo z Realtime po własnym insercie). */
function appendDm(prev: DirectMessage[], msg: DirectMessage): DirectMessage[] {
  return prev.some((m) => m.id === msg.id) ? prev : [...prev, msg];
}

export type ThreadState = {
  messages: DirectMessage[];
  error: string | null;
  loaded: boolean;
  send: (body: string) => Promise<boolean>;
};

/** Wątek DM z jednym konkretnym peerId — historia + Realtime + wysyłanie, ten sam wzorzec co useChat. */
export function useThread(peerId: string | null): ThreadState {
  const sb = getSupabase();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const instanceId = useId();

  useEffect(() => {
    setLoaded(false);
    setMessages([]);
    if (!sb || !userId || !peerId) return;
    let cancelled = false;

    sb.from("direct_messages")
      .select("*")
      .or(`and(sender_id.eq.${userId},recipient_id.eq.${peerId}),and(sender_id.eq.${peerId},recipient_id.eq.${userId})`)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setError("Direct messages unavailable — the `direct_messages` table is missing (see supabase/migrations).");
          setLoaded(true);
          return;
        }
        setError(null);
        setMessages((data as DirectMessage[]).reverse());
        setLoaded(true);
      });

    const channel = sb
      .channel(`dm-thread:${userId}:${peerId}:${instanceId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "direct_messages", filter: `recipient_id=eq.${userId}` },
        ({ new: row }) => {
          const msg = row as DirectMessage;
          if (msg.sender_id !== peerId) return;
          setMessages((prev) => appendDm(prev, msg));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      sb.removeChannel(channel);
    };
  }, [sb, userId, peerId, instanceId]);

  const send = useCallback(
    async (body: string) => {
      const text = body.trim().slice(0, MAX_DM_BODY);
      if (!sb || !userId || !peerId || !text) return false;
      const { data, error } = await sb
        .from("direct_messages")
        .insert({ sender_id: userId, recipient_id: peerId, body: text })
        .select()
        .single();
      if (error) {
        console.warn("direct_messages insert (see supabase/migrations)", error);
        setError("Failed to send the message.");
        return false;
      }
      setError(null);
      setMessages((prev) => appendDm(prev, data as DirectMessage));
      return true;
    },
    [sb, userId, peerId],
  );

  return { messages, error, loaded, send };
}
