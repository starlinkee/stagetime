"use client";
import { useEffect, useState } from "react";
import { getSupabase } from "./supabase";
import { useSession } from "./useSession";

/**
 * STU-83: is the signed-in user listed in public.admins (see
 * supabase/migrations/0054_admins_table.sql)? Its own tiny hook instead of a field on
 * useMyProfile — admin status only ever gates the AdminPanel button/overrides, so it doesn't need
 * to ride along with that hook's much larger, far more frequently updated profile shape. The RLS
 * policy on `admins` only ever lets this query see the caller's own row, never the full roster.
 */
export function useIsAdmin(): boolean {
  const sb = getSupabase();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const [state, setState] = useState<{ userId: string | null; isAdmin: boolean }>({ userId: null, isAdmin: false });

  // Reset during render (not in the effect below) when the signed-in user changes — React's own
  // "adjusting state when a prop changes" pattern — so a sign-out/sign-in never briefly reads the
  // previous account's admin status.
  if (state.userId !== userId) {
    setState({ userId, isAdmin: false });
  }

  useEffect(() => {
    if (!sb || !userId) return;
    let cancelled = false;
    sb.from("admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setState((prev) => (prev.userId === userId ? { userId, isAdmin: Boolean(data) } : prev));
      });
    return () => {
      cancelled = true;
    };
  }, [sb, userId]);

  return state.userId === userId ? state.isAdmin : false;
}
