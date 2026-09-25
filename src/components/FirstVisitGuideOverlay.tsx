"use client";
import { useState } from "react";
import { useHowToPlay } from "@/lib/howToPlay";
import { useSession } from "@/lib/useSession";

const STORAGE_KEY = "stagetime:seenGuide";

function hasSeenGuide() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Full-screen "How to play" overlay shown once to a signed-out visitor on their first load.
 * Reuses the same controls text as HowToPlayButton (see src/lib/howToPlay.ts), so it only
 * appears once RoomStage has published a room's controls.
 */
export function FirstVisitGuideOverlay() {
  const { ready, session, available } = useSession();
  const text = useHowToPlay();
  const [seen, setSeen] = useState(hasSeenGuide);

  if (!available || !ready || session || seen || !text) return null;

  const points = text.split("·").map((p) => p.trim()).filter(Boolean);

  const dismiss = () => {
    setSeen(true);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // brak localStorage (np. tryb prywatny) — overlay po prostu wróci przy kolejnym odświeżeniu
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/90 p-6 backdrop-blur-sm">
      <div
        role="alertdialog"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-6 text-zinc-100 shadow-2xl"
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
          onClick={dismiss}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
