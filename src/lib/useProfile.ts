"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { getSupabase } from "./supabase";
import { displayName, useSession } from "./useSession";
import type { LevelInfo } from "./xp";
import { levelFromXp } from "./xp";

/** Limity nicku — takie same jak CHECK w bazie. */
export const MIN_NICKNAME = 2;
export const MAX_NICKNAME = 24;

/** Domyślny, biało-szary kolor postaci. */
export const DEFAULT_COLOR = "#d4d4d8";

/** Kolory do wyboru w ustawieniach (pierwszy to domyślny). */
export const COLOR_CHOICES = [
  DEFAULT_COLOR,
  "#f87171",
  "#fb923c",
  "#facc15",
  "#4ade80",
  "#2dd4bf",
  "#38bdf8",
  "#818cf8",
  "#c084fc",
  "#f472b6",
] as const;

const COLOR_RE = /^#[0-9a-f]{6}$/;

/** Kolor z bazy albo domyślny, gdy wartość jest niepoprawna. */
export function safeColor(color: string | null | undefined): string {
  return color && COLOR_RE.test(color) ? color : DEFAULT_COLOR;
}

/** Zapis profilu w jednym komponencie musi dotrzeć do pozostałych instancji `useMyProfile`. */
const saved = new EventTarget();

/** Publiczna część profilu. */
export type Profile = { nickname: string; color: string; xp: number };

/** Mapa `user_id → profil`. */
export type Profiles = Record<string, Profile>;

export type MyProfile = {
  /** false do czasu odczytu profilu (unikamy mignięcia starej nazwy). */
  ready: boolean;
  /** Aktualny nick albo null, gdy nikt nie jest zalogowany. */
  nickname: string | null;
  /** Kolor postaci (domyślny, gdy nie wybrano). */
  color: string;
  /** Total study XP (see src/lib/xp.ts) — 0 until loaded or signed out. */
  xp: number;
  /** Level derived from `xp`. */
  level: LevelInfo;
  error: string | null;
  /** Zapisuje kolor (nick zawsze pochodzi z Discorda); zwraca true przy powodzeniu. */
  save: (color: string) => Promise<boolean>;
};

/** Zwraca błąd walidacji nicku albo null, gdy jest poprawny. */
export function validateNickname(nickname: string): string | null {
  const value = nickname.trim();
  if (value.length < MIN_NICKNAME) return `Nickname must be at least ${MIN_NICKNAME} characters.`;
  if (value.length > MAX_NICKNAME) return `Nickname can be at most ${MAX_NICKNAME} characters.`;
  return null;
}

