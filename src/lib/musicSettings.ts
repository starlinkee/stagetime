"use client";
import { useEffect, useState } from "react";

/**
 * Music on/off preference (STU-71) — mirrors soundSettings.ts exactly (per-browser, localStorage,
 * defaults to on, read/write wrapped in try/catch for private windows). No background music
 * exists in this repo yet (chime.ts only synthesizes short SFX), so this toggle has no audible
 * effect today; it exists so the Settings overlay can offer sound and music as separate switches,
 * and whatever music gets added later just needs to check isMusicEnabled() before playing.
 */
const KEY = "musicEnabled";
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

export function isMusicEnabled(): boolean {
  return read();
}

export function setMusicEnabled(next: boolean) {
  cached = next;
  try {
    window.localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    // Private window / storage blocked — the in-memory `cached` value still works for this tab.
  }
  for (const l of listeners) l(next);
}

export function useMusicEnabled(): boolean {
  const [enabled, setEnabled] = useState(read);
  useEffect(() => {
    listeners.push(setEnabled);
    return () => {
      listeners = listeners.filter((l) => l !== setEnabled);
    };
  }, []);
  return enabled;
}
