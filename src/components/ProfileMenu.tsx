"use client";
import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { PixelPerson } from "@/components/PixelPerson";
import { COLOR_CHOICES, MAX_NICKNAME, useMyProfile, validateNickname } from "@/lib/useProfile";
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
        className="rounded-lg border border-zinc-800 px-3 py-1.5 text-zinc-300 hover:border-zinc-600"
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
            <NicknameForm current={shown} currentColor={color} error={error} save={save} />
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

function NicknameForm({
  current,
  currentColor,
  error,
  save,
}: {
  current: string;
  currentColor: string;
  error: string | null;
  save: (nickname: string, color: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(current);
  const [color, setColor] = useState(currentColor);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const invalid = validateNickname(draft);
  const unchanged = draft.trim() === current && color === currentColor;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (invalid || unchanged || saving) return;
    setSaving(true);
    setSaved(false);
    try {
      setSaved(await save(draft, color));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <label htmlFor="nickname" className="text-zinc-400">
        Nickname
      </label>
      <input
        id="nickname"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setSaved(false);
        }}
        maxLength={MAX_NICKNAME}
        autoFocus
        className="rounded-lg border border-zinc-800 bg-transparent px-3 py-2 outline-none focus:border-zinc-600"
      />
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
              onClick={() => {
                setColor(c);
                setSaved(false);
              }}
              style={{ backgroundColor: c }}
              className={`h-6 w-6 rounded-md border-2 ${c === color ? "border-white" : "border-transparent"}`}
            />
          ))}
        </div>
      </div>
      <button
        type="submit"
        disabled={saving || unchanged || invalid !== null}
        className="rounded-lg border border-zinc-700 px-3 py-2 hover:border-zinc-500 disabled:opacity-40"
      >
        {saving ? "Saving…" : "Save"}
      </button>
      <p className="text-xs text-zinc-600">
        Your nickname also changes in all your earlier chat messages.
      </p>
      {(error ?? (draft !== current ? invalid : null)) && (
        <p className="text-xs text-rose-400">{error ?? invalid}</p>
      )}
      {saved && !error && <p className="text-xs text-emerald-400">Saved.</p>}
    </form>
  );
}
