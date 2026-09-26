"use client";
import { useEffect, useState } from "react";
import { useHeaderPanel } from "@/lib/headerPanel";
import { HEADER_BUTTON_CLASS } from "@/lib/headerButtonStyles";

/** Header button next to "How to play": short description of the game plus public stats. */
export function AboutGameButton() {
  const [open, toggle, close] = useHeaderPanel("aboutGame");
  const [accounts, setAccounts] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/stats")
      .then((res) => res.json())
      .then((data: { accounts: number | null }) => {
        if (!cancelled) setAccounts(data.accounts);
      })
      .catch(() => {
        if (!cancelled) setAccounts(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <div className="relative">
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-zinc-700 bg-zinc-900/95 p-4 text-sm text-zinc-100 shadow-xl backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold">About the game</span>
            <button type="button" onClick={close} className="text-xs text-zinc-400 hover:text-zinc-200">
              Close
            </button>
          </div>
          <p className="text-zinc-300">
            StudyQuest.Party is a shared coworking space with a Pomodoro timer — sit in a room,
            focus alongside other players in real time, and take breaks together.
          </p>
          <div className="mt-3 border-t border-zinc-700 pt-2 text-zinc-400">
            {accounts === null ? (
              <span>Loading stats…</span>
            ) : (
              <span>
                <span className="font-semibold text-zinc-200">{accounts.toLocaleString()}</span>{" "}
                accounts created so far
              </span>
            )}
          </div>
        </div>
      )}
      <button type="button" onClick={toggle} className={HEADER_BUTTON_CLASS}>
        About
      </button>
    </div>
  );
}
