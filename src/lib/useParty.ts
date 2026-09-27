"use client";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { getSupabase } from "./supabase";
import { useSession } from "./useSession";

export type PartyMember = { userId: string; nickname: string; isLeader: boolean };
export type IncomingInvite = { id: string; partyId: string; inviterId: string; inviterNickname: string; createdAt: string };
export type OutgoingInvite = { id: string; inviteeId: string; inviteeNickname: string; createdAt: string };

export type PartyState = {
  loaded: boolean;
  party: { id: string; leaderId: string; members: PartyMember[] } | null;
  incomingInvites: IncomingInvite[];
  outgoingInvites: OutgoingInvite[];
  error: string | null;
  createParty: () => Promise<{ ok: boolean; error?: string }>;
  inviteByNickname: (nickname: string) => Promise<{ ok: boolean; error?: string }>;
  acceptInvite: (id: string) => Promise<{ ok: boolean; error?: string }>;
  declineInvite: (id: string) => Promise<{ ok: boolean; error?: string }>;
  cancelInvite: (id: string) => Promise<{ ok: boolean; error?: string }>;
  leaveParty: () => Promise<{ ok: boolean; error?: string }>;
};

type PartyRow = { id: string; leader_id: string };
type MemberRow = { party_id: string; user_id: string };
type InviteRow = { id: string; party_id: string; inviter_id: string; invitee_id: string; status: string; created_at: string };
type ProfileRow = { id: string; nickname: string };

/**
 * STU-74: current user's party, its members, and pending invites (see
 * supabase/migrations/0059_parties.sql). Same "fetch + two realtime subscriptions" shape as
 * useFriends.ts, generalized to a third table (party_members) and a dynamic third subscription on
 * the current party's own id — needed because a fellow member joining/leaving via someone else's
 * action (accepting a different invite, leaving) doesn't touch a row where user_id = me, so a
 * subscription filtered only on my own user id would miss it.
 *
 * party_members/party_invites carry no nickname (only auth.users ids, which client code can't
 * join against directly) — nicknames are resolved with a second query against public.profiles
 * (publicly readable, see 0002_profiles.sql) each time the party/invites are (re)loaded.
 */
