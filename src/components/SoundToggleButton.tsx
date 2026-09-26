"use client";
import { setSoundEnabled, useSoundEnabled } from "@/lib/soundSettings";
import { HEADER_BUTTON_CLASS } from "@/lib/headerButtonStyles";

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
      className={HEADER_BUTTON_CLASS}
    >
      {enabled ? "Sound" : "Muted"}
    </button>
  );
}
