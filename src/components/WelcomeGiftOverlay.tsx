"use client";
import { useState } from "react";
import { displayName, useSession } from "@/lib/useSession";

const STORAGE_PREFIX = "stagetime:seenWelcomeGift:";
/** How close created_at/last_sign_in_at have to be to count as "just signed up". */
const NEW_ACCOUNT_WINDOW_MS = 10_000;

function hasSeenWelcomeGift(userId: string) {
  try {
    return localStorage.getItem(STORAGE_PREFIX + userId) === "1";
  } catch {
    return false;
  }
}

/**
 * One-time "welcome" overlay shown right after a brand-new account's very first sign-in. Auth is
 * OAuth-only (see signInWith in useSession.ts) — there's no dedicated signUp() call to hook into —
 * so a fresh account is detected by auth.users.created_at and last_sign_in_at landing within a
 * few seconds of each other. shuriken_ammo already defaults to 10 for every new profiles row (see
 * supabase/migrations/0040_shuriken_ammo.sql), so this overlay is purely informational.
 */
export function WelcomeGiftOverlay() {
  const { ready, session, available } = useSession();
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  if (!available || !ready || !session) return null;

  const userId = session.user.id;
  const createdAt = new Date(session.user.created_at).getTime();
  const lastSignInAt = new Date(session.user.last_sign_in_at ?? session.user.created_at).getTime();
  const isNewAccount = lastSignInAt - createdAt < NEW_ACCOUNT_WINDOW_MS;

  if (!isNewAccount || dismissedId === userId || hasSeenWelcomeGift(userId)) return null;

  const dismiss = () => {
    setDismissedId(userId);
    try {
      localStorage.setItem(STORAGE_PREFIX + userId, "1");
    } catch {
      // no localStorage (e.g. private mode) — overlay just comes back next load
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/40 p-6">
      <div
        role="alertdialog"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900/85 p-6 text-zinc-100 shadow-2xl backdrop-blur-md"
      >
        <h2 className="mb-2 font-fredoka text-lg font-semibold">Great to see you, {displayName(session)}!</h2>
        <p className="mb-4 text-sm text-zinc-300">Here is your free welcome gift:</p>
        <ul className="mb-6 list-disc space-y-2 pl-5 text-sm text-zinc-300">
          <li>10 shurikens</li>
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