export function useParty(): PartyState {
  const sb = getSupabase();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const instanceId = useId();

  const [party, setParty] = useState<PartyState["party"]>(null);
  const [incomingInvites, setIncomingInvites] = useState<IncomingInvite[]>([]);
  const [outgoingInvites, setOutgoingInvites] = useState<OutgoingInvite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!sb || !userId) return;
    const { data: myRow } = await sb.from("party_members").select("party_id").eq("user_id", userId).maybeSingle<MemberRow>();
    if (myRow) {
      const [{ data: partyRow }, { data: memberRows }] = await Promise.all([
        sb.from("parties").select("id,leader_id").eq("id", myRow.party_id).maybeSingle<PartyRow>(),
        sb.from("party_members").select("party_id,user_id").eq("party_id", myRow.party_id).returns<MemberRow[]>(),
      ]);
      const ids = (memberRows ?? []).map((m) => m.user_id);
      const { data: profiles } = ids.length
        ? await sb.from("profiles").select("id,nickname").in("id", ids).returns<ProfileRow[]>()
        : { data: [] as ProfileRow[] };
      const nickById = new Map((profiles ?? []).map((p) => [p.id, p.nickname]));
      if (partyRow) {
        setParty({
          id: partyRow.id,
          leaderId: partyRow.leader_id,
          members: (memberRows ?? []).map((m) => ({
            userId: m.user_id,
            nickname: nickById.get(m.user_id) ?? "?",
            isLeader: m.user_id === partyRow.leader_id,
          })),
        });
      } else {
        setParty(null);
      }
    } else {
      setParty(null);
    }

    const [{ data: incomingRows }, { data: outgoingRows }] = await Promise.all([
      sb.from("party_invites").select("*").eq("invitee_id", userId).eq("status", "pending").returns<InviteRow[]>(),
      sb.from("party_invites").select("*").eq("inviter_id", userId).eq("status", "pending").returns<InviteRow[]>(),
    ]);
    const otherIds = new Set<string>();
    for (const r of incomingRows ?? []) otherIds.add(r.inviter_id);
    for (const r of outgoingRows ?? []) otherIds.add(r.invitee_id);
    const { data: otherProfiles } = otherIds.size
      ? await sb.from("profiles").select("id,nickname").in("id", [...otherIds]).returns<ProfileRow[]>()
      : { data: [] as ProfileRow[] };
    const otherNickById = new Map((otherProfiles ?? []).map((p) => [p.id, p.nickname]));
    setIncomingInvites(
      (incomingRows ?? []).map((r) => ({
        id: r.id,
        partyId: r.party_id,
        inviterId: r.inviter_id,
        inviterNickname: otherNickById.get(r.inviter_id) ?? "?",
        createdAt: r.created_at,
      })),
    );
    setOutgoingInvites(
      (outgoingRows ?? []).map((r) => ({
        id: r.id,
        inviteeId: r.invitee_id,
        inviteeNickname: otherNickById.get(r.invitee_id) ?? "?",
        createdAt: r.created_at,
      })),
    );
    setLoaded(true);
  }, [sb, userId]);

  useEffect(() => {
    setLoaded(false);
    if (!sb || !userId) {
      setParty(null);
      setIncomingInvites([]);
      setOutgoingInvites([]);
      setLoaded(true);
      return;
    }
    void refresh();

    const channel = sb
      .channel(`party:${userId}:${instanceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "party_members", filter: `user_id=eq.${userId}` },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "party_invites", filter: `invitee_id=eq.${userId}` },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "party_invites", filter: `inviter_id=eq.${userId}` },
        () => void refresh(),
      )
      .subscribe();

    return () => {
      void sb.removeChannel(channel);
    };
  }, [sb, userId, instanceId, refresh]);

  // Second subscription, keyed on the current party's own id: catches a fellow member joining or
  // leaving via an action that never touches a row with user_id = me (e.g. someone else accepting
  // a different invite, or the leader kicking a third member).
  const partyId = party?.id ?? null;
  useEffect(() => {
    if (!sb || !partyId) return;
    const channel = sb
      .channel(`party-roster:${partyId}:${instanceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "party_members", filter: `party_id=eq.${partyId}` },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [sb, partyId, instanceId, refresh]);

  const createParty = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!sb) return { ok: false, error: "Not available." };
    const { error: err } = await sb.rpc("create_party");
    if (err) {
      setError(err.message);
      return { ok: false, error: err.message };
    }
    setError(null);
    await refresh();
    return { ok: true };
  }, [sb, refresh]);

  const inviteByNickname = useCallback(
    async (nickname: string): Promise<{ ok: boolean; error?: string }> => {
      if (!sb) return { ok: false, error: "Not available." };
      const trimmed = nickname.trim();
      if (!trimmed) return { ok: false, error: "Enter a nickname." };
      const { data: found, error: lookupErr } = await sb
        .from("profiles")
        .select("id")
        .ilike("nickname", trimmed)
        .maybeSingle<{ id: string }>();
      if (lookupErr || !found) {
        const msg = "No player with that nickname.";
        setError(msg);
        return { ok: false, error: msg };
      }
      const { error: err } = await sb.rpc("invite_to_party", { p_invitee_id: found.id });
      if (err) {
        setError(err.message);
        return { ok: false, error: err.message };
      }
      setError(null);
      await refresh();
      return { ok: true };
    },
    [sb, refresh],
  );

  const acceptInvite = useCallback(
    async (id: string): Promise<{ ok: boolean; error?: string }> => {
      if (!sb) return { ok: false, error: "Not available." };
      const { error: err } = await sb.rpc("accept_party_invite", { p_invite_id: id });
      if (err) {
        setError(err.message);
        return { ok: false, error: err.message };
      }
      setError(null);
      await refresh();
      return { ok: true };
    },
    [sb, refresh],
  );

  const declineInvite = useCallback(
    async (id: string): Promise<{ ok: boolean; error?: string }> => {
      if (!sb) return { ok: false, error: "Not available." };
      const { error: err } = await sb.rpc("decline_party_invite", { p_invite_id: id });
      if (err) {
        setError(err.message);
        return { ok: false, error: err.message };
      }
      setError(null);
      await refresh();
      return { ok: true };
    },
    [sb, refresh],
  );

  const cancelInvite = useCallback(
    async (id: string): Promise<{ ok: boolean; error?: string }> => {
      if (!sb) return { ok: false, error: "Not available." };
      const { error: err } = await sb.rpc("cancel_party_invite", { p_invite_id: id });
      if (err) {
        setError(err.message);
        return { ok: false, error: err.message };
      }
      setError(null);
      await refresh();
      return { ok: true };
    },
    [sb, refresh],
  );

  const leaveParty = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!sb) return { ok: false, error: "Not available." };
    const { error: err } = await sb.rpc("leave_party");
    if (err) {
      setError(err.message);
      return { ok: false, error: err.message };
    }
    setError(null);
    await refresh();
    return { ok: true };
  }, [sb, refresh]);

  return useMemo(
    () => ({
      loaded,
      party,
      incomingInvites,
      outgoingInvites,
      error,
      createParty,
      inviteByNickname,
      acceptInvite,
      declineInvite,
      cancelInvite,
      leaveParty,
    }),
    [loaded, party, incomingInvites, outgoingInvites, error, createParty, inviteByNickname, acceptInvite, declineInvite, cancelInvite, leaveParty],
  );
}
