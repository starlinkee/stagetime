"use client";
import Link from "next/link";
import { useAllIdeas } from "@/lib/useIdeas";

/** All player ideas, newest first. Only readable by the `v_everything` account (see supabase/migrations/0008). */
export default function IdeasPage() {
  const { ideas, error, available } = useAllIdeas();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Ideas</h1>
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">
          ← Home
        </Link>
      </div>
      {!available && <p className="text-sm text-amber-400">Local mode — no Supabase configured.</p>}
      {error && <p className="text-sm text-rose-400">{error}</p>}
      {available && !error && ideas === null && <p className="text-sm text-zinc-500">Loading…</p>}
      {ideas && ideas.length === 0 && <p className="text-sm text-zinc-500">No ideas yet.</p>}
      <ul className="flex flex-col gap-3">
        {ideas?.map((i) => (
          <li key={i.id} className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-4">
            <p className="whitespace-pre-wrap break-words text-sm text-zinc-100">{i.body}</p>
            <p className="mt-2 text-xs text-zinc-500">
              {i.author} · {new Date(i.created_at).toLocaleString()}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
