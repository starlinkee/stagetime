"use client";
import { useEffect, useRef, useState } from "react";
import {
  ADMIN_SETTINGS_SCHEMA,
  DEFAULT_ADMIN_SETTINGS,
  isAdminUiEnabled,
  resetAdminSettings,
  setAdminAccountFlag,
  setAdminSetting,
  useAdminSettings,
} from "@/lib/adminSettings";
import { useIsAdmin } from "@/lib/useIsAdmin";
import { useHeaderPanel } from "@/lib/headerPanel";
import { HEADER_BUTTON_CLASS } from "@/lib/headerButtonStyles";
import { getSupabase } from "@/lib/supabase";

/**
 * Przycisk w headerze + panel z ustawieniami admina. Widoczny lokalnie i na Vercel Preview dla
 * każdego, i (STU-83) na produkcji dla kont z public.admins (patrz useIsAdmin/isAdminUiEnabled) —
 * zmiany działają od razu w całej apce na tej przeglądarce, trzymane w localStorage.
 */
export function AdminPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, toggle] = useHeaderPanel("admin", containerRef);
  const settings = useAdminSettings();
  const isAdminAccount = useIsAdmin();
  const [goldAmount, setGoldAmount] = useState(1000);
  const [goldStatus, setGoldStatus] = useState<string | null>(null);
  const [addingGold, setAddingGold] = useState(false);

  // Mirrors into adminSettings.ts's module-level flag so isAdminUiEnabled() also reads correctly
  // from plain (non-React) call sites, like RoomStage.tsx's per-tick input-sending code.
  useEffect(() => {
    setAdminAccountFlag(isAdminAccount);
  }, [isAdminAccount]);

  // Self-service coin top-up, backed by admin_add_coins (supabase/migrations/0057_admin_add_coins.sql) —
  // that RPC re-checks public.admins server-side and only ever credits the caller's own account,
  // so this button existing client-side for a non-admin account is harmless (the call just fails).
  async function addGold() {
    const sb = getSupabase();
    if (!sb || goldAmount <= 0) return;
    setAddingGold(true);
    setGoldStatus(null);
    const { data, error } = await sb.rpc("admin_add_coins", { p_amount: goldAmount });
    setAddingGold(false);
    if (error) {
      setGoldStatus(error.message === "not_admin" ? "Not an admin account." : `Failed: ${error.message}`);
      return;
    }
    setGoldStatus(`Coins now: ${data}`);
  }

  if (!isAdminUiEnabled() && !isAdminAccount) return null;

  return (
    <div className="relative" ref={containerRef}>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 flex max-h-[80vh] w-[95vw] max-w-6xl flex-col rounded-lg border border-zinc-700 bg-zinc-900/80 text-sm text-zinc-100 shadow-xl backdrop-blur">
          <div className="flex shrink-0 items-center justify-between border-b border-zinc-700 px-4 py-3">
            <span className="font-semibold">Admin</span>
            <button
              type="button"
              onClick={resetAdminSettings}
              className="text-xs text-zinc-400 hover:text-zinc-200"
            >
              Reset
            </button>
          </div>
          <div className="overflow-y-auto p-4">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
              {ADMIN_SETTINGS_SCHEMA.map((def) => (
                <label key={def.key} className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-400">{def.label}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={settings[def.key]}
                      min={def.min}
                      max={def.max}
                      step={def.step ?? 1}
                      onChange={(e) => {
                        const v = e.target.valueAsNumber;
                        if (Number.isFinite(v)) setAdminSetting(def.key, v);
                      }}
                      className="w-full rounded border border-zinc-600 bg-zinc-800/80 px-2 py-1 text-zinc-100"
                    />
                    {def.suffix && <span className="text-xs text-zinc-400">{def.suffix}</span>}
                  </div>
                  <span className="text-[11px] text-zinc-500">domyślnie: {DEFAULT_ADMIN_SETTINGS[def.key]}{def.suffix}</span>
                </label>
              ))}
            </div>
            {isAdminAccount && (
              <div className="mt-4 border-t border-zinc-700 pt-3">
                <span className="text-xs text-zinc-400">Add gold to my account</span>
                <div className="mt-1 flex max-w-xs items-center gap-2">
                  <input
                    type="number"
                    value={goldAmount}
                    min={1}
                    step={1}
                    onChange={(e) => {
                      const v = e.target.valueAsNumber;
                      if (Number.isFinite(v)) setGoldAmount(v);
                    }}
                    className="w-full rounded border border-zinc-600 bg-zinc-800/80 px-2 py-1 text-zinc-100"
                  />
                  <button
                    type="button"
                    onClick={addGold}
                    disabled={addingGold || goldAmount <= 0}
                    className="shrink-0 rounded bg-orange-600 px-2 py-1 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
                {goldStatus && <span className="mt-1 block text-[11px] text-zinc-500">{goldStatus}</span>}
              </div>
            )}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={toggle}
        className={HEADER_BUTTON_CLASS}
      >
        Admin
      </button>
    </div>
  );
}
