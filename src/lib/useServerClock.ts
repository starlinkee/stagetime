"use client";
import { useEffect, useState } from "react";

/** Zwraca czas serwera w ms (skorygowany o offset zegara klienta) albo null przed synchronizacją. */
export function useServerNow(tickMs = 250): number | null {
  const [offset, setOffset] = useState<number | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function sync() {
      // kilka próbek, wybieramy tę z najmniejszym RTT
      let best: { rtt: number; offset: number } | null = null;
      for (let i = 0; i < 4; i++) {
        const t0 = Date.now();
        const res = await fetch("/api/time", { cache: "no-store" });
        const { now } = (await res.json()) as { now: number };
        const t1 = Date.now();
        const rtt = t1 - t0;
        if (!best || rtt < best.rtt) best = { rtt, offset: now + rtt / 2 - t1 };
      }
      if (!cancelled && best) setOffset(best.offset);
    }

    sync().catch(() => !cancelled && setOffset(0));
    const resync = setInterval(() => sync().catch(() => {}), 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(resync);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);

  // eslint-disable-next-line react-hooks/purity -- czas jest celowo odczytywany przy każdym renderze (tick)
  return offset === null ? null : Date.now() + offset;
}
