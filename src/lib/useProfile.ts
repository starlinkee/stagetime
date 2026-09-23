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
export type Profile = {
  nickname: string;
  color: string;
  xp: number;
  ballsShot: number;
  fistSwings: number;
  kills: number;
  deaths: number;
};

/** Mapa `user_id → profil`. */
export type Profiles = Record<string, Profile>;

/** Raw cosmetic columns as stored — `null`/expired means no active item, see `activeCosmetic`. */
type CosmeticFields = { cosmetic: string | null; cosmeticExpiresAt: string | null };

/** Cosmetic slug if its timer hasn't run out yet, otherwise null — one active slot (see 0027). */
function activeCosmetic(f: CosmeticFields): string | null {
  if (!f.cosmetic || !f.cosmeticExpiresAt) return null;
  return new Date(f.cosmeticExpiresAt).getTime() > Date.now() ? f.cosmetic : null;
}

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
  /** Total balls fired (Space release), ever — 0 until loaded or signed out. */
  ballsShot: number;
  /** Total fist swings thrown (Space with attack 1 selected), ever — 0 until loaded or signed out. */
  fistSwings: number;
  /** Total PvP kills, ever (damage only happens outside the lobby — see AGENTS.md) — 0 until loaded or signed out. */
  kills: number;
  /** Total PvP deaths, ever — 0 until loaded or signed out. */
  deaths: number;
  /** Copper coin balance (see src/lib/coins.ts) — 0 until loaded or signed out. Private: not shown for other players. */
  coins: number;
  /** Active cosmetic slug (e.g. "flower"), or null if none owned or the timer ran out — see
   * supabase/migrations/0027_cosmetic_items.sql. Shown to other players via Presence, same as
   * color (see Meta in RoomStage.tsx), not through realtime-server: it has no gameplay effect. */
  cosmetic: string | null;
  error: string | null;
  /** Zapisuje kolor (nick zawsze pochodzi z Discorda); zwraca true przy powodzeniu. */
  save: (color: string) => Promise<boolean>;
  /**
   * Kupuje zmianę koloru w Shopie (patrz src/components/ShopRoom.tsx i
   * supabase/migrations/0019_shop_color_purchase.sql) — jedno wywołanie RPC atomowo sprawdza
   * saldo, odejmuje coiny i zapisuje kolor w jednej transakcji, więc awaria przeglądarki w
   * dowolnym momencie przed odpowiedzią nigdy nie zdejmuje coinów bez zapisania koloru (i odwrotnie).
   */
  purchaseColor: (color: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Buys a cosmetic item (see supabase/migrations/0027_cosmetic_items.sql) — same atomic-RPC
   * pattern as purchaseColor: balance check, coin deduction and the item grant happen in one
   * transaction, so a crash mid-purchase never lands in a "coins gone, item not granted" state.
   */
  purchaseCosmetic: (slug: string) => Promise<{ ok: true } | { ok: false; error: string }>;
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
  const [loaded, setLoaded] = useState<
    ({ userId: string } & Profile & { coins: number } & CosmeticFields) | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sb || !userId) return;
    let cancelled = false;
    sb.from("profiles")
      .select("nickname, color, xp, balls_shot, fist_swings, kills, deaths, coins, cosmetic, cosmetic_expires_at")
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
          xp: Number(data?.xp ?? 0),
          ballsShot: data?.balls_shot ?? 0,
          fistSwings: data?.fist_swings ?? 0,
          kills: data?.kills ?? 0,
          deaths: data?.deaths ?? 0,
          coins: Number(data?.coins ?? 0),
          cosmetic: data?.cosmetic ?? null,
          cosmeticExpiresAt: data?.cosmetic_expires_at ?? null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [sb, userId, fallback]);

  useEffect(() => {
    const onSaved = (e: Event) => {
      const next = (e as CustomEvent<{ userId: string } & Profile & { coins: number } & CosmeticFields>).detail;
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
          const p = row as {
            nickname?: string;
            color?: string;
            xp?: number | string;
            balls_shot?: number;
            fist_swings?: number;
            kills?: number;
            deaths?: number;
            coins?: number | string;
            cosmetic?: string | null;
            cosmetic_expires_at?: string | null;
          };
          if (!p.nickname) return;
          setLoaded({
            userId,
            nickname: p.nickname,
            color: safeColor(p.color),
            xp: Number(p.xp ?? 0),
            ballsShot: p.balls_shot ?? 0,
            fistSwings: p.fist_swings ?? 0,
            kills: p.kills ?? 0,
            deaths: p.deaths ?? 0,
            coins: Number(p.coins ?? 0),
            cosmetic: p.cosmetic ?? null,
            cosmeticExpiresAt: p.cosmetic_expires_at ?? null,
          });
        },
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [sb, userId, channelId]);

  const currentNickname = (loaded?.userId === userId ? loaded.nickname : fallback) ?? "User";
  const currentColor = loaded?.userId === userId ? safeColor(loaded.color) : DEFAULT_COLOR;
  const currentXp = loaded?.userId === userId ? loaded.xp : 0;
  const currentBallsShot = loaded?.userId === userId ? loaded.ballsShot : 0;
  const currentFistSwings = loaded?.userId === userId ? loaded.fistSwings : 0;
  const currentKills = loaded?.userId === userId ? loaded.kills : 0;
  const currentDeaths = loaded?.userId === userId ? loaded.deaths : 0;
  const currentCoins = loaded?.userId === userId ? loaded.coins : 0;
  const currentCosmetic = loaded?.userId === userId ? loaded.cosmetic : null;
  const currentCosmeticExpiresAt = loaded?.userId === userId ? loaded.cosmeticExpiresAt : null;

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
        new CustomEvent("saved", {
          detail: {
            userId,
            nickname: currentNickname,
            color,
            xp: currentXp,
            ballsShot: currentBallsShot,
            fistSwings: currentFistSwings,
            kills: currentKills,
            deaths: currentDeaths,
            coins: currentCoins,
            cosmetic: currentCosmetic,
            cosmeticExpiresAt: currentCosmeticExpiresAt,
          },
        }),
      );
      return true;
    },
    [
      sb,
      userId,
      currentNickname,
      currentXp,
      currentBallsShot,
      currentFistSwings,
      currentKills,
      currentDeaths,
      currentCoins,
      currentCosmetic,
      currentCosmeticExpiresAt,
    ],
  );

  const purchaseColor = useCallback(
    async (color: string) => {
      if (!COLOR_RE.test(color)) return { ok: false as const, error: "Invalid color." };
      if (!sb) return { ok: false as const, error: "Buying requires Supabase to be configured." };
      if (!userId) return { ok: false as const, error: "Session expired — please sign in again." };
      // Jedno RPC: sprawdza saldo, odejmuje coiny i zapisuje kolor w jednej transakcji po stronie
      // bazy (patrz supabase/migrations/0019_shop_color_purchase.sql) — do chwili odpowiedzi nic
      // się nie dzieje, więc awaria karty w trakcie nigdy nie zdejmuje coinów bez zmiany koloru.
      const { data, error } = await sb.rpc("purchase_color_change", { p_color: color });
      if (error) {
        console.error("purchase_color_change", error);
        const message =
          error.message === "insufficient_coins"
            ? "Not enough copper coins."
            : `Purchase failed: ${saveHint(error)}`;
        return { ok: false as const, error: message };
      }
      const row = (Array.isArray(data) ? data[0] : data) as { color?: string; coins?: number | string } | null;
      const newColor = safeColor(row?.color ?? color);
      const newCoins = Number(row?.coins ?? currentCoins);
      saved.dispatchEvent(
        new CustomEvent("saved", {
          detail: {
            userId,
            nickname: currentNickname,
            color: newColor,
            xp: currentXp,
            ballsShot: currentBallsShot,
            fistSwings: currentFistSwings,
            kills: currentKills,
            deaths: currentDeaths,
            coins: newCoins,
            cosmetic: currentCosmetic,
            cosmeticExpiresAt: currentCosmeticExpiresAt,
          },
        }),
      );
      return { ok: true as const };
    },
    [
      sb,
      userId,
      currentNickname,
      currentXp,
      currentBallsShot,
      currentFistSwings,
      currentKills,
      currentDeaths,
      currentCoins,
      currentCosmetic,
      currentCosmeticExpiresAt,
    ],
  );

  const purchaseCosmetic = useCallback(
    async (slug: string) => {
      if (!sb) return { ok: false as const, error: "Buying requires Supabase to be configured." };
      if (!userId) return { ok: false as const, error: "Session expired — please sign in again." };
      // Jedno RPC: sprawdza saldo, odejmuje coiny i zapisuje przedmiot w jednej transakcji po
      // stronie bazy (patrz supabase/migrations/0027_cosmetic_items.sql).
      const { data, error } = await sb.rpc("purchase_cosmetic", { p_slug: slug });
      if (error) {
        console.error("purchase_cosmetic", error);
        const message =
          error.message === "insufficient_coins"
            ? "Not enough copper coins."
            : error.message === "unknown_item"
              ? "Unknown item."
              : `Purchase failed: ${saveHint(error)}`;
        return { ok: false as const, error: message };
      }
      const row = (Array.isArray(data) ? data[0] : data) as
        | { cosmetic?: string | null; cosmetic_expires_at?: string | null; coins?: number | string }
        | null;
      const newCosmetic = row?.cosmetic ?? slug;
      const newExpiresAt = row?.cosmetic_expires_at ?? null;
      const newCoins = Number(row?.coins ?? currentCoins);
      saved.dispatchEvent(
        new CustomEvent("saved", {
          detail: {
            userId,
            nickname: currentNickname,
            color: currentColor,
            xp: currentXp,
            ballsShot: currentBallsShot,
            fistSwings: currentFistSwings,
            kills: currentKills,
            deaths: currentDeaths,
            coins: newCoins,
            cosmetic: newCosmetic,
            cosmeticExpiresAt: newExpiresAt,
          },
        }),
      );
      return { ok: true as const };
    },
    [
      sb,
      userId,
      currentNickname,
      currentColor,
      currentXp,
      currentBallsShot,
      currentFistSwings,
      currentKills,
      currentDeaths,
      currentCoins,
    ],
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
    ballsShot: mine?.ballsShot ?? 0,
    fistSwings: mine?.fistSwings ?? 0,
    kills: mine?.kills ?? 0,
    deaths: mine?.deaths ?? 0,
    coins: mine?.coins ?? 0,
    cosmetic: mine ? activeCosmetic(mine) : null,
    error,
    save,
    purchaseColor,
    purchaseCosmetic,
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
      .select("id, nickname, color, xp, balls_shot, fist_swings, kills, deaths")
      .in("id", missing)
      // xp is numeric(12,1) — PostgREST may serialize it as a string, so toMap() below parses it.
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
          const profile = row as {
            id?: string;
            nickname?: string;
            color?: string;
            xp?: number | string;
            balls_shot?: number;
            fist_swings?: number;
            kills?: number;
            deaths?: number;
          };
          if (!profile?.id || !profile.nickname) return;
          const { id, nickname, color, xp, balls_shot, fist_swings, kills, deaths } = profile;
          setProfiles((prev) =>
            // Interesują nas tylko osoby widoczne na stronie (czat, obecni).
            fetched.current.has(id)
              ? {
                  ...prev,
                  [id]: {
                    nickname,
                    color: safeColor(color),
                    xp: Number(xp ?? 0),
                    ballsShot: balls_shot ?? 0,
                    fistSwings: fist_swings ?? 0,
                    kills: kills ?? 0,
                    deaths: deaths ?? 0,
                  },
                }
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

function toMap(
  rows: {
    id: string;
    nickname: string;
    color: string;
    xp: number | string;
    balls_shot: number;
    fist_swings: number;
    kills: number;
    deaths: number;
  }[],
): Profiles {
  return Object.fromEntries(
    rows.map((r) => [
      r.id,
      {
        nickname: r.nickname,
        color: safeColor(r.color),
        xp: Number(r.xp ?? 0),
        ballsShot: r.balls_shot ?? 0,
        fistSwings: r.fist_swings ?? 0,
        kills: r.kills ?? 0,
        deaths: r.deaths ?? 0,
      },
    ]),
  );
}
