"use client";
import { useEffect, useState } from "react";

/**
 * Coordinates the header's dropdown buttons (Admin, How to play, About, Idea) so opening one
 * closes any other that's open — plain in-memory module state, not persisted: this is transient
 * UI state, not a preference (contrast soundSettings.ts, which does persist to localStorage).
 */
type Listener = (openId: string | null) => void;
let listeners: Listener[] = [];
let current: string | null = null;

function setCurrent(next: string | null) {
  current = next;
  for (const l of listeners) l(current);
}

/** Reactive open state + toggle/close for a single header panel identified by `id`. */
export function useHeaderPanel(id: string): [boolean, () => void, () => void] {
  const [open, setOpen] = useState(() => current === id);
  useEffect(() => {
    const listener: Listener = (openId) => setOpen(openId === id);
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  }, [id]);

  const toggle = () => setCurrent(current === id ? null : id);
  const close = () => {
    if (current === id) setCurrent(null);
  };

  // Escape closes whichever header panel is open — consistent with every other overlay in the
  // app (chat, stats, ProfileMenu), so users always have a keyboard way out even if a panel's
  // own Close button ends up out of view (e.g. positioned above the visible viewport).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return [open, toggle, close];
}
