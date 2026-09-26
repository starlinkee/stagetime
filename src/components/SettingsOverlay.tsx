"use client";
import { createPortal } from "react-dom";
import { setMusicEnabled, useMusicEnabled } from "@/lib/musicSettings";
import { setSoundEnabled, useSoundEnabled } from "@/lib/soundSettings";

function ToggleRow({
  label,
  enabled,
  onChange,
}: {
  label: string;
  enabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-zinc-900 px-3 py-2.5">
      <span className="text-zinc-300">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={label}
        onClick={() => onChange(!enabled)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          enabled ? "bg-emerald-600" : "bg-zinc-700"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            enabled ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

/**
 * Settings overlay (STU-71): full-screen overlay opened from "Settings" above "Sign out" in
 * ProfileMenu — reuses the same portal/backdrop pattern as HowToPlayButton so it reads like every
 * other full-screen panel in the app. Houses the sound/music toggles that previously lived only as
 * a header button (SoundToggleButton) — see soundSettings.ts / musicSettings.ts for the persisted
 * preferences themselves.
 */
export function SettingsOverlay({ open, close }: { open: boolean; close: () => void }) {
  const soundEnabled = useSoundEnabled();
  const musicEnabled = useMusicEnabled();

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/40 p-6"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900/85 p-6 text-zinc-100 shadow-2xl backdrop-blur-md"
      >
        <h2 className="mb-4 font-fredoka text-lg font-semibold">Settings</h2>
        <div className="flex flex-col gap-2">
          <ToggleRow label="Sound" enabled={soundEnabled} onChange={setSoundEnabled} />
          <ToggleRow label="Music" enabled={musicEnabled} onChange={setMusicEnabled} />
        </div>
        <button
          type="button"
          autoFocus
          onClick={close}
          className="mt-6 w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          Done
        </button>
      </div>
    </div>,
    document.body
  );
}
