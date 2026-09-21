"use client";
import { useEffect, useState } from "react";

const CHECK_EVERY = 5 * 60 * 1000;
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

  if (!stale) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit items-center gap-3 rounded-full bg-zinc-900 px-4 py-2 text-sm text-zinc-100 shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
    >
      A new version is available.
      <button
        type="button"
        onClick={() => location.reload()}
        className="rounded-full bg-zinc-100 px-3 py-1 font-medium text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
      >
        Refresh
      </button>
    </div>
  );
}
