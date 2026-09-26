"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CharacterSprite } from "@/components/CharacterSprite";
import { CosmeticOverlay } from "@/components/CosmeticOverlay";
import { RoomStage, type RoomZone } from "@/components/RoomStage";
import {
  CHARACTER_CHANGE_COST,
  FLOWER_COST,
  FLOWER_HOURS,
  SHURIKEN_AMMO_COST,
  SHURIKEN_AMMO_PACK,
  SPARKLES_COST,
  SPARKLES_HOURS,
} from "@/lib/coins";
import { EXIT_ZONE } from "@/lib/rooms";
import { DEFAULT_COLOR, type CharacterSlug, useMyProfile } from "@/lib/useProfile";
import { EQUIPMENT_ITEMS, type EquipSlot } from "@realtime-shared/constants";

type CosmeticSlug = "flower" | "sparkles";

/**
 * One entry per purchasable cosmetic (see supabase/migrations/0027_cosmetic_items.sql,
 * 0035_sparkles_cosmetic.sql) — cost/hours here are display-only copies of what purchase_cosmetic
 * actually charges server-side, same caveat as FLOWER_COST/SPARKLES_COST in lib/coins.ts. Both are
 * sold by the Florist NPC below, alongside the character-change service, so this only carries the
 * per-item display info (no zone of its own anymore).
 */
const COSMETIC_ITEMS: Record<CosmeticSlug, { name: string; cost: number; hours: number; blurb: string }> = {
  flower: {
    name: "Flower crown",
    cost: FLOWER_COST,
    hours: FLOWER_HOURS,
    blurb: "Purely decorative — sits on your head, no effect on gameplay.",
  },
  sparkles: {
    name: "Shining",
    cost: SPARKLES_COST,
    hours: SPARKLES_HOURS,
    blurb: "A sparkling aura around you — purely decorative, no effect on gameplay.",
  },
};
/**
 * Character look (see supabase/migrations/0031_character_selection.sql,
 * 0033_girl_character.sql) — the three choices that exist today, see CharacterSprite.tsx.
 */
const CHARACTER_OPTIONS: { slug: CharacterSlug; name: string }[] = [
  { slug: "classic", name: "Classic" },
  { slug: "girl", name: "Girl" },
  { slug: "pixel", name: "Pixel" },
];
/**
 * Florist NPC: one stall selling everything purely cosmetic — flower crown, shining, and
 * character change (all no gameplay effect, see AGENTS.md) — instead of three separate floor
 * buttons. Interacting opens a menu (see floristOpen below) that fans out into the existing
 * cosmetic/character dialogs.
 */
const FLORIST_ZONE_SLUG = "florist";
const FLORIST_ZONE: RoomZone = { slug: FLORIST_ZONE_SLUG, name: "Florist", kind: "action", x: 573, y: 610, w: 220, h: 140 };
/** Third weapon (weapon slot 3, see WEAPON_SLOTS in RoomStage.tsx): the gunman NPC sells shuriken
 * ammo packs for coins — a real gameplay effect (unlike the cosmetics/character above), so the
 * atomic balance-check-and-grant happens server-side (see buy_shuriken_ammo in
 * supabase/migrations/0040_shuriken_ammo.sql), same "coins never disappear before the item is
 * granted" guarantee as purchaseCosmetic. */
const GUNMAN_ZONE_SLUG = "gunman";
const GUNMAN_ZONE: RoomZone = { slug: GUNMAN_ZONE_SLUG, name: "Gunman", kind: "action", x: 763, y: 280, w: 220, h: 140 };
/** STU-77: the only place helm/armor/boots (see EQUIPMENT_ITEMS in
 * realtime-server/shared/constants.ts) can be bought/equipped — the Tab inventory panel
 * (RoomStage.tsx) only shows what's already equipped and lets you unequip, same "buy here, view
 * there" split as the gunman above (ammo bought here, hotbar/hp shown elsewhere). */
const GEAR_ZONE_SLUG = "gear-specialist";
const GEAR_ZONE: RoomZone = { slug: GEAR_ZONE_SLUG, name: "Gear specialist", kind: "action", x: 383, y: 280, w: 220, h: 140 };
/** The three sellers sit evenly spaced (120° apart) on a circle around the shop floor, Florist
 * closest to the entrance, Gear specialist and Gunman mirrored either side further back. */
