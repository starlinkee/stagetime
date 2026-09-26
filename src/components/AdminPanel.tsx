"use client";
import { useEffect, useRef } from "react";
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

  // Mirrors into adminSettings.ts's module-level flag so isAdminUiEnabled() also reads correctly
  // from plain (non-React) call sites, like RoomStage.tsx's per-tick input-sending code.
  useEffect(() => {
    setAdminAccountFlag(isAdminAccount);
  }, [isAdminAccount]);

  if (!isAdminUiEnabled() && !isAdminAccount) return null;

  return (
    <div className="relative" ref={containerRef}>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-72 rounded-lg border border-zinc-700 bg-zinc-900/95 p-4 text-sm text-zinc-100 shadow-xl backdrop-blur">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-semibold">Admin</span>
            <button
              type="button"
              onClick={resetAdminSettings}
              className="text-xs text-zinc-400 hover:text-zinc-200"
            >
              Reset
            </button>
          </div>
          <div className="flex flex-col gap-3">
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
                    className="w-full rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-zinc-100"
                  />
                  {def.suffix && <span className="text-xs text-zinc-400">{def.suffix}</span>}
                </div>
                <span className="text-[11px] text-zinc-500">domyślnie: {DEFAULT_ADMIN_SETTINGS[def.key]}{def.suffix}</span>
              </label>
            ))}
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
