"use client";
import { useEffect, useRef, useState, type RefObject } from "react";

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

/**
 * Reactive open state + toggle/close for a single header panel identified by `id`.
 * `containerRef` (optional) should be attached to the element wrapping both the toggle button
 * and the panel's own dropdown content — for panels rendered in place (About, Admin) this makes
 * a click anywhere else on the page close the panel. Panels rendered through a portal (Help,
 * Idea) have a full-screen backdrop element instead and don't need this — clicking their
 * backdrop already calls `close` directly, and a containerRef wouldn't reach portaled content
 * anyway (it lives outside the container's DOM subtree once portaled).
 */
export function useHeaderPanel(
  id: string,
  containerRef?: RefObject<HTMLElement | null>
): [boolean, () => void, () => void] {
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
  const closeRef = useRef(close);
  closeRef.current = close;

  // Escape closes whichever header panel is open — consistent with every other overlay in the
  // app (chat, stats, ProfileMenu), so users always have a keyboard way out even if a panel's
  // own Close button ends up out of view (e.g. positioned above the visible viewport).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Clicking anywhere outside the panel (and its toggle button) closes it — same expectation
  // as every other overlay here, so a stray click elsewhere on the page never leaves a panel
  // stuck open behind whatever the user meant to interact with.
  useEffect(() => {
    if (!open || !containerRef) return;
    const onPointerDown = (e: MouseEvent) => {
      const el = containerRef.current;
      if (el && !el.contains(e.target as Node)) closeRef.current();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, containerRef]);

  return [open, toggle, close];
}
