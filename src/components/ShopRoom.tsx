"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CharacterSprite } from "@/components/CharacterSprite";
import { RoomStage, type RoomZone } from "@/components/RoomStage";
import { CHARACTER_CHANGE_COST, FLOWER_COST, FLOWER_HOURS } from "@/lib/coins";
import { EXIT_ZONE } from "@/lib/rooms";
import { DEFAULT_COLOR, type CharacterSlug, useMyProfile } from "@/lib/useProfile";

const FLOWER_SLUG = "flower";
const FLOWER_ZONE_SLUG = "flower-item";
const CHARACTER_ZONE_SLUG = "character-select";

/**
 * Color Change is disabled: the player character switched to fixed-art rotation sprites
 * (public/characters/player/rotation/*.png), which aren't recolorable, so there's currently
 * nothing to sell there. Purely cosmetic items (see supabase/migrations/0027_cosmetic_items.sql)
 * don't have this problem — they render as an overlay on top of the fixed art (see
 * PlayerSprite.tsx), so the floor button below is the first thing actually for sale in the Shop.
 */
const FLOWER_ZONE: RoomZone = { slug: FLOWER_ZONE_SLUG, name: "Flower crown", kind: "action", x: 573, y: 320, w: 220, h: 140 };
/**
 * Character look (see supabase/migrations/0031_character_selection.sql,
 * 0033_girl_character.sql) — the three choices that exist today, see CharacterSprite.tsx.
 */
const CHARACTER_OPTIONS: { slug: CharacterSlug; name: string }[] = [
  { slug: "classic", name: "Classic" },
  { slug: "girl", name: "Girl" },
  { slug: "pixel", name: "Pixel" },
];
const CHARACTER_ZONE: RoomZone = { slug: CHARACTER_ZONE_SLUG, name: "Change character", kind: "action", x: 573, y: 500, w: 220, h: 140 };
const SHOP_ZONES: RoomZone[] = [EXIT_ZONE, FLOWER_ZONE, CHARACTER_ZONE];

/**
 * Pokój-sklep: wejście już wymaga konta (patrz RoomZone.requiresAuth w lobby i sprawdzenie w
 * /api/rooms/enter), więc tu zakładamy zalogowanego gracza. Jedyny przedmiot na start to kwiatek
 * na głowę — czysto kosmetyczny, tymczasowy (FLOWER_HOURS) przedmiot bez wpływu na rozgrywkę (patrz
 * AGENTS.md). Coiny znikają dopiero, gdy zapis w bazie faktycznie się powiedzie (jedno RPC robi obie
 * rzeczy atomowo, patrz useProfile.purchaseCosmetic) — crash przeglądarki w dowolnym momencie przed
 * tym nigdy nie zdejmuje coinów bez przyznania przedmiotu.
 */
export function ShopRoom({ roomSlug }: { roomSlug: string }) {
  const { ready, coins, cosmetic, character, purchaseCosmetic, purchaseCharacter } = useMyProfile();
  const [open, setOpen] = useState(false);
  const [confirmingRebuy, setConfirmingRebuy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [characterOpen, setCharacterOpen] = useState(false);
  const [characterBusy, setCharacterBusy] = useState(false);
  const [characterError, setCharacterError] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  const onZoneAction = useCallback((slug: string) => {
    if (slug === FLOWER_ZONE_SLUG) {
      setConfirmingRebuy(false);
      setError(null);
      setOpen(true);
    } else if (slug === CHARACTER_ZONE_SLUG) {
      setCharacterError(null);
      setCharacterOpen(true);
    }
  }, []);

  const close = useCallback(() => {
    if (busy) return; // W trakcie zapisu nie ma czego anulować — poczekaj na wynik.
    setOpen(false);
    setConfirmingRebuy(false);
    setError(null);
  }, [busy]);

  const closeCharacter = useCallback(() => {
    if (characterBusy) return;
    setCharacterOpen(false);
    setCharacterError(null);
  }, [characterBusy]);

  const owned = cosmetic === FLOWER_SLUG;

  const confirm = useCallback(async () => {
    if (busy) return;
    if (owned && !confirmingRebuy) {
      // Już aktywny: druga, jawna zgoda, bo kupno i tak resetuje licznik do pełnych FLOWER_HOURS
      // zamiast się do niego doliczać (jeden aktywny slot, patrz 0027_cosmetic_items.sql).
      setConfirmingRebuy(true);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await purchaseCosmetic(FLOWER_SLUG);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setConfirmingRebuy(false);
    setToast("Flower crown equipped!");
  }, [busy, owned, confirmingRebuy, purchaseCosmetic]);

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

  const canAfford = coins >= FLOWER_COST;
  const canAffordCharacter = coins >= CHARACTER_CHANGE_COST;

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
          Hold E on the floor button to browse the flower crown, or the wardrobe to change your character.
        </p>
        {toast && <p className="text-sm font-semibold text-emerald-400">{toast}</p>}
      </div>
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
      {open && ready && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Flower crown shop"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-100">Flower crown</h2>
              <span className="flex items-center gap-1 rounded-full bg-orange-500/20 px-2.5 py-1 text-xs font-semibold text-orange-300">
                {FLOWER_COST} copper coins
              </span>
            </div>
            <div className="mb-5 flex items-center justify-center gap-8">
              {/* eslint-disable-next-line @next/next/no-img-element -- small cutout, not worth next/image's overhead here */}
              <img src="/cosmetics/flower.png" alt="Flower crown" className="h-24 w-24 object-contain" style={{ imageRendering: "pixelated" }} />
              <div className="flex flex-col gap-1 text-sm text-zinc-400">
                <span>Your balance</span>
                <span className={`text-lg font-semibold ${canAfford ? "text-zinc-100" : "text-rose-400"}`}>
                  {coins.toFixed(1)} coins
                </span>
              </div>
            </div>
            <p className="mb-5 text-center text-sm text-zinc-400">
              Purely decorative — sits on your head, no effect on gameplay. Lasts {FLOWER_HOURS} hours from purchase.
            </p>
            {owned && !confirmingRebuy && (
              <p className="mb-3 text-center text-sm text-emerald-400">You already have this equipped.</p>
            )}
            {!canAfford && (
              <p className="mb-3 text-center text-sm text-rose-400">
                You need {(FLOWER_COST - coins).toFixed(1)} more copper coins.
              </p>
            )}
            {confirmingRebuy && (
              <p className="mb-3 text-center text-sm text-amber-400">
                You&apos;ll still be charged {FLOWER_COST} coins, resetting the timer to a full {FLOWER_HOURS} hours. Buy anyway?
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
