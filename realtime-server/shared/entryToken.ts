import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Proves a WS "join" carries a `userId` that Next.js actually verified against the real
 * Supabase session (or `null` for a legitimate guest) — not whatever the client itself would
 * otherwise put in the message. Minted by POST /api/realtime/token (Next.js, has the real
 * session), verified by realtime-server on `join`. See docs/stateful_server_plan.md, Faza A / A1.
 *
 * Lives here (not in src/lib) for the same reason as the rest of this folder — see README.md —
 * so both sides import the exact same sign/verify logic instead of two implementations drifting.
 */

const TOKEN_TTL_MS = 30_000;

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * STU-77: this connection's equipped-gear bonuses (see EQUIPMENT_ITEMS in constants.ts), resolved
 * by /api/realtime/token from the caller's own profile row (RLS: a user only ever reads their own
 * equipped_* columns) and embedded in the signed token instead of trusted from the WS client
 * directly — same reasoning as `userId` itself. realtime-server copies these straight onto
 * `Conn.stats` at join (see server.ts); it never talks to Postgres to look them up itself.
 */
export interface EquipBonuses {
  maxHpBonus: number;
  damageReduction: number;
  moveSpeedBonus: number;
}
const NO_EQUIP_BONUSES: EquipBonuses = { maxHpBonus: 0, damageReduction: 0, moveSpeedBonus: 0 };

export function mintEntryToken(
  secret: string,
  userId: string | null,
  roomSlug: string,
  equip: EquipBonuses = NO_EQUIP_BONUSES,
  // STU-83: resolved by /api/realtime/token from public.admins (see supabase/migrations/
  // 0054_admins_table.sql), same reasoning as `equip` above — realtime-server trusts this claim
  // instead of a client-asserted "I'm an admin", so the admin panel's live-tuning overrides (see
  // DEV_OVERRIDES_ENABLED in server.ts) can be allowed for admin accounts even in production
  // without opening that door to every player.
  isAdmin = false,
): string {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = `${userId ?? ""}:${roomSlug}:${expiresAt}:${equip.maxHpBonus}:${equip.damageReduction}:${equip.moveSpeedBonus}:${isAdmin ? "1" : "0"}`;
  return `${payload}:${sign(secret, payload)}`;
}

export function verifyEntryToken(
  secret: string,
  token: unknown,
): { userId: string | null; roomSlug: string; equip: EquipBonuses; isAdmin: boolean } | null {
  if (typeof token !== "string") return null;
  const parts = token.split(":");
  if (parts.length !== 8) return null;
  const [userIdRaw, roomSlug, expiresAtRaw, maxHpBonusRaw, damageReductionRaw, moveSpeedBonusRaw, isAdminRaw, signature] =
    parts;
  if (!roomSlug) return null;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;
  const maxHpBonus = Number(maxHpBonusRaw);
  const damageReduction = Number(damageReductionRaw);
  const moveSpeedBonus = Number(moveSpeedBonusRaw);
  if (!Number.isFinite(maxHpBonus) || !Number.isFinite(damageReduction) || !Number.isFinite(moveSpeedBonus)) return null;
  if (isAdminRaw !== "0" && isAdminRaw !== "1") return null;

  const expected = sign(
    secret,
    `${userIdRaw}:${roomSlug}:${expiresAtRaw}:${maxHpBonusRaw}:${damageReductionRaw}:${moveSpeedBonusRaw}:${isAdminRaw}`,
  );
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return {
    userId: userIdRaw || null,
    roomSlug,
    equip: { maxHpBonus, damageReduction, moveSpeedBonus },
    isAdmin: isAdminRaw === "1",
  };
}
