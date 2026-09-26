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
/** Third weapon (shuriken, weapon slot 3) ammo stock — derived, not stored directly. Since
 * supabase/migrations/0050_extra_attack_slot.sql, `shurikenAmmo` only counts the stack sitting in
 * the `equippedExtraAttack` slot (see EquipmentFields below) — owning "shuriken" stock elsewhere in
 * `equipmentBag` no longer counts until it's dragged onto that slot — see
 * `shurikenAmmoFromEquip`. */
type ShurikenAmmoFields = { shurikenAmmo: number };
/** STU-77: equipped gear slugs (see EQUIPMENT_ITEMS in realtime-server/shared/constants.ts and
 * supabase/migrations/0043_equipment.sql) — null means that slot is empty. Unlike cosmetic these
 * carry a real gameplay stat bonus, so besides riding along in the profile (this file) they're
 * also re-read server-side by src/app/api/realtime/token/route.ts and signed into the entry token
 * realtime-server trusts (see mintEntryToken in realtime-server/shared/entryToken.ts) — the client
 * never tells realtime-server its own stats directly.
 *
 * `equippedExtraAttack`/`equippedExtraAttackQty` (supabase/migrations/0050_extra_attack_slot.sql):
 * a fourth equip slot, alongside helm/armor/boots, but unlike those it never holds a gear slug
 * from EQUIPMENT_ITEMS — it only ever holds the stackable "shuriken" bag item (see
 * SHURIKEN_ITEM_SLUG below), with its own quantity since a shuriken stack depletes on use while
 * gear never does. A null slug means the slot is empty and weapon slot 3 (see WEAPON_SLOTS in
 * RoomStage.tsx) is unavailable, regardless of any "shuriken" stack still unequipped in the bag —
 * it has to be dragged onto this slot first, same drag-to-equip gesture as the gear slots.
 *
 * `equipmentBag` (supabase/migrations/0044_equipment_bag.sql, size reduced to 8 in
 * supabase/migrations/0049_bag_size_8.sql): 8 fixed slots (the 4x2 grid in the Tab inventory
 * panel, RoomStage.tsx) holding owned-but-not-equipped gear, `null` for an empty slot —
 * realtime-server never reads this, only the equipped_* columns carry a stat bonus.
 *
 * `equipmentBagQty` (supabase/migrations/0045_shuriken_bag_item.sql): one quantity per bag slot,
 * meaningless (always 1) for a unique gear slug like iron_helm — the only slug that ever stacks
 * past 1 is "shuriken" (see SHURIKEN_ITEM_SLUG below). */
type EquipmentFields = {
  equippedHelm: string | null;
  equippedArmor: string | null;
  equippedBoots: string | null;
  equippedExtraAttack: string | null;
  equippedExtraAttackQty: number;
  equipmentBag: (string | null)[];
  equipmentBagQty: number[];
};

/** Fixed bag size — for now, reduced from 20 to 8 (supabase/migrations/0049_bag_size_8.sql),
 * matching the 4x2 grid in RoomStage.tsx's inventory panel. */
export const EQUIPMENT_BAG_SIZE = 8;

/** Bag slug for the stackable shuriken item (see supabase/migrations/0045_shuriken_bag_item.sql) —
 * the only bag item whose `equipmentBagQty` entry can be greater than 1, and (since 0050) the only
 * slug the `extraAttack` equip slot ever holds. */
export const SHURIKEN_ITEM_SLUG = "shuriken";

/** Pads/truncates a raw `equipment_bag` value to the fixed EQUIPMENT_BAG_SIZE — defensive against
 * a missing column (pre-migration) or a row whose array length drifted. */
function normalizeBag(raw: (string | null)[] | null | undefined): (string | null)[] {
  const bag = raw ? raw.slice(0, EQUIPMENT_BAG_SIZE) : [];
  while (bag.length < EQUIPMENT_BAG_SIZE) bag.push(null);
  return bag;
}

/** Same padding/truncation as normalizeBag, for the parallel quantity array — missing/short
 * entries default to 1 (the non-stacking case), not 0, so a gear slug never reads as "qty 0". */
