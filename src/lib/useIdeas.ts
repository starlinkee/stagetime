"use client";
import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "./supabase";

/** Body length limit — matches the CHECK constraint in the database (supabase/migrations/0007). */
export const MAX_IDEA_BODY = 1000;
/** Signature length limit — matches the CHECK constraint in the database. */
export const MAX_IDEA_AUTHOR = 80;

export type IdeasState = {
  /** false in local mode (no Supabase env vars) — the form has nowhere to save to then. */
  available: boolean;
  /** Saves an idea (body + signature); the database adds date/time. Returns false on error. */
  send: (body: string, author: string) => Promise<boolean>;
};

/** Anonymous idea box (`ideas` table) — write-only, no read access from the client. */
export function useIdeas(): IdeasState {
  const sb = getSupabase();

  const send = useCallback(
    async (body: string, author: string) => {
      const text = body.trim().slice(0, MAX_IDEA_BODY);
      const signature = author.trim().slice(0, MAX_IDEA_AUTHOR);
      if (!sb || !text || !signature) return false;
      const { error } = await sb.from("ideas").insert({ body: text, author: signature });
      if (error) {
        console.warn("ideas insert (see supabase/migrations/0007, 0009)", error);
        return false;
      }
      return true;
    },
    [sb],
  );

  return { available: sb !== null, send };
}

export type Idea = { id: string; body: string; author: string; created_at: string };

export type AllIdeasState = {
  /** null while loading. */
  ideas: Idea[] | null;
  /** Set when the read fails — e.g. no read access (see supabase/migrations/0008). */
  error: string | null;
  /** false in local mode (no Supabase env vars). */
  available: boolean;
};

/** All ideas, newest first — only readable by the account the `ideas_select_admin` policy allows. */
export function useAllIdeas(): AllIdeasState {
  const sb = getSupabase();
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sb) return;
    let cancelled = false;
    sb.from("ideas")
      .select("id, body, author, created_at")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setError("Failed to load ideas — you may not have read access (see supabase/migrations/0008).");
          return;
        }
        setIdeas(data as Idea[]);
      });
    return () => {
      cancelled = true;
    };
  }, [sb]);

  return { ideas, error, available: sb !== null };
}
