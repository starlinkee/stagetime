import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getRoom } from "@/lib/rooms";
import { getSupabase } from "@/lib/supabase";
import { EQUIPMENT_ITEMS } from "@realtime-shared/constants";
import { mintEntryToken, type EquipBonuses } from "@realtime-shared/entryToken";
import { isLobbySlug } from "@realtime-shared/rooms";

/**
 * STU-77: turns this user's equipped_helm/equipped_armor/equipped_boots (see
 * supabase/migrations/0043_equipment.sql) into the signed bonus numbers realtime-server trusts —
 * see EquipBonuses's doc comment in entryToken.ts for why this has to happen here (Next.js, which
 * has the real session) rather than realtime-server looking the slugs up itself.
 */
async function resolveEquipBonuses(accessToken: string, userId: string): Promise<EquipBonuses> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return { maxHpBonus: 0, damageReduction: 0, moveSpeedBonus: 0 };
  // A fresh, request-scoped client carrying this caller's own access token, so the query below
  // runs under their RLS identity (own row only) instead of the shared anon client's.
  const sb = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${accessToken}` } } });
  const { data } = await sb
    .from("profiles")
    .select("equipped_helm, equipped_armor, equipped_boots")
    .eq("id", userId)
    .maybeSingle();
  const equippedSlugs = [data?.equipped_helm, data?.equipped_armor, data?.equipped_boots].filter(
    (slug): slug is string => Boolean(slug),
  );
  const bonuses: EquipBonuses = { maxHpBonus: 0, damageReduction: 0, moveSpeedBonus: 0 };
  for (const slug of equippedSlugs) {
    const item = EQUIPMENT_ITEMS.find((i) => i.slug === slug);
    if (!item) continue;
    bonuses.maxHpBonus += item.maxHpBonus ?? 0;
    bonuses.damageReduction += item.damageReductionBonus ?? 0;
    bonuses.moveSpeedBonus += item.moveSpeedBonus ?? 0;
  }
  return bonuses;
}

/**
 * STU-83: is this account in public.admins (see supabase/migrations/0054_admins_table.sql)? Same
 * request-scoped, caller's-own-RLS client as resolveEquipBonuses above — the "admins_select_own"
 * policy only ever lets this query see the caller's own row, never the full roster.
 */
async function resolveIsAdmin(accessToken: string, userId: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return false;
  const sb = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${accessToken}` } } });
  const { data } = await sb.from("admins").select("user_id").eq("user_id", userId).maybeSingle();
  return Boolean(data);
}

/**
 * Mints the short-lived signed token realtime-server requires on WS `join` (see
 * docs/stateful_server_plan.md, Faza A / A1). This is the only place `userId` is decided: we
 * verify the caller's Supabase access token server-side instead of trusting whatever userId a
 * WebSocket client would otherwise claim directly. No `Authorization` header (or an invalid one)
 * mints a token with `userId: null` — anonymous play is intentionally still allowed, see
 * RoomStage.tsx.
 */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const slug = body && typeof body === "object" && "roomSlug" in body ? (body as { roomSlug: unknown }).roomSlug : null;
  // "lobby"/"lobby2" aren't in ROOMS (they're locations, not rooms — see src/lib/rooms.ts) but are
  // valid places to move around in, so they have to be accepted here too.
  const validSlug = typeof slug === "string" && (isLobbySlug(slug) || Boolean(getRoom(slug)));
  if (!validSlug) {
    return NextResponse.json({ error: "unknown room" }, { status: 400 });
  }

  const secret = process.env.REALTIME_SERVER_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const auth = request.headers.get("authorization");
  const accessToken = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const sb = accessToken ? getSupabase() : null;
  const { data } = accessToken && sb ? await sb.auth.getUser(accessToken) : { data: null };
  const userId = data?.user?.id ?? null;

  const equip = accessToken && userId ? await resolveEquipBonuses(accessToken, userId) : undefined;
  const isAdmin = accessToken && userId ? await resolveIsAdmin(accessToken, userId) : false;

  return NextResponse.json({ token: mintEntryToken(secret, userId, slug as string, equip, isAdmin) });
}