function normalizeQty(raw: (number | null)[] | null | undefined): number[] {
  const qty = raw ? raw.slice(0, EQUIPMENT_BAG_SIZE) : [];
  const out = qty.map((q) => Number(q ?? 1));
  while (out.length < EQUIPMENT_BAG_SIZE) out.push(1);
  return out;
}

/** Usable shuriken ammo (weapon slot 3) — only the stack sitting in the `extraAttack` equip slot
 * counts (see supabase/migrations/0050_extra_attack_slot.sql), not any additional "shuriken" stack
 * still unequipped in the bag. */
function shurikenAmmoFromEquip(equippedExtraAttack: string | null, equippedExtraAttackQty: number): number {
  return equippedExtraAttack === SHURIKEN_ITEM_SLUG ? Math.max(0, equippedExtraAttackQty) : 0;
}

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
  /** Shuriken ammo (weapon slot 3, see WEAPON_SLOTS in RoomStage.tsx) — only counts the stack
   * equipped into the `extraAttack` slot (see supabase/migrations/0050_extra_attack_slot.sql), not
   * any unequipped "shuriken" stack still sitting in the bag. Same "ownership/quantity is
   * Postgres, *use* is realtime-server" split as flashGrenades above. Private, like coins/flashGrenades. */
  shurikenAmmo: number;
  /** STU-77: equipped helm/armor/boots slugs, or null for an empty slot — see EquipmentFields'
   * doc comment above. Private, like coins/flashGrenades: only this player's own client needs to
   * know its slugs, since the resulting stat bonus already travels via the signed entry token. */
  equippedHelm: string | null;
  equippedArmor: string | null;
  equippedBoots: string | null;
  /** 0050: the extraAttack equip slot's slug (always "shuriken" or null) and stack size — see
   * EquipmentFields' doc comment above. Private, same as the other equipped_* fields. */
  equippedExtraAttack: string | null;
  equippedExtraAttackQty: number;
  /** STU-77/0044: 8-slot bag (0049) of owned-but-unequipped gear (plus the stackable "shuriken"
   * item, see 0045), `null` for an empty slot — see EquipmentFields' doc comment above. Private,
   * same as coins/flashGrenades. */
  equipmentBag: (string | null)[];
  /** Quantity per equipmentBag slot — see EquipmentFields' doc comment above. */
  equipmentBagQty: number[];
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
   * Donates coins into the Fountain of Wealth's room fund (see
   * supabase/migrations/0052_fountain_of_wealth.sql) — same atomic-RPC pattern as purchaseColor:
   * balance check, coin deduction and the fund credit happen in one transaction. `amount` must be
   * a positive number no larger than the caller's own balance (enforced server-side).
   */
  donateToFountain: (amount: number) => Promise<{ ok: true; fundTotal: number } | { ok: false; error: string }>;
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
   * Consumes one shuriken (atomic check-and-decrement RPC against the equipped extraAttack stack,
   * see supabase/migrations/0050_extra_attack_slot.sql — same shape as useFlashGrenade, and fails
   * with `no_shuriken_ammo` when nothing is equipped there, not just when the stack is at 0). Only
   * decrements the Postgres stock; the caller still has to tell realtime-server to actually
   * spawn/fly the projectile (see the "shuriken" ClientMessage in RoomStage.tsx) — this function
   * alone has no visible effect.
   */
  useShuriken: () => Promise<{ ok: true; remaining: number } | { ok: false; error: string }>;
  /**
   * Buys a pack of 10 shurikens for 10 copper coins from the gunman — tops up the equipped
   * extraAttack stack directly if one is already equipped, otherwise adds to (or starts) a
   * "shuriken" stack in the bag (see supabase/migrations/0050_extra_attack_slot.sql), same
   * atomic-RPC pattern as purchaseCosmetic: balance check, coin deduction and the ammo grant
   * happen in one transaction.
   */
  purchaseShurikenAmmo: () => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Buys an equipment item into the bag (see EQUIPMENT_ITEMS in realtime-server/shared/constants.ts
   * and supabase/migrations/0044_equipment_bag.sql) — same atomic balance-check-deduct RPC pattern
   * as purchaseCosmetic. Free (no coin check) when already owned — equipped, or already sitting in
   * the bag — enforced server-side by the same RPC. Does NOT equip it; use equipFromBag for that.
   */
  purchaseEquipment: (slug: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * STU-77/0044: equips the item sitting at `equipmentBag[bagIndex]` into its slot, swapping
   * whatever was equipped there (if anything) back into that bag slot — the "drag a bag item onto
   * a gear slot" gesture in RoomStage.tsx's inventory panel. Free. Since 0050, a "shuriken" bag
   * slug goes into the extraAttack slot (whole stack, not reset to qty 1 like a gear swap) instead
   * of raising `unknown_item`.
   */
  equipFromBag: (bagIndex: number) => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * STU-77/0044: clears one equipment slot and drops the item into a specific empty bag slot — the
   * "drag an equipped item back into the bag" gesture. Free. Fails if that bag slot isn't empty.
   * Since 0050, also accepts "extraAttack", moving the whole shuriken stack (not just qty 1) back.
   */
  unequipToBag: (
    slot: "helm" | "armor" | "boots" | "extraAttack",
    bagIndex: number,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** STU-77/0044: swaps two bag slots — the "drag within the bag" reorder gesture. Free. */
  moveBagItem: (fromIndex: number, toIndex: number) => Promise<{ ok: true } | { ok: false; error: string }>;
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
        "nickname, color, xp, balls_shot, fist_swings, kills, deaths, mob_kills, coins, cosmetic, cosmetic_expires_at, character_slug, flash_grenades, ball_skin, equipped_helm, equipped_armor, equipped_boots, equipped_extra_attack, equipped_extra_attack_qty, equipment_bag, equipment_bag_qty",
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
          shurikenAmmo: shurikenAmmoFromEquip(data?.equipped_extra_attack ?? null, Number(data?.equipped_extra_attack_qty ?? 0)),
          equippedHelm: data?.equipped_helm ?? null,
          equippedArmor: data?.equipped_armor ?? null,
          equippedBoots: data?.equipped_boots ?? null,
          equippedExtraAttack: data?.equipped_extra_attack ?? null,
          equippedExtraAttackQty: Number(data?.equipped_extra_attack_qty ?? 0),
          equipmentBag: normalizeBag(data?.equipment_bag),
          equipmentBagQty: normalizeQty(data?.equipment_bag_qty),
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
            equipped_helm?: string | null;
            equipped_armor?: string | null;
            equipped_boots?: string | null;
            equipped_extra_attack?: string | null;
            equipped_extra_attack_qty?: number | string;
            equipment_bag?: (string | null)[] | null;
            equipment_bag_qty?: (number | null)[] | null;
          };
          if (!p.nickname) return;
          const bag = normalizeBag(p.equipment_bag);
          const bagQty = normalizeQty(p.equipment_bag_qty);
          const equippedExtraAttack = p.equipped_extra_attack ?? null;
          const equippedExtraAttackQty = Number(p.equipped_extra_attack_qty ?? 0);
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
            shurikenAmmo: shurikenAmmoFromEquip(equippedExtraAttack, equippedExtraAttackQty),
            equippedHelm: p.equipped_helm ?? null,
            equippedArmor: p.equipped_armor ?? null,
            equippedBoots: p.equipped_boots ?? null,
            equippedExtraAttack,
            equippedExtraAttackQty,
            equipmentBag: bag,
            equipmentBagQty: bagQty,
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
  const currentEquippedExtraAttack = loaded?.userId === userId ? loaded.equippedExtraAttack : null;
  const currentEquippedExtraAttackQty = loaded?.userId === userId ? loaded.equippedExtraAttackQty : 0;
  const currentEquipmentBag = loaded?.userId === userId ? loaded.equipmentBag : normalizeBag(null);
  const currentEquipmentBagQty = loaded?.userId === userId ? loaded.equipmentBagQty : normalizeQty(null);

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
            equippedExtraAttack: currentEquippedExtraAttack,
            equippedExtraAttackQty: currentEquippedExtraAttackQty,
            equipmentBag: currentEquipmentBag,
            equipmentBagQty: currentEquipmentBagQty,
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
      currentEquippedExtraAttack,
      currentEquippedExtraAttackQty,
      currentEquipmentBag,
      currentEquipmentBagQty,
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
            equippedExtraAttack: currentEquippedExtraAttack,
            equippedExtraAttackQty: currentEquippedExtraAttackQty,
            equipmentBag: currentEquipmentBag,
            equipmentBagQty: currentEquipmentBagQty,
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
      currentEquippedExtraAttack,
      currentEquippedExtraAttackQty,
      currentEquipmentBag,
      currentEquipmentBagQty,
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
            equippedExtraAttack: currentEquippedExtraAttack,
            equippedExtraAttackQty: currentEquippedExtraAttackQty,
            equipmentBag: currentEquipmentBag,
            equipmentBagQty: currentEquipmentBagQty,
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
      currentEquippedExtraAttack,
      currentEquippedExtraAttackQty,
      currentEquipmentBag,
      currentEquipmentBagQty,
    ],
  );

  const donateToFountain = useCallback(
    async (amount: number) => {
      if (!sb) return { ok: false as const, error: "Donating requires Supabase to be configured." };
      if (!userId) return { ok: false as const, error: "Session expired — please sign in again." };
      // One RPC: balance check, coin deduction and the room fund credit in one transaction (see
      // supabase/migrations/0052_fountain_of_wealth.sql), same atomic pattern as purchase_cosmetic.
      const { data, error } = await sb.rpc("donate_to_fountain", { p_amount: amount });
      if (error) {
        console.error("donate_to_fountain", error);
        const message =
          error.message === "insufficient_coins"
            ? "Not enough copper coins."
            : error.message === "invalid_amount"
              ? "Enter an amount greater than zero."
              : `Donation failed: ${saveHint(error)}`;
        return { ok: false as const, error: message };
      }
      const row = (Array.isArray(data) ? data[0] : data) as
        | { coins?: number | string; fund_total?: number | string }
        | null;
      const newCoins = Number(row?.coins ?? currentCoins);
      const fundTotal = Number(row?.fund_total ?? 0);
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
            equippedHelm: currentEquippedHelm,
            equippedArmor: currentEquippedArmor,
            equippedBoots: currentEquippedBoots,
            equippedExtraAttack: currentEquippedExtraAttack,
            equippedExtraAttackQty: currentEquippedExtraAttackQty,
            equipmentBag: currentEquipmentBag,
            equipmentBagQty: currentEquipmentBagQty,
          },
        }),
      );
      return { ok: true as const, fundTotal };
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
      currentEquippedExtraAttack,
      currentEquippedExtraAttackQty,
      currentEquipmentBag,
      currentEquipmentBagQty,
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
            equippedExtraAttack: currentEquippedExtraAttack,
            equippedExtraAttackQty: currentEquippedExtraAttackQty,
            equipmentBag: currentEquipmentBag,
            equipmentBagQty: currentEquipmentBagQty,
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
      currentEquippedExtraAttack,
      currentEquippedExtraAttackQty,
      currentEquipmentBag,
      currentEquipmentBagQty,
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
          equippedExtraAttack: currentEquippedExtraAttack,
          equippedExtraAttackQty: currentEquippedExtraAttackQty,
          equipmentBag: currentEquipmentBag,
          equipmentBagQty: currentEquipmentBagQty,
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
    currentEquippedExtraAttack,
    currentEquippedExtraAttackQty,
    currentEquipmentBag,
    currentEquipmentBagQty,
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
            equippedExtraAttack: currentEquippedExtraAttack,
            equippedExtraAttackQty: currentEquippedExtraAttackQty,
            equipmentBag: currentEquipmentBag,
            equipmentBagQty: currentEquipmentBagQty,
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
      currentEquippedExtraAttack,
      currentEquippedExtraAttackQty,
      currentEquipmentBag,
      currentEquipmentBagQty,
    ],
  );

  const useShuriken = useCallback(async () => {
    if (!sb) return { ok: false as const, error: "Requires Supabase to be configured." };
    if (!userId) return { ok: false as const, error: "Session expired — please sign in again." };
    // Same atomic check-and-decrement pattern as useFlashGrenade above, see
    // supabase/migrations/0050_extra_attack_slot.sql — no coins involved, just stock, and now
    // decrements the equipped extraAttack stack directly instead of scanning the bag.
    const { data, error } = await sb.rpc("consume_shuriken_ammo");
    if (error) {
      console.error("consume_shuriken_ammo", error);
      const message = error.message === "no_shuriken_ammo" ? "No shurikens left." : `Failed: ${saveHint(error)}`;
      return { ok: false as const, error: message };
    }
    const row = (Array.isArray(data) ? data[0] : data) as
      | { equipped_extra_attack?: string | null; equipped_extra_attack_qty?: number | string }
      | null;
    const newEquippedExtraAttack = row?.equipped_extra_attack ?? currentEquippedExtraAttack;
    const newEquippedExtraAttackQty = Number(row?.equipped_extra_attack_qty ?? currentEquippedExtraAttackQty);
    const remaining = shurikenAmmoFromEquip(newEquippedExtraAttack, newEquippedExtraAttackQty);
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
          equippedExtraAttack: newEquippedExtraAttack,
          equippedExtraAttackQty: newEquippedExtraAttackQty,
          equipmentBag: currentEquipmentBag,
          equipmentBagQty: currentEquipmentBagQty,
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
    currentEquippedHelm,
    currentEquippedArmor,
    currentEquippedBoots,
    currentEquippedExtraAttack,
    currentEquippedExtraAttackQty,
    currentEquipmentBag,
    currentEquipmentBagQty,
  ]);

  const purchaseShurikenAmmo = useCallback(async () => {
    if (!sb) return { ok: false as const, error: "Buying requires Supabase to be configured." };
    if (!userId) return { ok: false as const, error: "Session expired — please sign in again." };
    // One RPC: balance check, coin deduction and the ammo grant (equipped stack if equipped,
    // otherwise the bag's "shuriken" stack) in one transaction (see
    // supabase/migrations/0050_extra_attack_slot.sql), same atomic pattern as purchaseCosmetic.
    const { data, error } = await sb.rpc("buy_shuriken_ammo");
    if (error) {
      console.error("buy_shuriken_ammo", error);
      const message =
        error.message === "insufficient_coins"
          ? "Not enough copper coins."
          : error.message === "bag_full"
            ? "Backpack is full."
            : `Purchase failed: ${saveHint(error)}`;
      return { ok: false as const, error: message };
    }
    const row = (Array.isArray(data) ? data[0] : data) as
      | {
          equipped_extra_attack?: string | null;
          equipped_extra_attack_qty?: number | string;
          equipment_bag?: (string | null)[] | null;
          equipment_bag_qty?: (number | null)[] | null;
          coins?: number | string;
        }
      | null;
    const newEquippedExtraAttack = row?.equipped_extra_attack ?? currentEquippedExtraAttack;
    const newEquippedExtraAttackQty = Number(row?.equipped_extra_attack_qty ?? currentEquippedExtraAttackQty);
    const newBag = normalizeBag(row?.equipment_bag ?? currentEquipmentBag);
    const newBagQty = normalizeQty(row?.equipment_bag_qty ?? currentEquipmentBagQty);
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
          shurikenAmmo: shurikenAmmoFromEquip(newEquippedExtraAttack, newEquippedExtraAttackQty),
          equippedHelm: currentEquippedHelm,
          equippedArmor: currentEquippedArmor,
          equippedBoots: currentEquippedBoots,
          equippedExtraAttack: newEquippedExtraAttack,
          equippedExtraAttackQty: newEquippedExtraAttackQty,
          equipmentBag: newBag,
          equipmentBagQty: newBagQty,
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
    currentEquippedHelm,
    currentEquippedArmor,
    currentEquippedBoots,
    currentEquippedExtraAttack,
    currentEquippedExtraAttackQty,
    currentEquipmentBag,
    currentEquipmentBagQty,
  ]);

  const purchaseEquipment = useCallback(
    async (slug: string) => {
      if (!sb) return { ok: false as const, error: "Buying requires Supabase to be configured." };
      if (!userId) return { ok: false as const, error: "Session expired — please sign in again." };
      // Jedno RPC: sprawdza saldo, odejmuje coiny i wkłada przedmiot do pierwszego wolnego slota
      // bagażu w jednej transakcji po stronie bazy (patrz supabase/migrations/0044_equipment_bag.sql)
      // — darmowe, gdy to już przedmiot posiadany (wyekwipowany albo już w bagażu). Never touches
      // the extraAttack slot (gear only), so those two fields just pass through unchanged.
      const { data, error } = await sb.rpc("purchase_equipment", { p_slug: slug });
      if (error) {
        console.error("purchase_equipment", error);
        const message =
          error.message === "insufficient_coins"
            ? "Not enough copper coins."
            : error.message === "unknown_item"
              ? "Unknown item."
              : error.message === "bag_full"
                ? "Backpack is full."
                : `Purchase failed: ${saveHint(error)}`;
        return { ok: false as const, error: message };
      }
      const row = (Array.isArray(data) ? data[0] : data) as
        | {
            equipped_helm?: string | null;
            equipped_armor?: string | null;
            equipped_boots?: string | null;
            equipment_bag?: (string | null)[] | null;
            equipment_bag_qty?: (number | null)[] | null;
            coins?: number | string;
          }
        | null;
      const newCoins = Number(row?.coins ?? currentCoins);
      const newBag = normalizeBag(row?.equipment_bag ?? currentEquipmentBag);
      const newBagQty = normalizeQty(row?.equipment_bag_qty ?? currentEquipmentBagQty);
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
            equippedExtraAttack: currentEquippedExtraAttack,
            equippedExtraAttackQty: currentEquippedExtraAttackQty,
            equipmentBag: newBag,
            equipmentBagQty: newBagQty,
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
      currentEquippedExtraAttack,
      currentEquippedExtraAttackQty,
      currentEquipmentBag,
      currentEquipmentBagQty,
    ],
  );

  const equipFromBag = useCallback(
    async (bagIndex: number) => {
      if (!sb) return { ok: false as const, error: "Requires Supabase to be configured." };
      if (!userId) return { ok: false as const, error: "Session expired — please sign in again." };
      const { data, error } = await sb.rpc("equip_from_bag", { p_bag_index: bagIndex + 1 });
      if (error) {
        console.error("equip_from_bag", error);
        return { ok: false as const, error: `Failed: ${saveHint(error)}` };
      }
      const row = (Array.isArray(data) ? data[0] : data) as
        | {
            equipped_helm?: string | null;
            equipped_armor?: string | null;
            equipped_boots?: string | null;
            equipped_extra_attack?: string | null;
            equipped_extra_attack_qty?: number | string;
            equipment_bag?: (string | null)[] | null;
            equipment_bag_qty?: (number | null)[] | null;
          }
        | null;
      const newEquippedExtraAttack = row?.equipped_extra_attack ?? currentEquippedExtraAttack;
      const newEquippedExtraAttackQty = Number(row?.equipped_extra_attack_qty ?? currentEquippedExtraAttackQty);
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
            shurikenAmmo: shurikenAmmoFromEquip(newEquippedExtraAttack, newEquippedExtraAttackQty),
            equippedHelm: row?.equipped_helm ?? currentEquippedHelm,
            equippedArmor: row?.equipped_armor ?? currentEquippedArmor,
            equippedBoots: row?.equipped_boots ?? currentEquippedBoots,
            equippedExtraAttack: newEquippedExtraAttack,
            equippedExtraAttackQty: newEquippedExtraAttackQty,
            equipmentBag: normalizeBag(row?.equipment_bag ?? currentEquipmentBag),
            equipmentBagQty: normalizeQty(row?.equipment_bag_qty ?? currentEquipmentBagQty),
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
      currentEquippedHelm,
      currentEquippedArmor,
      currentEquippedBoots,
      currentEquippedExtraAttack,
      currentEquippedExtraAttackQty,
      currentEquipmentBag,
      currentEquipmentBagQty,
    ],
  );

  const unequipToBag = useCallback(
    async (slot: "helm" | "armor" | "boots" | "extraAttack", bagIndex: number) => {
      if (!sb) return { ok: false as const, error: "Requires Supabase to be configured." };
      if (!userId) return { ok: false as const, error: "Session expired — please sign in again." };
      const { data, error } = await sb.rpc("unequip_to_bag", { p_slot: slot, p_bag_index: bagIndex + 1 });
      if (error) {
        console.error("unequip_to_bag", error);
        const message = error.message === "slot_occupied" ? "That backpack slot is taken." : `Failed: ${saveHint(error)}`;
        return { ok: false as const, error: message };
      }
      const row = (Array.isArray(data) ? data[0] : data) as
        | {
            equipped_helm?: string | null;
            equipped_armor?: string | null;
            equipped_boots?: string | null;
            equipped_extra_attack?: string | null;
            equipped_extra_attack_qty?: number | string;
            equipment_bag?: (string | null)[] | null;
            equipment_bag_qty?: (number | null)[] | null;
          }
        | null;
      const newEquippedExtraAttack = row?.equipped_extra_attack ?? (slot === "extraAttack" ? null : currentEquippedExtraAttack);
      const newEquippedExtraAttackQty = Number(
        row?.equipped_extra_attack_qty ?? (slot === "extraAttack" ? 0 : currentEquippedExtraAttackQty),
      );
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
            shurikenAmmo: shurikenAmmoFromEquip(newEquippedExtraAttack, newEquippedExtraAttackQty),
            equippedHelm: row?.equipped_helm ?? (slot === "helm" ? null : currentEquippedHelm),
            equippedArmor: row?.equipped_armor ?? (slot === "armor" ? null : currentEquippedArmor),
            equippedBoots: row?.equipped_boots ?? (slot === "boots" ? null : currentEquippedBoots),
            equippedExtraAttack: newEquippedExtraAttack,
            equippedExtraAttackQty: newEquippedExtraAttackQty,
            equipmentBag: normalizeBag(row?.equipment_bag ?? currentEquipmentBag),
            equipmentBagQty: normalizeQty(row?.equipment_bag_qty ?? currentEquipmentBagQty),
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
      currentEquippedHelm,
      currentEquippedArmor,
      currentEquippedBoots,
      currentEquippedExtraAttack,
      currentEquippedExtraAttackQty,
      currentEquipmentBag,
      currentEquipmentBagQty,
    ],
  );

  const moveBagItem = useCallback(
    async (fromIndex: number, toIndex: number) => {
      if (!sb) return { ok: false as const, error: "Requires Supabase to be configured." };
      if (!userId) return { ok: false as const, error: "Session expired — please sign in again." };
      const { data, error } = await sb.rpc("move_bag_item", { p_from_index: fromIndex + 1, p_to_index: toIndex + 1 });
      if (error) {
        console.error("move_bag_item", error);
        return { ok: false as const, error: `Failed: ${saveHint(error)}` };
      }
      const row = (Array.isArray(data) ? data[0] : data) as
        | { equipment_bag?: (string | null)[] | null; equipment_bag_qty?: (number | null)[] | null }
        | null;
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
            equippedHelm: currentEquippedHelm,
            equippedArmor: currentEquippedArmor,
            equippedBoots: currentEquippedBoots,
            equippedExtraAttack: currentEquippedExtraAttack,
            equippedExtraAttackQty: currentEquippedExtraAttackQty,
            equipmentBag: normalizeBag(row?.equipment_bag ?? currentEquipmentBag),
            equipmentBagQty: normalizeQty(row?.equipment_bag_qty ?? currentEquipmentBagQty),
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
      currentEquippedExtraAttack,
      currentEquippedExtraAttackQty,
      currentEquipmentBag,
      currentEquipmentBagQty,
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
    // Goście nie mają wiersza w `profiles`, więc nie ma czego liczyć — a useShuriken() i tak
    // odrzuca użycie bez userId (patrz doc comment tej funkcji), więc pokazywanie tu jakiegokolwiek
    // fałszywego zapasu tylko myli niezalogowanego gracza.
    shurikenAmmo: mine?.shurikenAmmo ?? 0,
    equippedHelm: mine?.equippedHelm ?? null,
    equippedArmor: mine?.equippedArmor ?? null,
    equippedBoots: mine?.equippedBoots ?? null,
    equippedExtraAttack: mine?.equippedExtraAttack ?? null,
    equippedExtraAttackQty: mine?.equippedExtraAttackQty ?? 0,
    equipmentBag: mine?.equipmentBag ?? normalizeBag(null),
    equipmentBagQty: mine?.equipmentBagQty ?? normalizeQty(null),
    error,
    save,
    purchaseColor,
    purchaseCosmetic,
    donateToFountain,
    purchaseCharacter,
    useFlashGrenade,
    saveBallSkin,
    useShuriken,
    purchaseShurikenAmmo,
    purchaseEquipment,
    equipFromBag,
    unequipToBag,
    moveBagItem,
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
