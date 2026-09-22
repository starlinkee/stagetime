"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PixelPerson } from "@/components/PixelPerson";
import { RoomStage, type RoomZone } from "@/components/RoomStage";
import { COLOR_CHANGE_COST } from "@/lib/coins";
import { EXIT_ZONE } from "@/lib/rooms";
import { COLOR_CHOICES, useMyProfile } from "@/lib/useProfile";

const WORLD_W = 1600;
const ZONE_W = 260;
const ZONE_H = 170;
const ZONE_Y = 420;
const COLOR_ZONE_SLUG = "color-change";

/** Jedyna dziś strefa akcji w Shopie — kupienie zmiany koloru postaci za copper coins. */
const SHOP_ZONES: RoomZone[] = [
  EXIT_ZONE,
  {
    slug: COLOR_ZONE_SLUG,
    name: "Color Change",
    kind: "action",
    x: WORLD_W / 2 - ZONE_W / 2,
    y: ZONE_Y,
    w: ZONE_W,
    h: ZONE_H,
  },
];

/**
 * Pokój-sklep: wejście już wymaga konta (patrz RoomZone.requiresAuth w lobby i sprawdzenie w
 * /api/rooms/enter), więc tu zakładamy zalogowanego gracza. Jedyny przedmiot na start to zmiana
 * koloru postaci — trzymanie E na podłogowym przycisku otwiera duży wybór koloru (większa wersja
 * panelu z ProfileMenu.tsx). Coiny znikają dopiero, gdy zapis w bazie faktycznie się powiedzie
 * (jedno RPC robi obie rzeczy atomowo, patrz useProfile.purchaseColor) — crash przeglądarki w
 * dowolnym momencie przed tym nigdy nie zdejmuje coinów bez zmiany koloru.
 */
export function ShopRoom({ roomSlug }: { roomSlug: string }) {
  const { ready, color: currentColor, coins, purchaseColor } = useMyProfile();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(currentColor);
  const [confirmingSame, setConfirmingSame] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  const onZoneAction = useCallback(
    (slug: string) => {
      if (slug !== COLOR_ZONE_SLUG) return;
      setPicked(currentColor);
      setConfirmingSame(false);
      setError(null);
      setOpen(true);
    },
    [currentColor],
  );

  const close = useCallback(() => {
    if (busy) return; // W trakcie zapisu nie ma czego anulować — poczekaj na wynik.
    setOpen(false);
    setConfirmingSame(false);
    setError(null);
  }, [busy]);

  const confirm = useCallback(async () => {
    if (busy) return;
    if (picked === currentColor && !confirmingSame) {
      // Ten sam kolor: druga, jawna zgoda, bo i tak płaci się pełną cenę.
      setConfirmingSame(true);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await purchaseColor(picked);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setConfirmingSame(false);
    setToast("Color updated!");
  }, [busy, picked, currentColor, confirmingSame, purchaseColor]);

  const canAfford = coins >= COLOR_CHANGE_COST;

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
          Walk onto the floor button and hold E — Color Change costs {COLOR_CHANGE_COST} copper coins.
        </p>
        {toast && <p className="text-sm font-semibold text-emerald-400">{toast}</p>}
      </div>
      {open && ready && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Character color shop"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-100">Character color</h2>
              <span className="flex items-center gap-1 rounded-full bg-orange-500/20 px-2.5 py-1 text-xs font-semibold text-orange-300">
                {COLOR_CHANGE_COST} copper coins
              </span>
            </div>
            <div className="mb-5 flex items-center justify-center gap-8">
              <PixelPerson color={picked} size={8} />
              <div className="flex flex-col gap-1 text-sm text-zinc-400">
                <span>Your balance</span>
                <span className={`text-lg font-semibold ${canAfford ? "text-zinc-100" : "text-rose-400"}`}>
                  {coins.toFixed(1)} coins
                </span>
              </div>
            </div>
            <div className="mb-5 flex flex-wrap justify-center gap-3" role="radiogroup" aria-label="Pick a color">
              {COLOR_CHOICES.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={c === picked}
                  aria-label={c}
                  onClick={() => {
                    setPicked(c);
                    setConfirmingSame(false);
                  }}
                  style={{ backgroundColor: c }}
                  className={`h-11 w-11 rounded-lg border-4 transition-colors ${c === picked ? "border-white" : "border-transparent hover:border-zinc-600"}`}
                />
              ))}
            </div>
            {!canAfford && (
              <p className="mb-3 text-center text-sm text-rose-400">
                You need {(COLOR_CHANGE_COST - coins).toFixed(1)} more copper coins.
              </p>
            )}
            {confirmingSame && (
              <p className="mb-3 text-center text-sm text-amber-400">
                That&apos;s already your current color — you&apos;ll still be charged {COLOR_CHANGE_COST} coins. Buy anyway?
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
                {busy ? "Processing…" : confirmingSame ? "Yes, charge me" : "Confirm purchase"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
