"use client";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useProfiles } from "./useProfile";
import { getSupabase } from "./supabase";
import { useSession } from "./useSession";

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
  /** Author's current study XP — undefined until their profile has loaded. */
  authorXp?: number;
};

/** Ile ostatnich wiadomości wczytujemy przy wejściu do pokoju. */
const HISTORY_LIMIT = 50;
/** Limit długości wiadomości — taki sam jak CHECK w bazie. */
export const MAX_BODY = 500;

/** "room": tylko bieżący pokój. "all": wszystkie pokoje naraz (podgląd, do wysyłania nadal służy roomSlug). */
export type ChatScope = "room" | "all";

export type ChatState = {
  /** Historia z nazwami autorów podmienionymi na ich aktualne nicki. */
  messages: ChatMessage[];
  /** Komunikat o błędzie do pokazania użytkownikowi albo null. */
  error: string | null;
  /** false w trybie lokalnym (brak zmiennych Supabase). */
  available: boolean;
  /** Tylko zalogowani mogą pisać. */
  canSend: boolean;
  /** true, gdy wiadomość faktycznie poszła do bazy — false przy błędzie (patrz `error`). */
  send: (body: string) => Promise<boolean>;
  /** true po pierwszym zakończeniu (sukcesem lub błędem) wczytywania historii tego pokoju/scope. */
  loaded: boolean;
};

/**
 * Czat: historia z tabeli `messages` + nowe wiadomości przez Realtime.
 * scope "room" (domyślnie) filtruje po roomSlug, scope "all" pokazuje wszystkie pokoje.
 * Wysyłanie zawsze trafia do roomSlug — to fizyczny pokój, w którym stoi postać.
 * enabled: false wstrzymuje fetch/subskrypcję (np. podgląd "all" otwierany tylko na żądanie).
 */
export function useChat(
  roomSlug: string,
  opts: { scope?: ChatScope; enabled?: boolean } = {},
): ChatState {
  const { scope = "room", enabled = true } = opts;
  const sb = getSupabase();
  const { session } = useSession();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Unikalny sufiks per instancja hooka — RoomStage subskrybuje jednocześnie scope "room"
  // i "all"; bez tego dwie instancje o tym samym topicu dzieliłyby jeden kanał Realtime,
  // a drugi .on() po subscribe() rzucałby błąd.
  const instanceId = useId();

  useEffect(() => {
    setLoaded(false);
    if (!sb || !enabled) return;
    let cancelled = false;

    let query = sb.from("messages").select("*").order("created_at", { ascending: false }).limit(HISTORY_LIMIT);
    if (scope === "room") query = query.eq("room_slug", roomSlug);

    query.then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setError("Chat unavailable — the `messages` table is missing (see supabase/migrations).");
        setLoaded(true);
        return;
      }
      setError(null);
      setMessages((data as ChatMessage[]).reverse());
      setLoaded(true);
    });

    const channel = sb
      .channel(`chat:${scope === "room" ? roomSlug : "all"}:${instanceId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          ...(scope === "room" ? { filter: `room_slug=eq.${roomSlug}` } : {}),
        },
        ({ new: row }) => setMessages((prev) => append(prev, row as ChatMessage)),
      )
      .subscribe();

    return () => {
      cancelled = true;
      sb.removeChannel(channel);
    };
  }, [sb, roomSlug, scope, enabled, instanceId]);

  const send = useCallback(
    async (body: string) => {
      const text = body.trim().slice(0, MAX_BODY);
      if (!sb || !session || !text) return false;
      const { data, error } = await sb
        .from("messages")
        .insert({
          room_slug: roomSlug,
          user_id: session.user.id,
          body: text,
        })
        .select()
        .single();
      if (error) {
        console.warn("messages insert (see supabase/migrations)", error);
        setError(
          error.message === "rate_limit"
            ? "You're sending messages too fast — wait a moment."
            : "Failed to send the message.",
        );
        return false;
      }
      setError(null);
      // Własna wiadomość pojawia się od razu; echo z Realtime odfiltruje się po id.
      setMessages((prev) => append(prev, data as ChatMessage));
      return true;
    },
    [sb, session, roomSlug],
  );

  const authors = useMemo(() => messages.map((m) => m.user_id), [messages]);
  const profiles = useProfiles(authors);
  // Zmiana nicku działa wstecz: podmieniamy autora także w starych wiadomościach. XP jest zawsze
  // aktualne (Realtime, see useProfiles), więc doklejamy je za każdym razem, gdy profil jest znany.
  const named = useMemo(
    () =>
      messages.map((m) => {
        const p = profiles[m.user_id];
        if (!p) return m;
        return p.nickname === m.author && p.xp === m.authorXp
          ? m
          : { ...m, author: p.nickname, authorXp: p.xp };
      }),
    [messages, profiles],
  );

  return {
    messages: named,
    error,
    available: sb !== null,
    canSend: session !== null,
    send,
    loaded,
  };
}

/** Dokłada wiadomość na koniec, pomijając duplikat (wstawienie lokalne + echo z Realtime). */
function append(prev: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  return prev.some((m) => m.id === msg.id) ? prev : [...prev, msg];
}
