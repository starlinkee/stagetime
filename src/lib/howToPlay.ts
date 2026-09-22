import { useSyncExternalStore } from "react";

/**
 * RoomStage is mounted on every page that has a playable stage (lobby, rooms, shop, timer) and
 * knows the current room's controls text; the header (layout.tsx) renders the "How to play"
 * button next to "Report idea" but lives outside RoomStage's tree, so we hand the text off
 * through this tiny external store instead of prop-drilling through the whole page tree.
 */
let text: string | null = null;
const listeners = new Set<() => void>();

export function setHowToPlay(next: string | null) {
  text = next;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useHowToPlay() {
  return useSyncExternalStore(subscribe, () => text, () => null);
}
