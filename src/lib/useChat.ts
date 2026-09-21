"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMyProfile, useProfiles } from "./useProfile";
import { getSupabase } from "./supabase";
import { displayName, useSession } from "./useSession";

export type ChatMessage = {
  id: string;
  room_slug: string;
  user_id: string;
  /**
   * Nazwa autora z chwili wysłania. Do wyświetlania służy aktualny nick z
   * `profiles` — `author` jest tylko zapasem dla kont bez profilu.
   */
  author: string;
  body: string;
  created_at: string;
};

/** Ile ostatnich wiadomości wczytujemy przy wejściu do pokoju. */
const HISTORY_LIMIT = 50;
/** Limit długości wiadomości — taki sam jak CHECK w bazie. */
export const MAX_BODY = 500;

export type ChatState = {
  /** Historia z nazwami autorów podmienionymi na ich aktualne nicki. */
  messages: ChatMessage[];
  /** Komunikat o błędzie do pokazania użytkownikowi albo null. */
  error: string | null;
  /** false w trybie lokalnym (brak zmiennych Supabase). */
  available: boolean;
  /** Tylko zalogowani mogą pisać. */
  canSend: boolean;
  send: (body: string) => Promise<void>;
};

/** Czat jednego pokoju: historia z tabeli `messages` + nowe wiadomości przez Realtime. */
export function useChat(roomSlug: string): ChatState {
  const sb = getSupabase();
  const { session } = useSession();
  const { nickname } = useMyProfile();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sb) return;
    let cancelled = false;

    sb.from("messages")
      .select("*")
      .eq("room_slug", roomSlug)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setError("Chat unavailable — the `messages` table is missing (see supabase/migrations).");
          return;
        }
        setError(null);
        setMessages((data as ChatMessage[]).reverse());
      });

    const channel = sb
      .channel(`chat:${roomSlug}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `room_slug=eq.${roomSlug}`,
        },
        ({ new: row }) => setMessages((prev) => append(prev, row as ChatMessage)),
      )
      .subscribe();

    return () => {
      cancelled = true;
      sb.removeChannel(channel);
    };
  }, [sb, roomSlug]);

  const send = useCallback(
    async (body: string) => {
      const text = body.trim().slice(0, MAX_BODY);
      if (!sb || !session || !text) return;
      const { data, error } = await sb
        .from("messages")
        .insert({
          room_slug: roomSlug,
          user_id: session.user.id,
          author: nickname ?? displayName(session),
          body: text,
        })
        .select()
        .single();
      if (error) {
        setError("Failed to send the message.");
        return;
      }
      setError(null);
      // Własna wiadomość pojawia się od razu; echo z Realtime odfiltruje się po id.
      setMessages((prev) => append(prev, data as ChatMessage));
    },
    [sb, session, nickname, roomSlug],
  );

  const authors = useMemo(() => messages.map((m) => m.user_id), [messages]);
  const profiles = useProfiles(authors);
  // Zmiana nicku działa wstecz: podmieniamy autora także w starych wiadomościach.
  const named = useMemo(
    () =>
      messages.map((m) =>
        profiles[m.user_id] && profiles[m.user_id].nickname !== m.author
          ? { ...m, author: profiles[m.user_id].nickname }
          : m,
      ),
    [messages, profiles],
  );

  return {
    messages: named,
    error,
    available: sb !== null,
    canSend: session !== null,
    send,
  };
}

/** Dokłada wiadomość na koniec, pomijając duplikat (wstawienie lokalne + echo z Realtime). */
function append(prev: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  return prev.some((m) => m.id === msg.id) ? prev : [...prev, msg];
}
