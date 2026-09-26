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

/** Character look slugs (see supabase/migrations/0031_character_selection.sql, 0033_girl_character.sql). */
export type CharacterSlug = "classic" | "pixel" | "girl";
const DEFAULT_CHARACTER: CharacterSlug = "classic";

/** STU-41: 5 ball ("kula") skins (see supabase/migrations/0038_ball_skin.sql). Free — unlike
 * cosmetic/character there's no coin cost, so switching is a plain column update, not an RPC. */
export const BALL_SKINS = ["classic", "ring", "spiky", "striped", "halo"] as const;
export type BallSkin = (typeof BALL_SKINS)[number];
const DEFAULT_BALL_SKIN: BallSkin = "classic";
/** Ball skin from the database, or the default when missing/unrecognized. */
export function safeBallSkin(skin: string | null | undefined): BallSkin {
  return (BALL_SKINS as readonly string[]).includes(skin ?? "") ? (skin as BallSkin) : DEFAULT_BALL_SKIN;
}

/** Character slug from the database, or the default when missing/unrecognized. */
export function safeCharacter(character: string | null | undefined): CharacterSlug {
  return character === "pixel" || character === "girl" ? character : DEFAULT_CHARACTER;
}

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
  mobKills: number;
};

/** Mapa `user_id → profil`. */
export type Profiles = Record<string, Profile>;

/** Raw cosmetic columns as stored — `null`/expired means no active item, see `activeCosmetic`. */
type CosmeticFields = { cosmetic: string | null; cosmeticExpiresAt: string | null };
/** Raw character column as stored. */
type CharacterFields = { character: string | null };
/** STU-35: raw flash-grenade stock, see supabase/migrations/0037_flash_grenade_item.sql. */
type FlashGrenadeFields = { flashGrenades: number };
/** STU-41: raw ball-skin column as stored. */
type BallSkinFields = { ballSkin: string | null };
/** Third weapon (shuriken, weapon slot 3) ammo stock — see supabase/migrations/0040_shuriken_ammo.sql. */
type ShurikenAmmoFields = { shurikenAmmo: number };
/** STU-77: equipped gear slugs (see EQUIPMENT_ITEMS in realtime-server/shared/constants.ts and
 * supabase/migrations/0043_equipment.sql) — null means that slot is empty. Unlike cosmetic these
 * carry a real gameplay stat bonus, so besides riding along in the profile (this file) they're
 * also re-read server-side by src/app/api/realtime/token/route.ts and signed into the entry token
 * realtime-server trusts (see mintEntryToken in realtime-server/shared/entryToken.ts) — the client
 * never tells realtime-server its own stats directly. */
