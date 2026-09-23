"use client";
import { ProfileMenu } from "@/components/ProfileMenu";
import { signInWith, useSession } from "@/lib/useSession";

export function AuthButton() {
  const { ready, session, available } = useSession();

  if (!available || !ready) return null;

  if (!session) {
    return (
      <button
        onClick={() => signInWith("discord")}
        className="discord-pulse rounded-lg bg-[#5865F2] px-3 py-1.5 text-sm text-white hover:bg-[#4752c4]"
      >
        Sign in with Discord
      </button>
    );
  }

  return <ProfileMenu session={session} />;
}
