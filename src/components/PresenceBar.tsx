"use client";
import { GLOBAL_PRESENCE, usePresence } from "@/lib/usePresence";

/** Ilu ludzi jest łącznie na stronie — wyświetlane w górnym pasku (patrz layout.tsx). */
export function PresenceBar() {
  const global = usePresence(GLOBAL_PRESENCE);
  const total = global.signedIn + global.signedOut;

  return (
    <span className="text-sm text-zinc-400">
      {total} {total === 1 ? "user" : "users"} online now
    </span>
  );
}
