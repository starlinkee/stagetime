"use client";
import { GLOBAL_PRESENCE, usePresence } from "@/lib/usePresence";

/** Ilu ludzi jest łącznie na stronie (obecność w pokoju jest przy czacie pokoju). */
export function PresenceBar() {
  const global = usePresence(GLOBAL_PRESENCE);
  const total = global.signedIn + global.signedOut;

  return (
    <footer className="px-6 py-4 text-center text-sm text-zinc-500">
      <span>
        {total} {total === 1 ? "user" : "users"} online now
      </span>
    </footer>
  );
}
