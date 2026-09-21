"use client";
import { useEffect, useRef, useState } from "react";
import { MAX_BODY, useChat, type ChatMessage } from "@/lib/useChat";
import { signInWith } from "@/lib/useSession";

export function RoomChat({ roomSlug }: { roomSlug: string }) {
  const { messages, error, available, canSend, send } = useChat(roomSlug);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Nowa wiadomość → przewijamy na dół.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (!available) {
    return (
      <p className="w-full max-w-2xl text-sm text-zinc-500">
        Chat requires Supabase to be configured (local mode: timer only).
      </p>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft("");
    try {
      await send(text);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="flex w-full max-w-2xl flex-col gap-3">
      <h2 className="text-sm font-medium text-zinc-400">Room chat</h2>

      <div
        ref={listRef}
        className="flex h-64 flex-col gap-2 overflow-y-auto rounded-xl border border-zinc-800 p-4"
      >
        {messages.length === 0 ? (
          <p className="m-auto text-sm text-zinc-600">No messages yet.</p>
        ) : (
          messages.map((m) => <Message key={m.id} message={m} />)
        )}
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      {canSend ? (
        <form onSubmit={onSubmit} className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_BODY}
            placeholder="Write a message…"
            className="flex-1 rounded-lg border border-zinc-800 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-zinc-600 focus:border-zinc-600"
          />
          <button
            type="submit"
            disabled={sending || draft.trim() === ""}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm hover:border-zinc-500 disabled:opacity-40"
          >
            Send
          </button>
        </form>
      ) : (
        <p className="text-sm text-zinc-500">
          <button onClick={() => void signInWith("discord")} className="underline hover:text-zinc-300">
            Sign in
          </button>{" "}
          to chat.
        </p>
      )}
    </section>
  );
}

function Message({ message }: { message: ChatMessage }) {
  const time = new Date(message.created_at).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <p className="text-sm break-words">
      <span className="text-zinc-600 tabular-nums">{time} </span>
      <span className="font-medium text-sky-300">{message.author}: </span>
      <span className="text-zinc-200">{message.body}</span>
    </p>
  );
}