type EquipmentFields = { equippedHelm: string | null; equippedArmor: string | null; equippedBoots: string | null };

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
  /** Total Arena enemy kills, ever (see ARENA_ROOM_SLUG in realtime-server/shared/constants.ts) —
   * separate from `kills` (PvP only) — 0 until loaded or signed out. */
  mobKills: number;
  /** Copper coin balance (see src/lib/coins.ts) — 0 until loaded or signed out. Private: not shown for other players. */
  coins: number;
  /** Active cosmetic slug (e.g. "flower"), or null if none owned or the timer ran out — see
   * supabase/migrations/0027_cosmetic_items.sql. Shown to other players via Presence, same as
   * color (see Meta in RoomStage.tsx), not through realtime-server: it has no gameplay effect. */
  cosmetic: string | null;
  /** Character look (see supabase/migrations/0031_character_selection.sql) — same Presence-only
   * path as cosmetic/color, no gameplay effect. */
  character: CharacterSlug;
  /** STU-35: how many flash grenades this player can still use — see
   * supabase/migrations/0037_flash_grenade_item.sql. Unlike cosmetic/character, this has a real
   * gameplay effect, so *using* one (not just owning one) is validated by realtime-server, not
   * just Postgres — see the "useItem" handler in realtime-server/src/server.ts. Private, like
   * coins: not shown for other players. */
  flashGrenades: number;
  /** STU-41: equipped ball skin (see supabase/migrations/0038_ball_skin.sql) — same Presence-only,
   * no-gameplay-effect path as cosmetic/character. */
  ballSkin: BallSkin;
  /** Shuriken ammo (weapon slot 3, see WEAPON_SLOTS in RoomStage.tsx) — see
   * supabase/migrations/0040_shuriken_ammo.sql. Same "ownership/quantity is Postgres, *use* is
   * realtime-server" split as flashGrenades above. Private, like coins/flashGrenades. */
  shurikenAmmo: number;
  /** STU-77: equipped helm/armor/boots slugs, or null for an empty slot — see EquipmentFields'
   * doc comment above. Private, like coins/flashGrenades: only this player's own client needs to
   * know its slugs, since the resulting stat bonus already travels via the signed entry token. */
  equippedHelm: string | null;
  equippedArmor: string | null;
  equippedBoots: string | null;
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
  /**
   * Switches character look (see supabase/migrations/0031_character_selection.sql) — same
   * atomic-RPC pattern as purchaseColor/purchaseCosmetic: balance check, coin deduction and the
   * write happen in one transaction. Free (no coin check) when re-picking the character already
   * equipped, enforced server-side by the same RPC.
   */
  purchaseCharacter: (character: CharacterSlug) => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * STU-35: consumes one flash grenade (atomic check-and-decrement RPC, see
   * supabase/migrations/0037_flash_grenade_item.sql — same shape as purchaseCosmetic but no coin
   * cost). Only decrements the Postgres stock; the caller still has to tell realtime-server to
   * actually trigger the room-wide flash (see the "useItem" ClientMessage in RoomStage.tsx) —
   * this function alone has no visible effect.
   */
  useFlashGrenade: () => Promise<{ ok: true; remaining: number } | { ok: false; error: string }>;
  /** STU-41: switches ball skin — free, direct column update (see saveBallSkin's grant in
   * supabase/migrations/0038_ball_skin.sql), same shape as `save` (color) above, not an RPC. */
  saveBallSkin: (skin: BallSkin) => Promise<boolean>;
  /**
   * Consumes one shuriken (atomic check-and-decrement RPC, see
   * supabase/migrations/0040_shuriken_ammo.sql — same shape as useFlashGrenade). Only decrements
   * the Postgres stock; the caller still has to tell realtime-server to actually spawn/fly the
   * projectile (see the "shuriken" ClientMessage in RoomStage.tsx) — this function alone has no
   * visible effect.
   */
  useShuriken: () => Promise<{ ok: true; remaining: number } | { ok: false; error: string }>;
  /**
   * Buys a pack of 10 shurikens for 10 copper coins from the gunman (see
   * supabase/migrations/0040_shuriken_ammo.sql) — same atomic-RPC pattern as purchaseCosmetic:
   * balance check, coin deduction and the ammo grant happen in one transaction.
   */
  purchaseShurikenAmmo: () => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Buys and equips an equipment item (see EQUIPMENT_ITEMS in
   * realtime-server/shared/constants.ts and supabase/migrations/0043_equipment.sql) — same atomic
   * balance-check-deduct-and-equip RPC pattern as purchaseCosmetic. Free (no coin check) when
   * re-equipping an item already owned, enforced server-side by the same RPC — same shape as
   * purchaseCharacter's free re-pick.
   */
  purchaseEquipment: (slug: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Clears one equipment slot back to empty — free, direct column update (see
   * unequip_equipment's grant in supabase/migrations/0043_equipment.sql). */
  unequipEquipment: (slot: "helm" | "armor" | "boots") => Promise<{ ok: true } | { ok: false; error: string }>;
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
    | ({ userId: string } & Profile & { coins: number } & CosmeticFields &
        CharacterFields &
        FlashGrenadeFields &
        BallSkinFields &
        ShurikenAmmoFields &
        EquipmentFields)
    | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sb || !userId) return;
    let cancelled = false;
    sb.from("profiles")
      .select(
        "nickname, color, xp, balls_shot, fist_swings, kills, deaths, mob_kills, coins, cosmetic, cosmetic_expires_at, character_slug, flash_grenades, ball_skin, shuriken_ammo, equipped_helm, equipped_armor, equipped_boots",
      )
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
          mobKills: data?.mob_kills ?? 0,
          coins: Number(data?.coins ?? 0),
          cosmetic: data?.cosmetic ?? null,
          cosmeticExpiresAt: data?.cosmetic_expires_at ?? null,
          character: data?.character_slug ?? null,
          flashGrenades: data?.flash_grenades ?? 0,
          ballSkin: data?.ball_skin ?? null,
          shurikenAmmo: data?.shuriken_ammo ?? 0,
          equippedHelm: data?.equipped_helm ?? null,
          equippedArmor: data?.equipped_armor ?? null,
          equippedBoots: data?.equipped_boots ?? null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [sb, userId, fallback]);

  useEffect(() => {
    const onSaved = (e: Event) => {
      const next = (
        e as CustomEvent<
          { userId: string } & Profile & { coins: number } & CosmeticFields &
            CharacterFields &
            FlashGrenadeFields &
            BallSkinFields &
            ShurikenAmmoFields &
            EquipmentFields
        >
      ).detail;
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
            mob_kills?: number;
            coins?: number | string;
            cosmetic?: string | null;
            cosmetic_expires_at?: string | null;
            character_slug?: string | null;
            flash_grenades?: number;
            ball_skin?: string | null;
            shuriken_ammo?: number;
            equipped_helm?: string | null;
            equipped_armor?: string | null;
            equipped_boots?: string | null;
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
            mobKills: p.mob_kills ?? 0,
            coins: Number(p.coins ?? 0),
            cosmetic: p.cosmetic ?? null,
            cosmeticExpiresAt: p.cosmetic_expires_at ?? null,
            character: p.character_slug ?? null,
            flashGrenades: p.flash_grenades ?? 0,
            ballSkin: p.ball_skin ?? null,
            shurikenAmmo: p.shuriken_ammo ?? 0,
            equippedHelm: p.equipped_helm ?? null,
            equippedArmor: p.equipped_armor ?? null,
            equippedBoots: p.equipped_boots ?? null,
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
  const currentMobKills = loaded?.userId === userId ? loaded.mobKills : 0;
  const currentCoins = loaded?.userId === userId ? loaded.coins : 0;
  const currentCosmetic = loaded?.userId === userId ? loaded.cosmetic : null;
  const currentCosmeticExpiresAt = loaded?.userId === userId ? loaded.cosmeticExpiresAt : null;
  const currentCharacter = loaded?.userId === userId ? safeCharacter(loaded.character) : DEFAULT_CHARACTER;
  const currentFlashGrenades = loaded?.userId === userId ? loaded.flashGrenades : 0;
  const currentBallSkin = loaded?.userId === userId ? safeBallSkin(loaded.ballSkin) : DEFAULT_BALL_SKIN;
  const currentShurikenAmmo = loaded?.userId === userId ? loaded.shurikenAmmo : 0;
  const currentEquippedHelm = loaded?.userId === userId ? loaded.equippedHelm : null;
  const currentEquippedArmor = loaded?.userId === userId ? loaded.equippedArmor : null;
  const currentEquippedBoots = loaded?.userId === userId ? loaded.equippedBoots : null;

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
            mobKills: currentMobKills,
            coins: currentCoins,
            cosmetic: currentCosmetic,
            cosmeticExpiresAt: currentCosmeticExpiresAt,
            character: currentCharacter,
            flashGrenades: currentFlashGrenades,
            ballSkin: currentBallSkin,
            shurikenAmmo: currentShurikenAmmo,
            equippedHelm: currentEquippedHelm,
            equippedArmor: currentEquippedArmor,
            equippedBoots: currentEquippedBoots,
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
      currentMobKills,
      currentCoins,
      currentCosmetic,
      currentCosmeticExpiresAt,
      currentCharacter,
      currentFlashGrenades,
      currentBallSkin,
      currentShurikenAmmo,
      currentEquippedHelm,
      currentEquippedArmor,
      currentEquippedBoots,
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
            mobKills: currentMobKills,
            coins: newCoins,
            cosmetic: currentCosmetic,
            cosmeticExpiresAt: currentCosmeticExpiresAt,
            character: currentCharacter,
            flashGrenades: currentFlashGrenades,
            ballSkin: currentBallSkin,
            shurikenAmmo: currentShurikenAmmo,
            equippedHelm: currentEquippedHelm,
            equippedArmor: currentEquippedArmor,
            equippedBoots: currentEquippedBoots,
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
      currentMobKills,
      currentCoins,
      currentCosmetic,
      currentCosmeticExpiresAt,
      currentCharacter,
      currentFlashGrenades,
      currentBallSkin,
      currentShurikenAmmo,
      currentEquippedHelm,
      currentEquippedArmor,
      currentEquippedBoots,
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
            mobKills: currentMobKills,
            coins: newCoins,
            cosmetic: newCosmetic,
            cosmeticExpiresAt: newExpiresAt,
            character: currentCharacter,
            flashGrenades: currentFlashGrenades,
            ballSkin: currentBallSkin,
            shurikenAmmo: currentShurikenAmmo,
            equippedHelm: currentEquippedHelm,
            equippedArmor: currentEquippedArmor,
            equippedBoots: currentEquippedBoots,
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
      currentMobKills,
      currentCoins,
      currentCharacter,
      currentFlashGrenades,
      currentBallSkin,
      currentShurikenAmmo,
      currentEquippedHelm,
      currentEquippedArmor,
      currentEquippedBoots,
    ],
  );

  const purchaseCharacter = useCallback(
    async (character: CharacterSlug) => {
      if (!sb) return { ok: false as const, error: "Buying requires Supabase to be configured." };
      if (!userId) return { ok: false as const, error: "Session expired — please sign in again." };
      // Jedno RPC: sprawdza saldo, odejmuje coiny i zapisuje wybór postaci w jednej transakcji po
      // stronie bazy (patrz supabase/migrations/0031_character_selection.sql) — darmowe, gdy to
      // już aktywna postać.
      const { data, error } = await sb.rpc("purchase_character", { p_character: character });
      if (error) {
        console.error("purchase_character", error);
        const message =
          error.message === "insufficient_coins"
            ? "Not enough copper coins."
            : error.message === "unknown_character"
              ? "Unknown character."
              : `Purchase failed: ${saveHint(error)}`;
        return { ok: false as const, error: message };
      }
      const row = (Array.isArray(data) ? data[0] : data) as
        | { character_slug?: string | null; coins?: number | string }
        | null;
      const newCharacter = safeCharacter(row?.character_slug ?? character);
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
            mobKills: currentMobKills,
            coins: newCoins,
            cosmetic: currentCosmetic,
            cosmeticExpiresAt: currentCosmeticExpiresAt,
            character: newCharacter,
            flashGrenades: currentFlashGrenades,
            ballSkin: currentBallSkin,
            shurikenAmmo: currentShurikenAmmo,
            equippedHelm: currentEquippedHelm,
            equippedArmor: currentEquippedArmor,
            equippedBoots: currentEquippedBoots,
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
      currentMobKills,
      currentCoins,
      currentCosmetic,
      currentCosmeticExpiresAt,
      currentFlashGrenades,
      currentBallSkin,
      currentShurikenAmmo,
      currentEquippedHelm,
      currentEquippedArmor,
      currentEquippedBoots,
    ],
  );

  const useFlashGrenade = useCallback(async () => {
    if (!sb) return { ok: false as const, error: "Requires Supabase to be configured." };
    if (!userId) return { ok: false as const, error: "Session expired — please sign in again." };
    // Same atomic check-and-decrement pattern as purchaseCosmetic (0027/0035), see
    // supabase/migrations/0037_flash_grenade_item.sql — no coins involved, just stock.
    const { data, error } = await sb.rpc("consume_flash_grenade");
    if (error) {
      console.error("consume_flash_grenade", error);
      const message = error.message === "no_flash_grenades" ? "No flash grenades left." : `Failed: ${saveHint(error)}`;
      return { ok: false as const, error: message };
    }
    const row = (Array.isArray(data) ? data[0] : data) as { flash_grenades?: number } | null;
    const remaining = Number(row?.flash_grenades ?? Math.max(0, currentFlashGrenades - 1));
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
          mobKills: currentMobKills,
          coins: currentCoins,
          cosmetic: currentCosmetic,
          cosmeticExpiresAt: currentCosmeticExpiresAt,
          character: currentCharacter,
          flashGrenades: remaining,
          ballSkin: currentBallSkin,
          shurikenAmmo: currentShurikenAmmo,
          equippedHelm: currentEquippedHelm,
          equippedArmor: currentEquippedArmor,
          equippedBoots: currentEquippedBoots,
        },
      }),
    );
    return { ok: true as const, remaining };
  }, [
    sb,
    userId,
    currentNickname,
    currentColor,
    currentXp,
    currentBallsShot,
    currentFistSwings,
    currentKills,
    currentDeaths,
    currentMobKills,
    currentCoins,
    currentCosmetic,
    currentCosmeticExpiresAt,
    currentCharacter,
    currentFlashGrenades,
    currentBallSkin,
    currentShurikenAmmo,
    currentEquippedHelm,
    currentEquippedArmor,
    currentEquippedBoots,
  ]);

  const saveBallSkin = useCallback(
    async (skin: BallSkin) => {
      if (!sb || !userId) return false;
      // Free, direct column update — no RPC, see the grant in
      // supabase/migrations/0038_ball_skin.sql. Unlike color this never fails on a bad value from
      // this function's own caller (BallSkin is a closed union), only on RLS/network errors.
      const { error } = await sb.from("profiles").update({ ball_skin: skin, updated_at: new Date().toISOString() }).eq("id", userId);
      if (error) {
        console.error("profiles update (ball_skin)", error);
        return false;
      }
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
            mobKills: currentMobKills,
            coins: currentCoins,
            cosmetic: currentCosmetic,
            cosmeticExpiresAt: currentCosmeticExpiresAt,
            character: currentCharacter,
            flashGrenades: currentFlashGrenades,
            ballSkin: skin,
            shurikenAmmo: currentShurikenAmmo,
            equippedHelm: currentEquippedHelm,
            equippedArmor: currentEquippedArmor,
            equippedBoots: currentEquippedBoots,
          },
        }),
      );
      return true;
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
      currentMobKills,
      currentCoins,
      currentCosmetic,
      currentCosmeticExpiresAt,
      currentCharacter,
      currentFlashGrenades,
      currentShurikenAmmo,
      currentEquippedHelm,
      currentEquippedArmor,
      currentEquippedBoots,
    ],
  );

  const useShuriken = useCallback(async () => {
    if (!sb) return { ok: false as const, error: "Requires Supabase to be configured." };
    if (!userId) return { ok: false as const, error: "Session expired — please sign in again." };
    // Same atomic check-and-decrement pattern as useFlashGrenade above, see
    // supabase/migrations/0040_shuriken_ammo.sql — no coins involved, just stock.
    const { data, error } = await sb.rpc("consume_shuriken_ammo");
    if (error) {
      console.error("consume_shuriken_ammo", error);
      const message = error.message === "no_shuriken_ammo" ? "No shurikens left." : `Failed: ${saveHint(error)}`;
      return { ok: false as const, error: message };
    }
    const row = (Array.isArray(data) ? data[0] : data) as { shuriken_ammo?: number } | null;
    const remaining = Number(row?.shuriken_ammo ?? Math.max(0, currentShurikenAmmo - 1));
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
          mobKills: currentMobKills,
          coins: currentCoins,
          cosmetic: currentCosmetic,
          cosmeticExpiresAt: currentCosmeticExpiresAt,
          character: currentCharacter,
          flashGrenades: currentFlashGrenades,
          ballSkin: currentBallSkin,
          shurikenAmmo: remaining,
          equippedHelm: currentEquippedHelm,
          equippedArmor: currentEquippedArmor,
          equippedBoots: currentEquippedBoots,
        },
      }),
    );
    return { ok: true as const, remaining };
  }, [
    sb,
    userId,
    currentNickname,
    currentColor,
    currentXp,
    currentBallsShot,
    currentFistSwings,
    currentKills,
    currentDeaths,
    currentMobKills,
    currentCoins,
    currentCosmetic,
    currentCosmeticExpiresAt,
    currentCharacter,
    currentFlashGrenades,
    currentBallSkin,
    currentShurikenAmmo,
    currentEquippedHelm,
    currentEquippedArmor,
    currentEquippedBoots,
  ]);

  const purchaseShurikenAmmo = useCallback(async () => {
    if (!sb) return { ok: false as const, error: "Buying requires Supabase to be configured." };
    if (!userId) return { ok: false as const, error: "Session expired — please sign in again." };
    // One RPC: balance check, coin deduction and the ammo grant in one transaction (see
    // supabase/migrations/0040_shuriken_ammo.sql), same atomic pattern as purchaseCosmetic.
    const { data, error } = await sb.rpc("buy_shuriken_ammo");
    if (error) {
      console.error("buy_shuriken_ammo", error);
      const message = error.message === "insufficient_coins" ? "Not enough copper coins." : `Purchase failed: ${saveHint(error)}`;
      return { ok: false as const, error: message };
    }
    const row = (Array.isArray(data) ? data[0] : data) as { shuriken_ammo?: number; coins?: number | string } | null;
    const newAmmo = Number(row?.shuriken_ammo ?? currentShurikenAmmo + 10);
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
          mobKills: currentMobKills,
          coins: newCoins,
          cosmetic: currentCosmetic,
          cosmeticExpiresAt: currentCosmeticExpiresAt,
          character: currentCharacter,
          flashGrenades: currentFlashGrenades,
          ballSkin: currentBallSkin,
          shurikenAmmo: newAmmo,
          equippedHelm: currentEquippedHelm,
          equippedArmor: currentEquippedArmor,
          equippedBoots: currentEquippedBoots,
        },
      }),
    );
    return { ok: true as const };
  }, [
    sb,
    userId,
    currentNickname,
    currentColor,
    currentXp,
    currentBallsShot,
    currentFistSwings,
    currentKills,
    currentDeaths,
    currentMobKills,
    currentCoins,
    currentCosmetic,
    currentCosmeticExpiresAt,
    currentCharacter,
    currentFlashGrenades,
    currentBallSkin,
    currentShurikenAmmo,
    currentEquippedHelm,
    currentEquippedArmor,
    currentEquippedBoots,
  ]);

  const purchaseEquipment = useCallback(
    async (slug: string) => {
      if (!sb) return { ok: false as const, error: "Buying requires Supabase to be configured." };
      if (!userId) return { ok: false as const, error: "Session expired — please sign in again." };
      // Jedno RPC: sprawdza saldo, odejmuje coiny i zapisuje wyekwipowany przedmiot w jednej
      // transakcji po stronie bazy (patrz supabase/migrations/0043_equipment.sql) — darmowe, gdy
      // to już aktywny przedmiot w danym slocie, tak jak purchaseCharacter.
      const { data, error } = await sb.rpc("purchase_equipment", { p_slug: slug });
      if (error) {
        console.error("purchase_equipment", error);
        const message =
          error.message === "insufficient_coins"
            ? "Not enough copper coins."
            : error.message === "unknown_item"
              ? "Unknown item."
              : `Purchase failed: ${saveHint(error)}`;
        return { ok: false as const, error: message };
      }
      const row = (Array.isArray(data) ? data[0] : data) as
        | { equipped_helm?: string | null; equipped_armor?: string | null; equipped_boots?: string | null; coins?: number | string }
        | null;
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
            mobKills: currentMobKills,
            coins: newCoins,
            cosmetic: currentCosmetic,
            cosmeticExpiresAt: currentCosmeticExpiresAt,
            character: currentCharacter,
            flashGrenades: currentFlashGrenades,
            ballSkin: currentBallSkin,
            shurikenAmmo: currentShurikenAmmo,
            equippedHelm: row?.equipped_helm ?? currentEquippedHelm,
            equippedArmor: row?.equipped_armor ?? currentEquippedArmor,
            equippedBoots: row?.equipped_boots ?? currentEquippedBoots,
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
      currentMobKills,
      currentCoins,
      currentCosmetic,
      currentCosmeticExpiresAt,
      currentCharacter,
      currentFlashGrenades,
      currentBallSkin,
      currentShurikenAmmo,
      currentEquippedHelm,
      currentEquippedArmor,
      currentEquippedBoots,
    ],
  );

  const unequipEquipment = useCallback(
    async (slot: "helm" | "armor" | "boots") => {
      if (!sb) return { ok: false as const, error: "Requires Supabase to be configured." };
      if (!userId) return { ok: false as const, error: "Session expired — please sign in again." };
      const { error } = await sb.rpc("unequip_equipment", { p_slot: slot });
      if (error) {
        console.error("unequip_equipment", error);
        return { ok: false as const, error: `Failed: ${saveHint(error)}` };
      }
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
            mobKills: currentMobKills,
            coins: currentCoins,
            cosmetic: currentCosmetic,
            cosmeticExpiresAt: currentCosmeticExpiresAt,
            character: currentCharacter,
            flashGrenades: currentFlashGrenades,
            ballSkin: currentBallSkin,
            shurikenAmmo: currentShurikenAmmo,
            equippedHelm: slot === "helm" ? null : currentEquippedHelm,
            equippedArmor: slot === "armor" ? null : currentEquippedArmor,
            equippedBoots: slot === "boots" ? null : currentEquippedBoots,
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
      currentMobKills,
      currentCoins,
      currentCosmetic,
      currentCosmeticExpiresAt,
      currentCharacter,
      currentFlashGrenades,
      currentBallSkin,
      currentShurikenAmmo,
      currentEquippedHelm,
      currentEquippedArmor,
      currentEquippedBoots,
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
    mobKills: mine?.mobKills ?? 0,
    coins: mine?.coins ?? 0,
    cosmetic: mine ? activeCosmetic(mine) : null,
    character: mine ? safeCharacter(mine.character) : DEFAULT_CHARACTER,
    flashGrenades: mine?.flashGrenades ?? 0,
    ballSkin: mine ? safeBallSkin(mine.ballSkin) : DEFAULT_BALL_SKIN,
    // Sygnalizowani goście dostają taki sam startowy zapas jak nowe konto z Postgresa (default 10
    // w supabase/migrations/0040_shuriken_ammo.sql) — bez tego niezalogowany gracz startuje z 0.
    shurikenAmmo: mine?.shurikenAmmo ?? 10,
    equippedHelm: mine?.equippedHelm ?? null,
    equippedArmor: mine?.equippedArmor ?? null,
    equippedBoots: mine?.equippedBoots ?? null,
    error,
    save,
    purchaseColor,
    purchaseCosmetic,
    purchaseCharacter,
    useFlashGrenade,
    saveBallSkin,
    useShuriken,
    purchaseShurikenAmmo,
    purchaseEquipment,
    unequipEquipment,
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
      .select("id, nickname, color, xp, balls_shot, fist_swings, kills, deaths, mob_kills")
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
            mob_kills?: number;
          };
          if (!profile?.id || !profile.nickname) return;
          const { id, nickname, color, xp, balls_shot, fist_swings, kills, deaths, mob_kills } = profile;
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
                    mobKills: mob_kills ?? 0,
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

/**
 * Szuka profili po fragmencie nicku (case-insensitive) — do startowania nowej rozmowy DM po
 * username. `profiles` jest publicznie czytelne (RLS `profiles_select_all`), więc to zwykłe
 * zapytanie klienckie, bez nowego route'a API ani supabaseAdmin.
 */
export async function searchProfilesByNickname(
  sb: ReturnType<typeof getSupabase>,
  query: string,
): Promise<{ id: string; nickname: string }[]> {
  const q = query.trim();
  if (!sb || q.length === 0) return [];
  const { data, error } = await sb.from("profiles").select("id, nickname").ilike("nickname", `%${q}%`).limit(8);
  if (error || !data) return [];
  return data as { id: string; nickname: string }[];
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
    mob_kills: number;
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
        mobKills: r.mob_kills ?? 0,
      },
    ]),
  );
}
