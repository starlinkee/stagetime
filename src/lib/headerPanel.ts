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
  return [open, toggle, close];
}
