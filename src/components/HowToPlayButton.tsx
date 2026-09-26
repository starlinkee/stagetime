"use client";
import { useState } from "react";
import { useHowToPlay } from "@/lib/howToPlay";
import { HEADER_BUTTON_CLASS } from "@/lib/headerButtonStyles";

/** Header button next to "Report idea": shows the current room's controls on click, on demand. */
export function HowToPlayButton() {
  const text = useHowToPlay();
  const [open, setOpen] = useState(false);

  if (!text) return null;

  return (
    <div className="relative">
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-zinc-700 bg-zinc-900/95 p-4 text-sm text-zinc-100 shadow-xl backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold">How to play</span>
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-zinc-400 hover:text-zinc-200">
              Close
            </button>
          </div>
          <ul className="list-disc space-y-1 pl-4 text-zinc-300">
            {text.split("·").map((point) => point.trim()).filter(Boolean).map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
      )}
      <button type="button" onClick={() => setOpen((o) => !o)} className={HEADER_BUTTON_CLASS}>
        Help
      </button>
    </div>
  );
}