const SHOP_ZONES: RoomZone[] = [EXIT_ZONE, FLORIST_ZONE, GUNMAN_ZONE, GEAR_ZONE];

/**
 * Pokój-sklep: wejście już wymaga konta (patrz RoomZone.requiresAuth w lobby i sprawdzenie w
 * /api/rooms/enter), więc tu zakładamy zalogowanego gracza. Kosmetyki (patrz COSMETIC_ITEMS) są
 * czysto dekoracyjne, tymczasowe przedmioty bez wpływu na rozgrywkę (patrz AGENTS.md). Coiny
 * znikają dopiero, gdy zapis w bazie faktycznie się powiedzie (jedno RPC robi obie rzeczy
 * atomowo, patrz useProfile.purchaseCosmetic) — crash przeglądarki w dowolnym momencie przed tym
 * nigdy nie zdejmuje coinów bez przyznania przedmiotu.
 */
export function ShopRoom({ roomSlug }: { roomSlug: string }) {
  const {
    ready,
    coins,
    cosmetic,
    character,
    shurikenAmmo,
    equippedHelm,
    equippedArmor,
    equippedBoots,
    purchaseCosmetic,
    purchaseCharacter,
    purchaseShurikenAmmo,
    purchaseEquipment,
    unequipEquipment,
  } = useMyProfile();
  const [floristOpen, setFloristOpen] = useState(false);
  const [activeItem, setActiveItem] = useState<CosmeticSlug | null>(null);
  const [confirmingRebuy, setConfirmingRebuy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [characterOpen, setCharacterOpen] = useState(false);
  const [characterBusy, setCharacterBusy] = useState(false);
  const [characterError, setCharacterError] = useState<string | null>(null);
  const [gunmanOpen, setGunmanOpen] = useState(false);
  const [gunmanBusy, setGunmanBusy] = useState(false);
  const [gunmanError, setGunmanError] = useState<string | null>(null);
  const [gearOpen, setGearOpen] = useState(false);
  const [gearBusy, setGearBusy] = useState(false);
  const [gearError, setGearError] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  const onZoneAction = useCallback((slug: string) => {
    if (slug === FLORIST_ZONE_SLUG) {
      setFloristOpen(true);
    } else if (slug === GUNMAN_ZONE_SLUG) {
      setGunmanError(null);
      setGunmanOpen(true);
    } else if (slug === GEAR_ZONE_SLUG) {
      setGearError(null);
      setGearOpen(true);
    }
  }, []);

  const closeFlorist = useCallback(() => setFloristOpen(false), []);

  const openCosmetic = useCallback((item: CosmeticSlug) => {
    setFloristOpen(false);
    setConfirmingRebuy(false);
    setError(null);
    setActiveItem(item);
  }, []);

  const openCharacter = useCallback(() => {
    setFloristOpen(false);
    setCharacterError(null);
    setCharacterOpen(true);
  }, []);

  const close = useCallback(() => {
    if (busy) return; // W trakcie zapisu nie ma czego anulować — poczekaj na wynik.
    setActiveItem(null);
    setConfirmingRebuy(false);
    setError(null);
  }, [busy]);

  const closeCharacter = useCallback(() => {
    if (characterBusy) return;
    setCharacterOpen(false);
    setCharacterError(null);
  }, [characterBusy]);

  const closeGunman = useCallback(() => {
    if (gunmanBusy) return;
    setGunmanOpen(false);
    setGunmanError(null);
  }, [gunmanBusy]);

  const closeGear = useCallback(() => {
    if (gearBusy) return;
    setGearOpen(false);
    setGearError(null);
  }, [gearBusy]);

  const owned = activeItem !== null && cosmetic === activeItem;

  const confirm = useCallback(async () => {
    if (busy || !activeItem) return;
    if (owned && !confirmingRebuy) {
      // Już aktywny: druga, jawna zgoda, bo kupno i tak resetuje licznik do pełnych `hours`
      // zamiast się do niego doliczać (jeden aktywny slot, patrz 0027_cosmetic_items.sql).
      setConfirmingRebuy(true);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await purchaseCosmetic(activeItem);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setActiveItem(null);
    setConfirmingRebuy(false);
    setToast(`${COSMETIC_ITEMS[activeItem].name} equipped!`);
  }, [busy, owned, confirmingRebuy, activeItem, purchaseCosmetic]);

  const pickCharacter = useCallback(
    async (slug: CharacterSlug) => {
      if (characterBusy || slug === character) return;
      setCharacterBusy(true);
      setCharacterError(null);
      const result = await purchaseCharacter(slug);
      setCharacterBusy(false);
      if (!result.ok) {
        setCharacterError(result.error);
        return;
      }
      setCharacterOpen(false);
      setToast("Character changed!");
    },
    [characterBusy, character, purchaseCharacter],
  );

  const buyShurikens = useCallback(async () => {
    if (gunmanBusy) return;
    setGunmanBusy(true);
    setGunmanError(null);
    const result = await purchaseShurikenAmmo();
    setGunmanBusy(false);
    if (!result.ok) {
      setGunmanError(result.error);
      return;
    }
    setToast(`+${SHURIKEN_AMMO_PACK} shurikens!`);
  }, [gunmanBusy, purchaseShurikenAmmo]);

  const equippedBySlot: Record<EquipSlot, string | null> = { helm: equippedHelm, armor: equippedArmor, boots: equippedBoots };

  const buyGear = useCallback(
    async (slug: string, name: string) => {
      if (gearBusy) return;
      setGearBusy(true);
      setGearError(null);
      const result = await purchaseEquipment(slug);
      setGearBusy(false);
      if (!result.ok) {
        setGearError(result.error);
        return;
      }
      setToast(`${name} equipped!`);
    },
    [gearBusy, purchaseEquipment],
  );

  const unequipGear = useCallback(
    async (slot: EquipSlot) => {
      if (gearBusy) return;
      setGearBusy(true);
      setGearError(null);
      const result = await unequipEquipment(slot);
      setGearBusy(false);
      if (!result.ok) {
        setGearError(result.error);
        return;
      }
      setToast("Unequipped.");
    },
    [gearBusy, unequipEquipment],
  );

  const activeItemInfo = activeItem ? COSMETIC_ITEMS[activeItem] : null;
  const canAfford = activeItemInfo ? coins >= activeItemInfo.cost : false;
  const canAffordCharacter = coins >= CHARACTER_CHANGE_COST;
  const canAffordShurikens = coins >= SHURIKEN_AMMO_COST;

  const zones = useMemo(() => SHOP_ZONES, []);

  return (
    <>
      <RoomStage
        roomSlug={roomSlug}
        zones={zones}
        spawnZoneSlug={EXIT_ZONE.slug}
        onZoneAction={onZoneAction}
        xpRunning={false}
      />
      <div className="flex w-full max-w-2xl flex-col items-center gap-2 text-center">
        <p className="text-sm text-zinc-500">
          Hold E on a floor button to visit the florist for cosmetics and a character change, the gunman
          for shurikens, or the gear specialist for helm/armor/boots.
        </p>
        {toast && <p className="text-sm font-semibold text-emerald-400">{toast}</p>}
      </div>
      {floristOpen && ready && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Florist"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-100">Florist</h2>
              <span className="flex flex-col gap-1 text-right text-sm text-zinc-400">
                Your balance
                <span className="text-lg font-semibold text-zinc-100">{coins.toFixed(1)} coins</span>
              </span>
            </div>
            <p className="mb-5 text-center text-sm text-zinc-400">
              Flower crown, shining, and a character change — all purely cosmetic, no effect on gameplay.
            </p>
            <div className="mb-3 flex flex-col gap-3">
              <button
                type="button"
                onClick={() => openCosmetic("flower")}
                className="flex items-center justify-between rounded-xl border border-zinc-700 px-4 py-3 text-left hover:bg-zinc-900"
              >
                <span className="text-sm font-medium text-zinc-100">{COSMETIC_ITEMS.flower.name}</span>
                <span className="text-xs text-zinc-500">{COSMETIC_ITEMS.flower.cost} coins</span>
              </button>
              <button
                type="button"
                onClick={() => openCosmetic("sparkles")}
                className="flex items-center justify-between rounded-xl border border-zinc-700 px-4 py-3 text-left hover:bg-zinc-900"
              >
                <span className="text-sm font-medium text-zinc-100">{COSMETIC_ITEMS.sparkles.name}</span>
                <span className="text-xs text-zinc-500">{COSMETIC_ITEMS.sparkles.cost} coins</span>
              </button>
              <button
                type="button"
                onClick={openCharacter}
                className="flex items-center justify-between rounded-xl border border-zinc-700 px-4 py-3 text-left hover:bg-zinc-900"
              >
                <span className="text-sm font-medium text-zinc-100">Change character</span>
                <span className="text-xs text-zinc-500">{CHARACTER_CHANGE_COST} coins</span>
              </button>
            </div>
            <div className="flex justify-center">
              <button
                type="button"
                onClick={closeFlorist}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {characterOpen && ready && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Change character"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-100">Change character</h2>
              <span className="flex items-center gap-1 rounded-full bg-orange-500/20 px-2.5 py-1 text-xs font-semibold text-orange-300">
                {CHARACTER_CHANGE_COST} copper coins
              </span>
            </div>
            <p className="mb-5 text-center text-sm text-zinc-400">
              Purely a look — no effect on gameplay. Switching back to your current character is free.
            </p>
            <div className="mb-5 flex items-center justify-center gap-8">
              {CHARACTER_OPTIONS.map((opt) => {
                const active = character === opt.slug;
                return (
                  <button
                    key={opt.slug}
                    type="button"
                    onClick={() => void pickCharacter(opt.slug)}
                    disabled={characterBusy || (active ? false : !canAffordCharacter)}
                    className={`flex flex-col items-center gap-2 rounded-xl border px-4 py-3 disabled:cursor-not-allowed disabled:opacity-50 ${
                      active ? "border-amber-500 bg-amber-500/10" : "border-zinc-700 hover:bg-zinc-900"
                    }`}
                  >
                    <div className="flex h-24 items-end justify-center">
                      <CharacterSprite character={opt.slug} color={DEFAULT_COLOR} size={4} />
                    </div>
                    <span className="text-sm font-medium text-zinc-200">{opt.name}</span>
                    <span className="text-xs text-zinc-500">
                      {active ? "Equipped" : `${CHARACTER_CHANGE_COST} coins`}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mb-3 flex flex-col gap-1 text-center text-sm text-zinc-400">
              <span>Your balance</span>
              <span className={`text-lg font-semibold ${canAffordCharacter ? "text-zinc-100" : "text-rose-400"}`}>
                {coins.toFixed(1)} coins
              </span>
            </div>
            {characterError && <p className="mb-3 text-center text-sm text-rose-400">{characterError}</p>}
            <div className="flex justify-center">
              <button
                type="button"
                onClick={closeCharacter}
                disabled={characterBusy}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {gunmanOpen && ready && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Gunman shop"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-100">Gunman</h2>
              <span className="flex items-center gap-1 rounded-full bg-orange-500/20 px-2.5 py-1 text-xs font-semibold text-orange-300">
                {SHURIKEN_AMMO_COST} copper coins
              </span>
            </div>
            <p className="mb-5 text-center text-sm text-zinc-400">
              Shurikens: 5 damage, much faster than a thrown ball. You have{" "}
              <span className="font-semibold text-zinc-100">{shurikenAmmo}</span> left. Buy a pack of{" "}
              {SHURIKEN_AMMO_PACK} more for {SHURIKEN_AMMO_COST} coins.
            </p>
            <div className="mb-3 flex flex-col gap-1 text-center text-sm text-zinc-400">
              <span>Your balance</span>
              <span className={`text-lg font-semibold ${canAffordShurikens ? "text-zinc-100" : "text-rose-400"}`}>
                {coins.toFixed(1)} coins
              </span>
            </div>
            {!canAffordShurikens && (
              <p className="mb-3 text-center text-sm text-rose-400">
                You need {(SHURIKEN_AMMO_COST - coins).toFixed(1)} more copper coins.
              </p>
            )}
            {gunmanError && <p className="mb-3 text-center text-sm text-rose-400">{gunmanError}</p>}
            <div className="flex justify-center gap-3">
              <button
                type="button"
                onClick={closeGunman}
                disabled={gunmanBusy}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void buyShurikens()}
                disabled={gunmanBusy || !canAffordShurikens}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {gunmanBusy ? "Processing…" : `Buy ${SHURIKEN_AMMO_PACK} shurikens`}
              </button>
            </div>
          </div>
        </div>
      )}
      {gearOpen && ready && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Gear specialist"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-100">Gear specialist</h2>
              <span className="flex flex-col gap-1 text-right text-sm text-zinc-400">
                Your balance
                <span className={`text-lg font-semibold ${coins >= 0 ? "text-zinc-100" : "text-rose-400"}`}>{coins.toFixed(1)} coins</span>
              </span>
            </div>
            <p className="mb-5 text-center text-sm text-zinc-400">
              Helm, armor and boots — each grants a real combat bonus. Unequip anytime from Tab for free; re-equipping
              costs coins again.
            </p>
            <div className="mb-5 flex flex-col gap-3">
              {EQUIPMENT_ITEMS.map((item) => {
                const equipped = equippedBySlot[item.slot] === item.slug;
                const bonus = item.maxHpBonus
                  ? `+${item.maxHpBonus} max HP`
                  : item.damageReductionBonus
                    ? `-${Math.round(item.damageReductionBonus * 100)}% damage taken`
                    : `+${item.moveSpeedBonus} move speed`;
                return (
                  <div
                    key={item.slug}
                    className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                      equipped ? "border-amber-500 bg-amber-500/10" : "border-zinc-700"
                    }`}
                  >
                    <div>
                      <p className="text-sm font-medium text-zinc-100">{item.name}</p>
                      <p className="text-xs text-emerald-400">{bonus}</p>
                    </div>
                    {equipped ? (
                      <button
                        type="button"
                        onClick={() => void unequipGear(item.slot)}
                        disabled={gearBusy}
                        className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
                      >
                        Unequip
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void buyGear(item.slug, item.name)}
                        disabled={gearBusy || coins < item.cost}
                        className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-zinc-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {item.cost} coins
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {gearError && <p className="mb-3 text-center text-sm text-rose-400">{gearError}</p>}
            <div className="flex justify-center">
              <button
                type="button"
                onClick={closeGear}
                disabled={gearBusy}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {activeItemInfo && ready && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${activeItemInfo.name} shop`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-100">{activeItemInfo.name}</h2>
              <span className="flex items-center gap-1 rounded-full bg-orange-500/20 px-2.5 py-1 text-xs font-semibold text-orange-300">
                {activeItemInfo.cost} copper coins
              </span>
            </div>
            <div className="mb-5 flex items-center justify-center gap-8">
              <div className="relative h-24 w-24">
                <CosmeticOverlay cosmetic={activeItem} variant="preview" />
              </div>
              <div className="flex flex-col gap-1 text-sm text-zinc-400">
                <span>Your balance</span>
                <span className={`text-lg font-semibold ${canAfford ? "text-zinc-100" : "text-rose-400"}`}>
                  {coins.toFixed(1)} coins
                </span>
              </div>
            </div>
            <p className="mb-5 text-center text-sm text-zinc-400">
              {activeItemInfo.blurb} Lasts {activeItemInfo.hours} hours from purchase.
            </p>
            {owned && !confirmingRebuy && (
              <p className="mb-3 text-center text-sm text-emerald-400">You already have this equipped.</p>
            )}
            {!canAfford && (
              <p className="mb-3 text-center text-sm text-rose-400">
                You need {(activeItemInfo.cost - coins).toFixed(1)} more copper coins.
              </p>
            )}
            {confirmingRebuy && (
              <p className="mb-3 text-center text-sm text-amber-400">
                You&apos;ll still be charged {activeItemInfo.cost} coins, resetting the timer to a full {activeItemInfo.hours} hours. Buy
                anyway?
              </p>
            )}
            {error && <p className="mb-3 text-center text-sm text-rose-400">{error}</p>}
            <div className="flex justify-center gap-3">
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={busy || !canAfford}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Processing…" : confirmingRebuy ? "Yes, charge me" : "Confirm purchase"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
