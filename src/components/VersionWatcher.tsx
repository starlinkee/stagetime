"use client";
import { useEffect, useState } from "react";

const CHECK_EVERY = 60 * 1000;
const BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

/** Gdy serwer działa już na nowszej wersji niż ta karta, pokazuje baner z odświeżeniem. */
export function VersionWatcher() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (BUILD === "dev") return;
    const check = async () => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        const { build } = (await res.json()) as { build?: string };
        if (build && build !== BUILD) setStale(true);
      } catch {
        // brak sieci — sprawdzimy przy następnej okazji
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const timer = setInterval(check, CHECK_EVERY);
    document.addEventListener("visibilitychange", onVisible);
    void check();
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Stara wersja nie może działać dalej: RoomStage ignoruje klawisze, gdy ustawiony jest ten znacznik.
  useEffect(() => {
    if (!stale) return;
    document.documentElement.dataset.stale = "1";
    return () => {
      delete document.documentElement.dataset.stale;
    };
  }, [stale]);

  if (!stale) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm">
      <div
        role="alertdialog"
        aria-modal="true"
        className="flex flex-col items-center gap-4 rounded-2xl bg-zinc-900 px-8 py-6 text-center text-sm text-zinc-100 shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
      >
        <p>A new version is available. Refresh to keep playing.</p>
        <button
          type="button"
          autoFocus
          onClick={() => location.reload()}
          className="rounded-full bg-zinc-100 px-4 py-1.5 font-medium text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
