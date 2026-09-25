"use client";
import { setSoundEnabled, useSoundEnabled } from "@/lib/soundSettings";

/** Header button next to "How to play" (STU-3): mutes/unmutes the session-end chime and the
 * attack/hit sounds (see chime.ts) — every play* function there checks the same setting, so this
 * button is the only place that needs to change it. */
export function SoundToggleButton() {
  const enabled = useSoundEnabled();

  return (
    <button
      type="button"
      onClick={() => setSoundEnabled(!enabled)}
      aria-label={enabled ? "Mute sound" : "Unmute sound"}
      aria-pressed={enabled}
      title={enabled ? "Mute sound" : "Unmute sound"}
      className="rounded-full bg-zinc-800/90 px-3 py-2 text-xs font-medium text-zinc-200 shadow-lg ring-1 ring-zinc-600 hover:bg-zinc-700"
    >
      {enabled ? "🔊" : "🔇"}
    </button>
  );
}
