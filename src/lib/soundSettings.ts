"use client";
import { useEffect, useState } from "react";

/**
 * Sound on/off toggle (STU-3) — a per-browser preference, not a profile field: nothing here has
 * any gameplay effect, so it doesn't need to sync across devices or survive in Postgres, just in
 * this browser (localStorage). Defaults to on (matches the chime's pre-existing always-on
 * behavior, see chime.ts) when nothing's been saved yet or storage isn't available (private
 * window, etc.) — read/write are both wrapped in try/catch for that reason.
 *
 * A `storage` event only fires in *other* tabs, never the one that called setSoundEnabled, so a
 * same-tab toggle button needs its own notification path — the small listener list below.
 */
const KEY = "soundEnabled";
type Listener = (v: boolean) => void;
let listeners: Listener[] = [];
let cached: boolean | null = null;

function read(): boolean {
  if (cached !== null) return cached;
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(KEY);
    cached = raw === null ? true : raw === "1";
  } catch {
    cached = true;
  }
  return cached;
}

/** Non-reactive read for call sites that just need "should I play this sound right now" (chime.ts). */
export function isSoundEnabled(): boolean {
  return read();
}

export function setSoundEnabled(next: boolean) {
  cached = next;
  try {
    window.localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    // Private window / storage blocked — the in-memory `cached` value still works for this tab.
  }
  for (const l of listeners) l(next);
}

/** Reactive read for the toggle button itself. */
export function useSoundEnabled(): boolean {
  const [enabled, setEnabled] = useState(read);
  useEffect(() => {
    listeners.push(setEnabled);
    return () => {
      listeners = listeners.filter((l) => l !== setEnabled);
    };
  }, []);
  return enabled;
}