/** Profil zalogowanego użytkownika wraz z zapisem nicku. */
export function useMyProfile(): MyProfile {
  const sb = getSupabase();
  const { ready: sessionReady, session } = useSession();
  // Osobny kanał na instancję hooka — ProfileMenu i RoomStage wołają useMyProfile jednocześnie;
  // bez tego druga instancja dostałaby już zasubskrybowany kanał pierwszej i .on() by wywalił.
  const channelId = useId();
  const userId = session?.user.id ?? null;
  // Nazwa od dostawcy OAuth — zapasowa, dopóki (lub gdyby) w bazie nie było profilu.
  const fallback = session ? displayName(session).slice(0, MAX_NICKNAME) : null;
  // Trzymamy id razem z nickiem: po przelogowaniu nie pokazujemy cudzej nazwy.
  const [loaded, setLoaded] = useState<{ userId: string } & Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sb || !userId) return;
    let cancelled = false;
    sb.from("profiles")
      .select("nickname, color, xp")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError("Failed to load profile (see supabase/migrations 0002 and 0003).");
        // Brak wiersza (konto sprzed migracji 0002) → zostaje nazwa od dostawcy.
        setLoaded({
          userId,
          nickname: data?.nickname ?? fallback ?? "User",
          color: safeColor(data?.color),
          xp: data?.xp ?? 0,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [sb, userId, fallback]);

  useEffect(() => {
    const onSaved = (e: Event) => {
      const next = (e as CustomEvent<{ userId: string } & Profile>).detail;
      if (next.userId === userId) setLoaded(next);
    };
    saved.addEventListener("saved", onSaved);
    return () => saved.removeEventListener("saved", onSaved);
  }, [userId]);

  // XP ticks up server-side (room_study_heartbeat, see supabase/migrations/0010_xp.sql) without
  // this component doing anything — Realtime is what makes the level badge move on its own.
  useEffect(() => {
    if (!sb || !userId) return;
    const channel = sb
      .channel(`my-profile:${userId}:${channelId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` },
        ({ new: row }) => {
          const p = row as { nickname?: string; color?: string; xp?: number };
          if (!p.nickname) return;
          setLoaded({ userId, nickname: p.nickname, color: safeColor(p.color), xp: p.xp ?? 0 });
        },
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [sb, userId, channelId]);

  const currentNickname = (loaded?.userId === userId ? loaded.nickname : fallback) ?? "User";
  const currentXp = loaded?.userId === userId ? loaded.xp : 0;

  const save = useCallback(
    async (color: string) => {
      // Nowa próba zaczyna z czystym kontem — inaczej zostaje błąd z wczytywania.
      setError(null);
      if (!COLOR_RE.test(color)) {
        setError("Invalid color.");
        return false;
      }
      if (!sb) {
        setError("Saving a nickname requires Supabase to be configured.");
        return false;
      }
      if (!userId) {
        setError("Session expired — please sign in again.");
        return false;
      }
      // Klient zmienia tylko kolor — nick jest chroniony uprawnieniami kolumn (migracja 0004).
      const { error } = await sb
        .from("profiles")
        .update({ color, updated_at: new Date().toISOString() })
        .eq("id", userId);
      if (error) {
        // Bez treści od Postgresa nie da się odróżnić braku tabeli od braku polityki RLS.
        console.error("profiles update", error);
        setError(`Failed to save color: ${saveHint(error)}`);
        return false;
      }
      setError(null);
      // Dotyczy też tej instancji (listener powyżej), więc osobny setLoaded nie jest potrzebny.
      saved.dispatchEvent(
        new CustomEvent("saved", { detail: { userId, nickname: currentNickname, color, xp: currentXp } }),
      );
      return true;
    },
    [sb, userId, currentNickname, currentXp],
  );

  // Bez Supabase albo bez konta nie ma czego wczytywać — profil jest gotowy od razu.
  const offline = !sb || !userId;
  const mine = loaded?.userId === userId ? loaded : null;
  const xp = mine?.xp ?? 0;
  return {
    ready: sessionReady && (offline || mine !== null),
    nickname: mine?.nickname ?? fallback,
    color: mine?.color ?? DEFAULT_COLOR,
    xp,
    level: levelFromXp(xp),
    error,
    save,
  };
}

/**
 * Profile (nick i kolor) podanych użytkowników — z tabeli `profiles`, więc zmiana
 * nicku przepisuje też wszystkie historyczne wiadomości.
 * Nasłuch Realtime sprawia, że zmiana u innej osoby widać od razu.
 */
export function useProfiles(userIds: string[]): Profiles {
  const sb = getSupabase();
  const [profiles, setProfiles] = useState<Profiles>({});
  // Osobny kanał na instancję hooka — Supabase zwraca istniejący kanał o tej samej nazwie,
  // a po subscribe() nie da się już dodawać do niego callbacków.
  const channelId = useId();
  // Id już pobrane (także te bez profilu) — żeby nie odpytywać bazy w kółko.
  const fetched = useRef(new Set<string>());
  const wanted = useMemo(() => [...new Set(userIds)].sort().join(","), [userIds]);

  useEffect(() => {
    if (!sb || wanted === "") return;
    const missing = wanted.split(",").filter((id) => !fetched.current.has(id));
    if (missing.length === 0) return;
    for (const id of missing) fetched.current.add(id);
    let cancelled = false;
    sb.from("profiles")
      .select("id, nickname, color, xp")
      .in("id", missing)
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        setProfiles((prev) => ({ ...prev, ...toMap(data) }));
      });
    return () => {
      cancelled = true;
    };
  }, [sb, wanted]);

  useEffect(() => {
    if (!sb) return;
    const channel = sb
      .channel(`profiles:${channelId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        ({ new: row }) => {
          const profile = row as { id?: string; nickname?: string; color?: string; xp?: number };
          if (!profile?.id || !profile.nickname) return;
          const { id, nickname, color, xp } = profile;
          setProfiles((prev) =>
            // Interesują nas tylko osoby widoczne na stronie (czat, obecni).
            fetched.current.has(id)
              ? { ...prev, [id]: { nickname, color: safeColor(color), xp: xp ?? 0 } }
              : prev,
          );
        },
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [sb, channelId]);

  return profiles;
}

/** Zamienia błąd PostgREST na wskazówkę, co naprawić. */
function saveHint(error: { code?: string; message: string }): string {
  // 42P01 — brak tabeli, 42501/PGRST301 — RLS bez polityki UPDATE/INSERT dla właściciela.
  if (error.code === "42P01") return "the `profiles` table is missing (run supabase/migrations/0002).";
  if (error.code === "42501" || error.code === "PGRST301")
    return "no write permission (RLS policies in supabase/migrations/0002).";
  if (error.code === "23514") return "the nickname violates database constraints.";
  return error.message;
}

function toMap(rows: { id: string; nickname: string; color: string; xp: number }[]): Profiles {
  return Object.fromEntries(
    rows.map((r) => [r.id, { nickname: r.nickname, color: safeColor(r.color), xp: r.xp ?? 0 }]),
  );
}
