"use client";
import { createPortal } from "react-dom";
import { useHowToPlay } from "@/lib/howToPlay";
import { useHeaderPanel } from "@/lib/headerPanel";
import { HEADER_BUTTON_CLASS } from "@/lib/headerButtonStyles";

/**
 * Header button next to "Report idea": shows the current room's controls on click, on demand.
 * Reuses the exact same full-screen overlay look as FirstVisitGuideOverlay (the one shown
 * automatically to a signed-out visitor on their first load) instead of a small dropdown, so
 * "How to play" reads identically whether it appears on its own or because someone clicked Help.
 */
export function HowToPlayButton() {
  const text = useHowToPlay();
  const [open, toggle, close] = useHeaderPanel("howToPlay");

  if (!text) return null;

  const points = text.split("·").map((p) => p.trim()).filter(Boolean);

  return (
    <>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/40 p-6"
            onClick={close}
          >
          <div
            role="alertdialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900/85 p-6 text-zinc-100 shadow-2xl backdrop-blur-md"
          >
            <h2 className="mb-4 font-fredoka text-lg font-semibold">How to play</h2>
            <ul className="mb-6 list-disc space-y-2 pl-5 text-sm text-zinc-300">
              {points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <button
              type="button"
              autoFocus
              onClick={close}
              className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              Got it
            </button>
          </div>
        </div>,
          document.body
        )}
      <button type="button" onClick={toggle} className={HEADER_BUTTON_CLASS}>
        Help
      </button>
    </>
  );
}
