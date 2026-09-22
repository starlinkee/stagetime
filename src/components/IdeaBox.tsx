"use client";
import Link from "next/link";
import { useState } from "react";
import { MAX_IDEA_AUTHOR, MAX_IDEA_BODY, useIdeas } from "@/lib/useIdeas";
import { useMyProfile } from "@/lib/useProfile";
import { useSession } from "@/lib/useSession";

/** Only this account sees the link to the ideas list (see supabase/migrations/0008). */
const ADMIN_NICK = "v_everything";

/** Header link to /ideas, visible only to ADMIN_NICK. */
export function AllIdeasLink() {
  const { session } = useSession();
  const profile = useMyProfile();
  const nick = session ? profile.nickname : null;

  if (nick !== ADMIN_NICK) return null;

  return (
    <Link
      href="/ideas"
      className="rounded-full bg-zinc-800/90 px-3 py-2 text-xs font-medium text-zinc-200 shadow-lg ring-1 ring-zinc-600 hover:bg-zinc-700"
    >
      📋 All ideas
    </Link>
  );
}

/**
 * Header button + idea form: body + signature, the database adds date/time.
 * Visible to everyone (even without an account) — this is an anonymous player idea box.
 * Signed-in players get their signature filled in automatically from their Discord nickname.
 */
export function IdeaBox() {
  const { session } = useSession();
  const profile = useMyProfile();
  const nick = session ? profile.nickname : null;

  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [author, setAuthor] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { available, send } = useIdeas();
  // Signed-in players sign with their Discord nickname; guests type their own.
  const signature = nick ?? author;

  const close = () => {
    setOpen(false);
    setSent(false);
    setError(null);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    setError(null);
    const ok = await send(body, signature);
    setSending(false);
    if (ok) {
      setBody("");
      setAuthor("");
      setSent(true);
    } else {
      setError("Failed to save the idea — please try again.");
    }
  };

  return (
    <div className="relative">
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-zinc-700 bg-zinc-900/95 p-4 text-sm text-zinc-100 shadow-xl backdrop-blur">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-semibold">Ideas</span>
              <button type="button" onClick={close} className="text-xs text-zinc-400 hover:text-zinc-200">
                Close
              </button>
            </div>
            {sent ? (
              <div className="flex flex-col gap-3">
                <p className="text-zinc-300">Thanks! Your idea has been sent.</p>
                <button
                  type="button"
                  onClick={() => setSent(false)}
                  className="self-start rounded-full bg-zinc-700 px-3 py-1.5 text-xs font-medium hover:bg-zinc-600"
                >
                  Send another
                </button>
              </div>
            ) : (
              <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-400">What&apos;s your idea?</span>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    maxLength={MAX_IDEA_BODY}
                    rows={4}
                    required
                    placeholder="Write what you'd like to change or add…"
                    className="resize-none rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-400"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-400">Signature</span>
                  {nick ? (
                    <span className="rounded border border-zinc-700 bg-zinc-800/60 px-2 py-1.5 text-zinc-300">{nick}</span>
                  ) : (
                    <input
                      type="text"
                      value={author}
                      onChange={(e) => setAuthor(e.target.value)}
                      maxLength={MAX_IDEA_AUTHOR}
                      required
                      placeholder="Your nickname"
                      className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-400"
                    />
                  )}
                </label>
                {error && <p className="text-xs text-rose-400">{error}</p>}
                {!available && <p className="text-xs text-amber-400">Local mode — the form has nowhere to save to.</p>}
                <button
                  type="submit"
                  disabled={sending || !available}
                  className="rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sending ? "Sending…" : "Send"}
                </button>
              </form>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded-full bg-zinc-800/90 px-3 py-2 text-xs font-medium text-zinc-200 shadow-lg ring-1 ring-zinc-600 hover:bg-zinc-700"
        >
          💡 Report idea
        </button>
    </div>
  );
}
