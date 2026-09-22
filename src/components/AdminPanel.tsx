"use client";
import { useState } from "react";
import {
  ADMIN_SETTINGS_SCHEMA,
  DEFAULT_ADMIN_SETTINGS,
  isAdminUiEnabled,
  resetAdminSettings,
  setAdminSetting,
  useAdminSettings,
} from "@/lib/adminSettings";

/**
 * Przycisk w lewym dolnym rogu + panel z ustawieniami admina. Widoczny tylko lokalnie
 * i na Vercel Preview (nigdy na produkcji, patrz isAdminUiEnabled) — zmiany działają
 * od razu w całej apce na tej wersji, trzymane w localStorage.
 */
export function AdminPanel() {
  const [open, setOpen] = useState(false);
  const settings = useAdminSettings();

  if (!isAdminUiEnabled()) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50">
      {open && (
        <div className="mb-2 w-72 rounded-lg border border-zinc-700 bg-zinc-900/95 p-4 text-sm text-zinc-100 shadow-xl backdrop-blur">
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
        onClick={() => setOpen((o) => !o)}
        className="rounded-full bg-zinc-800/90 px-3 py-2 text-xs font-medium text-zinc-200 shadow-lg ring-1 ring-zinc-600 hover:bg-zinc-700"
      >
        ⚙ Admin
      </button>
    </div>
  );
}
