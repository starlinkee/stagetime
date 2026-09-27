"use client";
import { useRef, useState } from "react";
import { HEADER_BUTTON_CLASS } from "@/lib/headerButtonStyles";
import { useHeaderPanel } from "@/lib/headerPanel";
import { roomLabel } from "@/lib/rooms";
import { useParty } from "@/lib/useParty";
import { usePartyLocations } from "@/lib/usePartyLocations";
import { useSession } from "@/lib/useSession";

/**
 * STU-74: header button + dropdown panel for the party system (see useParty.ts,
 * supabase/migrations/0059_parties.sql). Same header-panel pattern as AboutGameButton.tsx. Hidden
 * for signed-out visitors — parties require an account, same gate as Shop's requiresAuth zones.
 */
export function PartyButton() {
  const { session } = useSession();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, toggle, close] = useHeaderPanel("party", containerRef);
  const { party, incomingInvites, outgoingInvites, error, createParty, inviteByNickname, acceptInvite, declineInvite, cancelInvite, leaveParty } =
    useParty();
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);

  const memberIds = party?.members.map((m) => m.userId) ?? [];
  const locations = usePartyLocations(open ? memberIds : []);

  if (!session?.user) return null;

  const submitInvite = async () => {
    if (busy || !nickname.trim()) return;
    setBusy(true);
    const result = await inviteByNickname(nickname);
    setBusy(false);
    if (result.ok) setNickname("");
  };

  return (
    <div className="relative" ref={containerRef}>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-zinc-700 bg-zinc-900/95 p-4 text-sm text-zinc-100 shadow-xl backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold">Party</span>
            <button type="button" onClick={close} className="text-xs text-zinc-400 hover:text-zinc-200">
              Close
            </button>
          </div>

          {party ? (
            <>
              <div className="mb-3 flex flex-col gap-1.5">
                {party.members.map((m) => {
                  const loc = locations[m.userId];
                  return (
                    <div key={m.userId} className="flex items-center justify-between rounded-lg border border-zinc-700 px-2.5 py-1.5">
                      <span className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${loc ? "bg-emerald-400" : "bg-zinc-600"}`} />
                        <span className="font-medium text-zinc-100">{m.nickname}</span>
                        {m.isLeader && <span className="text-[10px] text-amber-400">leader</span>}
                      </span>
                      <span className="text-xs text-zinc-400">{loc ? roomLabel(loc) : "Offline"}</span>
                    </div>
                  );
                })}
              </div>
              <div className="mb-3 flex gap-2">
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void submitInvite()}
                  placeholder="Invite by nickname"
                  disabled={busy}
                  className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => void submitInvite()}
                  disabled={busy || !nickname.trim()}
                  className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Invite
                </button>
              </div>
              {outgoingInvites.length > 0 && (
                <div className="mb-3 flex flex-col gap-1">
                  {outgoingInvites.map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between text-xs text-zinc-400">
                      <span>Invited {inv.inviteeNickname} — pending</span>
                      <button type="button" onClick={() => void cancelInvite(inv.id)} className="text-rose-400 hover:text-rose-300">
                        Cancel
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => void leaveParty()}
                className="w-full rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                Leave party
              </button>
            </>
          ) : (
            <>
              <p className="mb-3 text-zinc-400">Not in a party. Create one to invite others and see where they are.</p>
              <button
                type="button"
                onClick={() => void createParty()}
                className="mb-3 w-full rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
              >
                Create party
              </button>
            </>
          )}

          {incomingInvites.length > 0 && (
            <div className="mt-3 flex flex-col gap-2 border-t border-zinc-800 pt-3">
              <span className="text-xs font-semibold text-zinc-400">Invites</span>
              {incomingInvites.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between rounded-lg border border-zinc-700 px-2.5 py-1.5">
                  <span className="text-xs text-zinc-200">{inv.inviterNickname} invited you</span>
                  <span className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => void acceptInvite(inv.id)}
                      className="rounded-md bg-emerald-500 px-2 py-1 text-[11px] font-semibold text-zinc-950 hover:bg-emerald-400"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => void declineInvite(inv.id)}
                      className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
                    >
                      Decline
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}

          {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
        </div>
      )}
      <button type="button" onClick={toggle} className={HEADER_BUTTON_CLASS}>
        Party{party ? ` (${party.members.length})` : ""}
      </button>
    </div>
  );
}
