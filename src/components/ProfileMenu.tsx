"use client";
import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { PixelPerson } from "@/components/PixelPerson";
import { COLOR_CHOICES, useMyProfile } from "@/lib/useProfile";
import { displayName, signOut } from "@/lib/useSession";

/** Nazwa w nagłówku: klik otwiera panel ze zmianą nicku i wylogowaniem. */
export function ProfileMenu({ session }: { session: Session }) {
  const { ready, nickname, color, error, save } = useMyProfile();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const shown = nickname ?? displayName(session);

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
        className="rounded-lg bg-[#5865F2] px-3 py-1.5 text-white hover:bg-[#4752c4]"
      >
        {shown}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Profile settings"
          className="absolute right-0 z-10 mt-2 w-72 rounded-xl border border-zinc-800 bg-zinc-950 p-4 shadow-xl"
        >
          {ready ? (
            <ProfileForm nickname={shown} currentColor={color} error={error} save={save} />
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
  currentColor,
  error,
  save,
}: {
  nickname: string;
  currentColor: string;
  error: string | null;
  save: (color: string) => Promise<boolean>;
}) {
  const [color, setColor] = useState(currentColor);

  // Zmiana koloru zapisuje się od razu; przy błędzie wracamy do zapisanego koloru.
  async function pick(c: string) {
    setColor(c);
    if (!(await save(c))) setColor(currentColor);
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-zinc-400">Nickname</span>
      <span className="text-zinc-200">{nickname}</span>
      <span className="text-xs text-zinc-600">Taken from your Discord account at sign-up.</span>
      <span className="mt-1 text-zinc-400">Character color</span>
      <div className="flex items-end gap-3">
        <PixelPerson color={color} size={4} />
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Character color">
          {COLOR_CHOICES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={c === color}
              aria-label={c}
              onClick={() => pick(c)}
              style={{ backgroundColor: c }}
              className={`h-6 w-6 rounded-md border-2 ${c === color ? "border-white" : "border-transparent"}`}
            />
          ))}
        </div>
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}
