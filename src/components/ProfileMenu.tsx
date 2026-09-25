"use client";
import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { CoinBadge, CoinIcon } from "@/components/CoinBadge";
import { LevelBadge } from "@/components/LevelBadge";
import { useMyProfile } from "@/lib/useProfile";
import { displayName, signOut } from "@/lib/useSession";
import { levelFromXp, xpLevelTableText } from "@/lib/xp";

/**
 * Brief "+N" pop shown next to the header's coin/XP badges (STU-16) whenever `value` ticks up —
 * `coins`/`xp` from useMyProfile already update live via Supabase Realtime (see that hook's doc
 * comment), so this just watches for an increase instead of needing its own event wiring. Mirrors
 * the in-world RewardPopup bubble (RoomStage.tsx) but anchored to the header instead of a player
 * sprite. A decrease (spending coins in the Shop) is ignored — nothing to celebrate there.
 */
function useDeltaPop(value: number) {
  const prevRef = useRef(value);
  const [pop, setPop] = useState<{ delta: number; id: number } | null>(null);
  const idRef = useRef(0);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = value;
    const delta = value - prev;
    if (delta <= 0) return;
    idRef.current += 1;
    setPop({ delta, id: idRef.current });
    const timer = setTimeout(() => setPop((p) => (p?.id === idRef.current ? null : p)), 1400);
    return () => clearTimeout(timer);
  }, [value]);
  return pop;
}

function DeltaPop({ pop, decimals, className = "" }: { pop: { delta: number; id: number } | null; decimals: 0 | 1; className?: string }) {
  if (!pop) return null;
  return (
    <span
      key={pop.id}
      className={`pp-reward pointer-events-none absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs font-bold text-emerald-400 ${className}`}
    >
      +{pop.delta.toFixed(decimals)}
    </span>
  );
}

/** Nazwa w nagłówku: klik otwiera panel ze zmianą nicku i wylogowaniem. */
export function ProfileMenu({ session }: { session: Session }) {
  const { ready, nickname, xp, ballsShot, fistSwings, kills, deaths, mobKills, coins, error } = useMyProfile();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const shown = nickname ?? displayName(session);
  const { intoLevel, forNextLevel } = levelFromXp(xp);
  const xpPop = useDeltaPop(ready ? xp : 0);
  const coinPop = useDeltaPop(ready ? coins : 0);

  // Klik poza panelem i Escape zamykają menu.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative text-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex items-center gap-1.5 rounded-lg bg-[#5865F2] px-3 py-1.5 text-white hover:bg-[#4752c4]"
      >
        {ready && (
          <span className="relative flex items-center gap-1">
            <LevelBadge xp={xp} />
            <DeltaPop pop={xpPop} decimals={1} />
          </span>
        )}
        {ready && (
          <span
            title={xpLevelTableText()}
            className="relative flex h-1.5 w-10 overflow-hidden rounded-full bg-zinc-700/60"
          >
            <span
              className="h-full rounded-full bg-amber-400 transition-[width]"
              style={{ width: `${Math.min(100, (intoLevel / forNextLevel) * 100)}%` }}
            />
          </span>
        )}
        {ready && (
          <span className="relative flex items-center">
            <CoinBadge coins={coins} />
            <DeltaPop pop={coinPop} decimals={1} />
          </span>
        )}
        {shown}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Profile settings"
          className="absolute right-0 z-10 mt-2 w-72 rounded-xl border border-zinc-800 bg-zinc-950 p-4 shadow-xl"
        >
          {ready ? (
            <ProfileForm
              nickname={shown}
              xp={xp}
              ballsShot={ballsShot}
              fistSwings={fistSwings}
              kills={kills}
              deaths={deaths}
              mobKills={mobKills}
              coins={coins}
              error={error}
            />
          ) : (
            <p className="text-zinc-500">Loading…</p>
          )}
          <button
            onClick={signOut}
            className="mt-4 w-full border-t border-zinc-800 pt-3 text-left text-zinc-500 hover:text-zinc-300"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function ProfileForm({
  nickname,
  xp,
  ballsShot,
  fistSwings,
  kills,
  deaths,
  mobKills,
  coins,
  error,
}: {
  nickname: string;
  xp: number;
  ballsShot: number;
  fistSwings: number;
  kills: number;
  deaths: number;
  mobKills: number;
  coins: number;
  error: string | null;
}) {
  const { level, intoLevel, forNextLevel } = levelFromXp(xp);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-zinc-400">Nickname</span>
      <span className="flex items-center gap-1.5 text-zinc-200">{nickname}</span>
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-amber-300">
          Lv.{level}
        </span>
        <div
          title={xpLevelTableText()}
          className="relative h-3.5 w-full overflow-hidden rounded-full bg-zinc-800"
        >
          <div
            className="h-full rounded-full bg-amber-500 transition-[width]"
            style={{ width: `${Math.min(100, (intoLevel / forNextLevel) * 100)}%` }}
          />
          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-medium text-zinc-100">
            {intoLevel.toFixed(1)}/{forNextLevel} XP
          </span>
        </div>
      </div>
      <span className="text-xs text-zinc-600">5 minutes in a study room = 1 XP · 1 minute = 1 copper coin.</span>
      <span className="mt-1 text-zinc-400">Stats</span>
      <div className="flex items-center justify-between rounded-lg bg-zinc-900 px-2.5 py-1.5">
        <span className="text-zinc-400">Balls</span>
        <span className="font-semibold text-zinc-200">{ballsShot}</span>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-zinc-900 px-2.5 py-1.5">
        <span className="text-zinc-400">Fist swings</span>
        <span className="font-semibold text-zinc-200">{fistSwings}</span>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-zinc-900 px-2.5 py-1.5">
        <span className="text-zinc-400">Kills</span>
        <span className="font-semibold text-zinc-200">{kills}</span>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-zinc-900 px-2.5 py-1.5">
        <span className="text-zinc-400">Deaths</span>
        <span className="font-semibold text-zinc-200">{deaths}</span>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-zinc-900 px-2.5 py-1.5">
        <span className="text-zinc-400">Mob kills</span>
        <span className="font-semibold text-zinc-200">{mobKills}</span>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-zinc-900 px-2.5 py-1.5">
        <span className="text-zinc-400">Copper coins</span>
        <span className="flex items-center gap-1 font-semibold text-orange-300">
          <CoinIcon className="h-3 w-3" />
          {coins.toFixed(1)}
        </span>
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}
