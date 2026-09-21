import type { NextConfig } from "next";

// Jeden identyfikator wdrożenia: hash commita z hosta albo znacznik czasu builda.
// W trybie dev pomijamy, żeby nie wymuszać przeładowań przy każdym restarcie.
// Vercel wymaga deploymentId o długości max 32 znaków, więc skracamy pełny hash.
const buildId = (
  process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_SHA ?? String(Date.now())
).slice(0, 12);
const isDev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  // Ochrona przed niezgodnością wersji: klient ze starym ID przeładowuje się przy nawigacji.
  deploymentId: isDev ? undefined : buildId,
  // Wersja wpisana w kod klienta i serwera — VersionWatcher porównuje ją z /api/version.
  env: { NEXT_PUBLIC_BUILD_ID: isDev ? "dev" : buildId },
};

export default nextConfig;
