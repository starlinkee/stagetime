"use client";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { getSupabase } from "./supabase";

export type SessionState = {
  /** false do czasu pierwszego odczytu sesji (unikamy mignięcia „Zaloguj”). */
  ready: boolean;
  session: Session | null;
  /** false, gdy brak konfiguracji Supabase (tryb lokalny) — logowanie niedostępne. */
  available: boolean;
};

export function useSession(): SessionState {
  const sb = getSupabase();
  const [state, setState] = useState<{ ready: boolean; session: Session | null }>({
    ready: false,
    session: null,
  });

  useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setState({ ready: true, session: data.session }));
    const { data } = sb.auth.onAuthStateChange((_event, session) =>
      setState({ ready: true, session }),
    );
    return () => data.subscription.unsubscribe();
  }, [sb]);

  return { ...state, available: sb !== null };
}

export type OAuthProvider = "discord";

export async function signInWith(provider: OAuthProvider) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.href },
  });
}

export async function signOut() {
  await getSupabase()?.auth.signOut();
}

/** Nazwa użytkownika do pokazania w UI (Discord → nick, w ostateczności e-mail). */
export function displayName(session: Session): string {
  const meta = session.user.user_metadata;
  return (
    meta.full_name ??
    meta.name ??
    meta.preferred_username ??
    session.user.email ??
    "User"
  );
}
