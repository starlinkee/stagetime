import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { verifyEntryToken } from "../shared/entryToken";
import { circleIntersectsObstacles, obstaclesFor, resolveObstacleMoveHitbox } from "../shared/obstacles";
import { clampPos } from "../shared/physics";
import { getRoomPhase, LOBBY_ZONE_RECTS } from "../shared/rooms";
import {
  ARENA_ROOM_SLUG,
  BALL_SPEED,
  BROADCAST_MS,
  CHARGE_MS,
  DEFAULT_CHARACTER_STATS,
  DIRS,
  DIR_OF,
  DMG_MAX,
  DMG_MIN,
  ENEMY_AGGRO_RANGE,
  ENEMY_ATTACK_COOLDOWN_MS,
  ENEMY_ATTACK_DMG,
  ENEMY_ATTACK_MS,
  ENEMY_ATTACK_R,
  ENEMY_ATTACK_RANGE,
  ENEMY_H,
  ENEMY_LEASH_RANGE,
  DESPERATE_HP,
  ENEMY_MAX_HP,
  ENEMY_RESPAWN_MS,
  ENEMY_SPEED,
  ENEMY_W,
  EXIT_ZONE,
  HITBOX_H,
  HITBOX_OFFSET_X,
  HITBOX_OFFSET_Y,
  HITBOX_W,
  HIT_PAD,
  IMMUNITY_MS,
  MAX_HP,
  ORB_R_MAX,
  ORB_R_MIN,
  PERSON_H,
  PERSON_W,
  RESPAWN_MS,
  ROLL_COOLDOWN_MS,
  ROLL_MS,
  ROLL_SPEED_MULT,
  SCHEMA_VERSION,
  STRIKE_COOLDOWN_MS,
  STRIKE_DMG,
  STRIKE_MS,
  STRIKE_R,
  STRIKE_REACH,
  TICK_MS,
  worldH,
  worldW,
} from "../shared/constants";
import type { CharacterStats, ClientMessage, Dir, EnemyState, HitEvent, PlayerState, ServerBall, ServerMessage } from "../shared/types";

const PORT = Number(process.env.PORT) || 8080;

// Faza A / A3 (docs/stateful_server_plan.md): the server no longer relies on client goodwill for
// any of these — SEND_EVERY in RoomStage.tsx is a courtesy, not a defense.
/** Generous headroom over the client's ~17 msg/s input cadence (SEND_EVERY=60ms) plus an
 * occasional `join` — this is about capping abuse/bugs, not normal play. */
const MAX_MESSAGES_PER_SEC = 40;
/** Simultaneous WebSocket connections allowed from one IP — bounds a single-source flood of raw
 * sockets. A few is normal (multiple tabs/devices for one person). */
const MAX_CONNECTIONS_PER_IP = 8;
/** Players allowed in one room at once — bounds per-room memory and broadcast cost. Coworking
 * rooms are small groups by design; this is a safety ceiling, not a game-design number. */
const MAX_PLAYERS_PER_ROOM = 50;
/** Faza B / B2 (docs/stateful_server_plan.md): how long a player stays visible, frozen in place,
 * after their WebSocket drops before they're actually removed from the room — long enough to
 * ride out a WiFi hiccup or a phone lock screen, short enough that a real leave doesn't linger. */
const GRACE_MS = 12_000;

// Fail loud at boot (visible in Fly logs / a crash-looping Machine) rather than silently
// rejecting every `join` later — see docs/stateful_server_plan.md, Faza A / A1.
const REALTIME_SECRET = (() => {
  const secret = process.env.REALTIME_SERVER_SECRET;
  if (!secret) throw new Error("REALTIME_SERVER_SECRET is not set");
  return secret;
})();

/** Honors `input.speedOverride` (the admin panel's playerSpeed knob, see src/lib/adminSettings.ts)
 * only outside production — a real client asserting its own speed would otherwise defeat the
 * entire point of this server being authoritative over movement. */
const DEV_OVERRIDES_ENABLED = process.env.NODE_ENV !== "production";
/** Sanity bounds for `speedOverride` even in dev, so a stray huge value can't break physics/
 * collision assumptions elsewhere on the tick. */
const MIN_DEV_SPEED = 1;
const MAX_DEV_SPEED = 2000;

// Faza C / C1-C2 (docs/stateful_server_plan.md): unlike REALTIME_SECRET, missing persistence
// config is NOT fatal — movement/combat (the thing players actually feel) works fine without it,
// so crash-looping the whole server over a persistence-only misconfiguration would trade a small,
// contained problem (positions don't save) for a much bigger one (nobody can play). It still needs
// to be impossible to miss, though — a one-line boot warning is exactly what let this go
// unnoticed on preview for a while — so PERSISTENCE_ENABLED also gates a loud, *repeating* error
// folded into the METRICS_INTERVAL_MS snapshot below, not just a one-shot log at boot.
const PERSISTENCE_API_URL = process.env.PERSISTENCE_API_URL || null;
const REALTIME_INTERNAL_SECRET = process.env.REALTIME_INTERNAL_SECRET || null;
const PERSISTENCE_ENABLED = Boolean(PERSISTENCE_API_URL && REALTIME_INTERNAL_SECRET);
if (!PERSISTENCE_ENABLED) {
  console.error(
    "PERSISTENCE_API_URL/REALTIME_INTERNAL_SECRET not set — positions won't be persisted, every spawn is (200,200). This will repeat every METRICS_INTERVAL_MS until fixed.",
  );
}
/** How often (and, at minimum, when) each signed-in player's position is saved — see
 * savePositions/persistPosition below. */
const SAVE_EVERY_MS = 8_000;

type Conn = {
  id: string;
  ws: WebSocket;
  roomSlug: string;
  isLobby: boolean;
  userId: string | null;
  nick: string | null;
  color: string;
  x: number;
  y: number;
  d: Dir;
  // Latest movement intent from the client — the server, not the client, turns this into a
  // position. See docs/stateful_server_plan.md for why this exists.
  inputDx: -1 | 0 | 1;
  inputDy: -1 | 0 | 1;
  // Per-connection message-rate window — see withinRateLimit.
  msgWindowStart: number;
  msgCount: number;
  // Faza F2 (docs/combat_sync_plan.md): roll state the server tracks per connection, so it
  // can enforce cooldowns and compute position during a roll itself instead of trusting the
  // client — the same reason `inputDx`/`inputDy` exist instead of a client-asserted position.
  // Direction/facing comes from `d` above (set by plain movement, held during roll).
  rollUntil: number;
  rollCooldownUntil: number;
  rollDx: number;
  rollDy: number;
  // Faza F3: when the client last told us it started charging a ball (`{ type: "charge", on:
  // true }`), or null if it isn't charging (or never told us this connection). Caps `fire`'s
  // claimed `chargeMs` to what actually elapsed here, not to what the client claims elapsed.
  chargeStartAt: number | null;
  meleeCooldownUntil: number;
  // Stamina (fire-rate) state — see currentStamina() and the "fire" handler below, and
  // STAMINA_MAX's doc comment in shared/constants.ts for the model. `staminaAt` is the stamina
  // value *as of* `staminaUpdatedAt`, not the live value — currentStamina() projects it forward
  // from there. Only ever written at a `fire` (spend) or a reconnect resume (carried forward like
  // hp/respawnAt/immuneUntil below), never on a per-tick timer — that's what keeps this O(1) per
  // event instead of a regen loop over every connection every tick.
  staminaAt: number;
  staminaUpdatedAt: number;
  // Normally always stats.moveSpeed — only ever different when DEV_OVERRIDES_ENABLED and the
  // client sent an `input.speedOverride` (admin panel), see the "input" handler below.
  speed: number;
  // This connection's own copy of CharacterStats (see its doc comment in shared/types.ts) — a
  // clone of DEFAULT_CHARACTER_STATS today since there's no character choice yet, but every rule
  // that used to read a global constant (max projectiles in flight, fire cooldown, damage) now
  // reads this instead, so a future character pick or item bonus only has to mutate this one
  // connection's copy.
  stats: CharacterStats;
  // HP/respawn/immunity — see MAX_HP/RESPAWN_MS/IMMUNITY_MS doc comments in shared/constants.ts.
  // `respawnAt`: 0 while alive; otherwise the epoch ms this connection respawns at, and `isDead()`
  // below treats it as frozen (no movement/actions) until then.
  hp: number;
  respawnAt: number;
  immuneUntil: number;
  // Ghost position/facing while isDead(conn) — see PlayerState.gx/gy/gd's doc comment in
  // shared/types.ts. x/y/d stay frozen at the death spot (the corpse) for the whole respawn
  // countdown; gx/gy/gd is what the "input" handler actually moves during that window.
  gx: number;
  gy: number;
  gd: Dir;
};

/** Frozen (no movement, no roll/charge/fire/strike) while waiting out RESPAWN_MS. */
function isDead(conn: Conn): boolean {
  return conn.respawnAt > 0;
}

/**
 * Frozen (no movement, no roll/charge/fire/strike) while this connection's own room is in
 * its "work" phase — the coworking half of the cycle, where nobody should be able to walk around
 * or fight. Thaws automatically the instant `getRoomPhase` flips to "break", same clock every
 * client already renders the countdown against (src/lib/timer.ts's getTimerState), so there's
 * nothing here to broadcast: every client sees the same freeze/thaw at the same instant on its
 * own. `null` (lobby/stopwatch/shop — no pomodoro cycle) never freezes.
 */
function isFrozen(conn: Conn): boolean {
  return getRoomPhase(conn.roomSlug, Date.now()) === "work";
}

/**
 * This connection's fire stamina *right now*, projected forward from the last time it was
 * actually written (`staminaAt`/`staminaUpdatedAt`) instead of ticked every server frame — see the
 * `Conn.staminaAt` doc comment and STAMINA_MAX's in shared/constants.ts. Cheap at any connection
 * count: called only from the "fire" handler (to spend) and the broadcast loop (to report), never
 * from the tick loop.
 */
function currentStamina(conn: Conn, now: number): number {
  const elapsedSec = Math.max(0, now - conn.staminaUpdatedAt) / 1000;
  return Math.min(conn.stats.staminaMax, conn.staminaAt + elapsedSec * conn.stats.staminaRegenPerSec);
}

const rooms = new Map<string, Set<Conn>>();
/** Live projectiles/melee hitboxes per room — Faza F3 (docs/combat_sync_plan.md). */
const roomBalls = new Map<string, ServerBall[]>();
/** Hits resolved since the last broadcast, drained into the next `state` message and cleared —
 * not cumulative, see the broadcast loop below. */
const roomHits = new Map<string, HitEvent[]>();

/**
 * First room-owned enemy (see ARENA_ROOM_SLUG/ENEMY_* in shared/constants.ts): everyone in the
 * room can hurt it, and it can hurt everyone back, via the exact same `roomBalls`/`roomHits`
 * pipeline as a player's own melee swing — no separate hit-resolution path to keep in sync with.
 * One per room slug, same pattern as `roomBalls`/`roomHits` above; today only `ARENA_ROOM_SLUG`
 * ever gets an entry (see ensureArenaEnemy).
 */
type Enemy = {
  id: string;
  x: number;
  y: number;
  hp: number;
  /** Currently-chased connection's id, or null while idle/no valid target in range. Kept across
   * ticks so the enemy commits to one target (within ENEMY_LEASH_RANGE) instead of flickering
   * between whoever's nearest every tick. */
  targetId: string | null;
  attackCooldownUntil: number;
  /** 0 while alive; otherwise the epoch ms it respawns at (same shape as Conn.respawnAt). */
  deadUntil: number;
};
const roomEnemies = new Map<string, Enemy>();

function spawnEnemy(): Enemy {
  // Arena is a plain (non-lobby) room, same footprint as EXIT_ZONE's room — center of that
  // single-screen world, not the 2x lobby world.
  const spawn = clampPos(worldW(false) / 2 - ENEMY_W / 2, worldH(false) / 2 - ENEMY_H / 2, false);
  return { id: `enemy:${randomUUID()}`, x: spawn.x, y: spawn.y, hp: ENEMY_MAX_HP, targetId: null, attackCooldownUntil: 0, deadUntil: 0 };
}

/** Called whenever a connection actually lands in a room (see handleJoin) — spawns this room's
 * enemy at full HP the moment it stops being empty, per AGENTS.md's request ("always full life"
 * on entry). A no-op for every room slug except ARENA_ROOM_SLUG, and for an arena that already has
 * a live-or-dying enemy (leaveRoom below deletes the entry outright once the room empties, so the
 * next join here always starts fresh). */
function ensureArenaEnemy(roomSlug: string) {
  if (roomSlug !== ARENA_ROOM_SLUG) return;
  if (roomEnemies.has(roomSlug)) return;
  roomEnemies.set(roomSlug, spawnEnemy());
}
/** Live connection count per IP — see MAX_CONNECTIONS_PER_IP. */
const connectionsByIp = new Map<string, number>();
/**
 * Scheduled removals for connections currently in their grace period (see GRACE_MS) — dropped
 * WS, but still sitting in `rooms` so other clients keep seeing them until either the timer
 * fires (real leave) or a reconnecting `join` with the same key cancels it (see graceKey).
 */
const pendingRemoval = new Map<string, ReturnType<typeof setTimeout>>();
const graceKey = (roomSlug: string, id: string) => `${roomSlug}:${id}`;

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function joinRoom(conn: Conn) {
  let set = rooms.get(conn.roomSlug);
  if (!set) {
    set = new Set();
    rooms.set(conn.roomSlug, set);
  }
  set.add(conn);
}

function leaveRoom(conn: Conn) {
  const set = rooms.get(conn.roomSlug);
  if (!set) return;
  set.delete(conn);
  if (set.size === 0) {
    rooms.delete(conn.roomSlug);
    // Faza F3: no players left to own or get hit by these — drop them instead of leaking one
    // array per room slug that ever had combat in it.
    roomBalls.delete(conn.roomSlug);
    roomHits.delete(conn.roomSlug);
    // Same reasoning for the room's own enemy (see ensureArenaEnemy's doc comment) — an empty
    // arena drops it outright rather than waiting out ENEMY_RESPAWN_MS, so the next person in
    // always meets it at full HP, per AGENTS.md's request.
    roomEnemies.delete(conn.roomSlug);
  }
}

let nextBallId = 0;

/** Shared by pushBall (player) and the enemy's own melee swing — a ball only ever needs a room
 * slug to land in the right room's array, not necessarily a Conn. */
function pushBallToRoom(roomSlug: string, ball: ServerBall) {
  let balls = roomBalls.get(roomSlug);
  if (!balls) {
    balls = [];
    roomBalls.set(roomSlug, balls);
  }
  balls.push(ball);
}

/** Shared by spawnBall/spawnMelee. Stamina (see STAMINA_MAX's doc comment in
 * shared/constants.ts) is the only fire-rate limit — no separate concurrent-in-flight cap here,
 * so there's nothing that can silently disagree with what the stamina bar shows. */
function pushBall(conn: Conn, ball: ServerBall) {
  pushBallToRoom(conn.roomSlug, ball);
}

/** Thrown ball above the connection's head, in its current facing direction — same math as
 * `launch()` in src/components/RoomStage.tsx. `p` is the charge fraction (0..1). */
function spawnBall(conn: Conn, p: number) {
  const [ux, uy] = DIRS[conn.d];
  const n = Math.hypot(ux, uy) || 1;
  const r = ORB_R_MIN + (ORB_R_MAX - ORB_R_MIN) * p;
  // Base damage from charge fraction, then scaled by this connection's own attackPower — 1 for
  // everyone today, but a higher one (future item/character) can push past DMG_MAX on purpose.
  const baseDmg = Math.max(DMG_MIN, Math.min(DMG_MAX, DMG_MIN + (DMG_MAX - DMG_MIN) * p));
  const dmg = Math.round(baseDmg * conn.stats.attackPower);
  pushBall(conn, {
    id: `${conn.id}:${nextBallId++}`,
    x: conn.x + PERSON_W / 2,
    y: Math.max(r + 2, conn.y - r - 4),
    vx: (ux / n) * BALL_SPEED,
    vy: (uy / n) * BALL_SPEED,
    r,
    color: conn.color,
    owner: conn.id,
    dmg,
  });
}

/** Melee hitbox just in front of the connection, facing its current direction — same math as
 * `strike()` in src/components/RoomStage.tsx. Disappears at `until` regardless of whether it hit
 * anything, exactly like the client-side version did before this migration. */
function spawnMelee(conn: Conn) {
  const [ux, uy] = DIRS[conn.d];
  const n = Math.hypot(ux, uy) || 1;
  pushBall(conn, {
    id: `${conn.id}:${nextBallId++}`,
    x: conn.x + PERSON_W / 2 + (ux / n) * STRIKE_REACH,
    y: conn.y + PERSON_H / 2 + (uy / n) * STRIKE_REACH,
    vx: 0,
    vy: 0,
    r: STRIKE_R,
    color: conn.color,
    owner: conn.id,
    melee: true,
    until: Date.now() + STRIKE_MS,
    dmg: Math.round(STRIKE_DMG * conn.stats.attackPower),
  });
}

/**
 * One room's enemy for one tick — chase the nearest valid target within ENEMY_AGGRO_RANGE, stick
 * with it until it dies/goes immune/wanders past ENEMY_LEASH_RANGE, and swing (into the shared
 * `roomBalls` pipeline, same as a player's own melee) once close enough. This is the entire "AI":
 * a handful of `if`s in the same per-room tick pass as movement/combat, not a separate FSM/AI
 * subsystem (see AGENTS.md's 2026-09-23 note) — exactly the pattern HP already set for adding
 * server-side behavior here.
 */
function tickEnemy(slug: string, set: Set<Conn>, now: number, dt: number) {
  const enemy = roomEnemies.get(slug);
  if (!enemy) return;
  if (enemy.deadUntil > 0) {
    if (now >= enemy.deadUntil) {
      const spawn = clampPos(worldW(false) / 2 - ENEMY_W / 2, worldH(false) / 2 - ENEMY_H / 2, false);
      enemy.x = spawn.x;
      enemy.y = spawn.y;
      enemy.hp = ENEMY_MAX_HP;
      enemy.deadUntil = 0;
      enemy.targetId = null;
    }
    return;
  }
  const cx = enemy.x + ENEMY_W / 2;
  const cy = enemy.y + ENEMY_H / 2;
  let target: Conn | null = null;
  if (enemy.targetId) {
    for (const c of set) {
      if (c.id === enemy.targetId) {
        target = c;
        break;
      }
    }
    if (target && (isDead(target) || now < target.immuneUntil)) target = null;
    if (target && Math.hypot(target.x + PERSON_W / 2 - cx, target.y + PERSON_H / 2 - cy) > ENEMY_LEASH_RANGE) target = null;
  }
  if (!target) {
    let bestDist = ENEMY_AGGRO_RANGE;
    for (const c of set) {
      if (isDead(c) || now < c.immuneUntil) continue;
      const dist = Math.hypot(c.x + PERSON_W / 2 - cx, c.y + PERSON_H / 2 - cy);
      if (dist <= bestDist) {
        bestDist = dist;
        target = c;
      }
    }
  }
  enemy.targetId = target?.id ?? null;
  if (!target) return;
  const tx = target.x + PERSON_W / 2;
  const ty = target.y + PERSON_H / 2;
  const dist = Math.hypot(tx - cx, ty - cy);
  const ux = (tx - cx) / (dist || 1);
  const uy = (ty - cy) / (dist || 1);
  if (dist > ENEMY_ATTACK_RANGE) {
    const clamped = clampPos(enemy.x + ux * ENEMY_SPEED * dt, enemy.y + uy * ENEMY_SPEED * dt, false);
    enemy.x = clamped.x;
    enemy.y = clamped.y;
    return;
  }
  if (now < enemy.attackCooldownUntil) return;
  enemy.attackCooldownUntil = now + ENEMY_ATTACK_COOLDOWN_MS;
  pushBallToRoom(slug, {
    id: `${enemy.id}:${nextBallId++}`,
    x: cx + ux * ENEMY_ATTACK_R,
    y: cy + uy * ENEMY_ATTACK_R,
    vx: 0,
    vy: 0,
    r: ENEMY_ATTACK_R,
    color: "#7f1d1d",
    owner: enemy.id,
    melee: true,
    until: now + ENEMY_ATTACK_MS,
    dmg: ENEMY_ATTACK_DMG,
  });
}

/** Only -1/0/1 are ever valid — anything else from the network becomes 0 (no movement in that axis). */
function toAxis(v: unknown): -1 | 0 | 1 {
  return v === -1 || v === 1 ? v : 0;
}

/** Fly terminates TLS and proxies the connection; it sets this header to the real client IP
 * (see Fly docs on `Fly-Client-IP`). Falls back to the raw socket address for local dev, where
 * there's no proxy in front and it's already correct. */
function clientIp(req: import("node:http").IncomingMessage): string {
  const header = req.headers["fly-client-ip"];
  if (typeof header === "string" && header) return header;
  return req.socket.remoteAddress ?? "unknown";
}

/** True if this connection is still under MAX_MESSAGES_PER_SEC for the current 1s window;
 * excess messages are dropped rather than disconnecting on a single burst. */
function withinRateLimit(conn: Conn): boolean {
  const now = Date.now();
  if (now - conn.msgWindowStart >= 1000) {
    conn.msgWindowStart = now;
    conn.msgCount = 0;
  }
  conn.msgCount += 1;
  return conn.msgCount <= MAX_MESSAGES_PER_SEC;
}

/**
 * Last-known position for a signed-in player joining fresh (no grace-period ghost to resume
 * from instead — see B2) — calls the internal Next.js bridge (POST /api/internal/positions'
 * sibling GET), not Postgres directly (Faza C / C1: one place owns DB access). `null` on any
 * failure means "spawn at the default point" for *this* join (a single bad request shouldn't take
 * the whole server down), but unlike missing config at boot, every failure is logged loudly —
 * a non-2xx response (auth mismatch, a Vercel deployment-protection redirect, etc.) used to be
 * swallowed silently here, which is exactly what hid the preview-branch bug this replaced.
 */
async function fetchSavedPosition(userId: string, room: string): Promise<{ x: number; y: number; d: Dir } | null> {
  if (!PERSISTENCE_ENABLED) return null;
  try {
    const url = new URL("/api/internal/positions", PERSISTENCE_API_URL!);
    url.searchParams.set("userId", userId);
    url.searchParams.set("room", room);
    const res = await fetch(url, { headers: { authorization: `Bearer ${REALTIME_INTERNAL_SECRET}` } });
    if (!res.ok) {
      console.error(`fetchSavedPosition: ${res.status} ${res.statusText} from ${url}`);
      return null;
    }
    const data = (await res.json()) as { position: { x: number; y: number; d: number } | null };
    if (!data.position) return null;
    return { x: data.position.x, y: data.position.y, d: data.position.d as Dir };
  } catch (err) {
    console.error("fetchSavedPosition failed", err);
    return null;
  }
}

/** Batched write to the same bridge — see fetchSavedPosition. A failed save is logged loudly (see
 * that doc comment) but not fatal: the next periodic sweep (SAVE_EVERY_MS) or the next explicit
 * call tries again. */
async function savePositions(entries: Array<{ userId: string; room: string; x: number; y: number; d: number }>) {
  if (!PERSISTENCE_ENABLED || entries.length === 0) return;
  try {
    const url = new URL("/api/internal/positions", PERSISTENCE_API_URL!);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${REALTIME_INTERNAL_SECRET}` },
      body: JSON.stringify({ positions: entries }),
    });
    if (!res.ok) console.error(`savePositions: ${res.status} ${res.statusText} from ${url}`);
  } catch (err) {
    console.error("savePositions failed", err);
  }
}

/** Guests (userId === null) have nothing to persist. */
function persistPosition(conn: Conn) {
  if (!conn.userId) return;
  void savePositions([{ userId: conn.userId, room: conn.roomSlug, x: conn.x, y: conn.y, d: conn.d }]);
}

/**
 * Bumps the killer's/victim's all-time kills/deaths (see ProfileMenu.tsx's "Stats" panel,
 * supabase/migrations/0024_kills_deaths.sql) — fired once per kill, from the tick loop's hit
 * resolution below. Like savePositions, this is the only place that can do it: kills/deaths are
 * decided authoritatively here, not by a client with its own Supabase session (unlike
 * increment_balls_shot/increment_fist_swings, which a real shot/swing lets the client call for
 * itself). Either id can be null (a guest killer/victim has nothing to persist) but not both.
 *
 * `enemyKill` (see supabase/migrations/0030_mob_kills.sql): the room's own enemy died instead of a
 * player — same xp/gold reward, but counted as `mob_kills` instead of `kills`, and never paired
 * with a `victimUserId` (the enemy isn't a player with deaths to persist).
 */
async function reportCombatEvent(killerUserId: string | null, victimUserId: string | null, enemyKill = false) {
  if (!PERSISTENCE_ENABLED || (!killerUserId && !victimUserId)) return;
  try {
    const url = new URL("/api/internal/combat", PERSISTENCE_API_URL!);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${REALTIME_INTERNAL_SECRET}` },
      body: JSON.stringify({ killerUserId, victimUserId, enemyKill }),
    });
    if (!res.ok) console.error(`reportCombatEvent: ${res.status} ${res.statusText} from ${url}`);
  } catch (err) {
    console.error("reportCombatEvent failed", err);
  }
}

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  if (req.url === "/") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("stagetime realtime-server: up (this is a WebSocket endpoint, not a page)");
    return;
  }
  res.writeHead(404);
  res.end();
});

/**
 * Handles a `join` (async because of the persistence-bridge lookup — see fetchSavedPosition).
 * Everything that doesn't need I/O (token check, grace-period resume, capacity check) runs
 * first and synchronously, so a rejected/invalid join never touches the network.
 */
async function handleJoin(conn: Conn, ws: WebSocket, msg: Extract<ClientMessage, { type: "join" }>) {
  // Token is minted by POST /api/realtime/token (Next.js, has the real Supabase session) —
  // roomSlug and userId come from it, never from the client directly, or a raw WebSocket could
  // otherwise claim to be anyone. Invalid/expired/missing token: ignore the join entirely
  // (connection stays in its initial, room-less state).
  const verified = verifyEntryToken(REALTIME_SECRET, msg.token);
  if (!verified) return;
  // Client supplies its own stable per-tab id (the same key it uses for Supabase Presence and,
  // on the preview branch, for WS reconnect after a drop — see B1/B2 in
  // docs/stateful_server_plan.md) so it can be matched across systems/reconnects without a
  // translation step.
  const newId = typeof msg.id === "string" && msg.id ? msg.id : conn.id;

  // A dropped connection stays in `rooms` during its grace period (see GRACE_MS) as a "ghost" —
  // frozen, but still occupying a slot. If this join reconnects that same (roomSlug, id), cancel
  // the pending removal and absorb the ghost's last known position instead of respawning; either
  // way the ghost itself has to go, so it doesn't double up with the live connection replacing it.
  const key = graceKey(verified.roomSlug, newId);
  const pending = pendingRemoval.get(key);
  if (pending) {
    clearTimeout(pending);
    pendingRemoval.delete(key);
  }
  let resumeFrom:
    | {
        x: number;
        y: number;
        d: Dir;
        hp: number;
        respawnAt: number;
        immuneUntil: number;
        gx: number;
        gy: number;
        gd: Dir;
        staminaAt: number;
        staminaUpdatedAt: number;
      }
    | null = null;
  const targetSet = rooms.get(verified.roomSlug);
  if (targetSet) {
    for (const other of targetSet) {
      if (other !== conn && other.id === newId) {
        // Carries HP/respawn/immunity (and, mid-respawn-countdown, ghost position) across the
        // reconnect too — most notably this is what makes the server-side respawn (see the tick
        // loop) actually stick: it moves the *old* Conn into the lobby room and sends it
        // `respawn_redirect`, then closes; the new page's fresh `join` resumes this same
        // connection's post-respawn state (full HP, still-ticking immunity) instead of the new
        // WS's fresh-connection defaults.
        resumeFrom = {
          x: other.x,
          y: other.y,
          d: other.d,
          hp: other.hp,
          respawnAt: other.respawnAt,
          immuneUntil: other.immuneUntil,
          gx: other.gx,
          gy: other.gy,
          gd: other.gd,
          staminaAt: other.staminaAt,
          staminaUpdatedAt: other.staminaUpdatedAt,
        };
        targetSet.delete(other);
        break;
      }
    }
    if (targetSet.size === 0) rooms.delete(verified.roomSlug);
  }

  // Capacity check happens before any mutation, so a rejected join doesn't first evict the
  // connection from whatever room it was already in. A re-join of the *same* room (token
  // refresh, or resuming from the ghost removed above) doesn't count itself against its own
  // limit.
  const targetSetNow = rooms.get(verified.roomSlug);
  const alreadyIn = conn.roomSlug === verified.roomSlug && (targetSetNow?.has(conn) ?? false);
  const occupancy = (targetSetNow?.size ?? 0) - (alreadyIn ? 1 : 0);
  if (occupancy >= MAX_PLAYERS_PER_ROOM) {
    send(ws, { type: "join_rejected", reason: "room_full" });
    return;
  }

  const isLobbyTarget = verified.roomSlug === "lobby";
  // Fresh join into the lobby, naming the room just left (see `fromRoomSlug`'s doc comment in
  // types.ts) — resolved to that room's own lobby zone, same one RoomStage.tsx's `fromSlug`
  // resolves client-side, so both sides land in the same spot instead of the server improvising
  // its own guess. A ghost to resume from always wins over this, same as a saved position would.
  const lobbyZoneRect =
    !resumeFrom && isLobbyTarget && typeof msg.fromRoomSlug === "string" ? LOBBY_ZONE_RECTS.get(msg.fromRoomSlug) ?? null : null;

  // Faza C / C2: only for a genuinely fresh join (no ghost to resume from) of a signed-in user —
  // guests (userId === null) have nothing saved. Done before any mutation below so a socket that
  // closed while this was in flight can't clobber a later, faster join with stale data. Skipped
  // for non-lobby rooms: a fresh entry there always lands on EXIT_ZONE's center (see below), same
  // as RoomStage.tsx's spawnZoneSlug, so a saved position would never be looked at anyway. Also
  // skipped when `lobbyZoneRect` already resolved a zone — that always wins over a saved position
  // too, same reasoning.
  let loaded: { x: number; y: number; d: Dir } | null = null;
  if (!resumeFrom && verified.userId && isLobbyTarget && !lobbyZoneRect) {
    loaded = await fetchSavedPosition(verified.userId, verified.roomSlug);
    if (ws.readyState !== WebSocket.OPEN) return;
  }

  // Actually switching rooms (not just refreshing the same one) — save where we stood in the
  // old room before leaving it, same as a real departure would (see the grace-expiry timeout).
  if (conn.roomSlug !== verified.roomSlug && (rooms.get(conn.roomSlug)?.has(conn) ?? false)) {
    persistPosition(conn);
  }

  leaveRoom(conn);
  conn.id = newId;
  conn.roomSlug = verified.roomSlug;
  conn.isLobby = conn.roomSlug === "lobby";
  conn.userId = verified.userId;
  conn.nick = typeof msg.nick === "string" ? msg.nick.slice(0, 40) : null;
  conn.color = typeof msg.color === "string" ? msg.color : "#ffffff";
  // Only a reconnect-ghost resume carries HP/respawn/immunity forward — `loaded` (a saved
  // position from Postgres) and every other branch below are treated as a fresh life, same as a
  // brand-new connection.
  conn.hp = resumeFrom?.hp ?? MAX_HP;
  conn.respawnAt = resumeFrom?.respawnAt ?? 0;
  conn.immuneUntil = resumeFrom?.immuneUntil ?? 0;
  // Same "only a reconnect-ghost resume carries this forward" rule as hp/respawnAt/immuneUntil —
  // a fresh life (or a saved-position load, which never had a live Conn to read stamina from)
  // just starts full, same as a brand-new connection.
  conn.staminaAt = resumeFrom?.staminaAt ?? conn.stats.staminaMax;
  conn.staminaUpdatedAt = resumeFrom?.staminaUpdatedAt ?? Date.now();
  const resolved = resumeFrom ?? loaded;
  // Same "only a reconnect-ghost resume carries this forward" rule as hp/respawnAt/immuneUntil
  // above — the fallback (conn.x/y/d) is filled in by the branch below, run right after.
  if (resolved) {
    const clamped = clampPos(resolved.x, resolved.y, conn.isLobby);
    conn.x = clamped.x;
    conn.y = clamped.y;
    conn.d = resolved.d;
  } else if (lobbyZoneRect) {
    const spawn = clampPos(lobbyZoneRect.x + lobbyZoneRect.w / 2 - PERSON_W / 2, lobbyZoneRect.y + lobbyZoneRect.h / 2 - PERSON_H / 2, true);
    conn.x = spawn.x;
    conn.y = spawn.y;
  } else if (!isLobbyTarget) {
    // Matches RoomStage.tsx: entering any non-lobby room without a live reconnect always lands
    // on the exit zone's center, never at a stale saved position — see the `loaded` skip above.
    const spawn = clampPos(EXIT_ZONE.x + EXIT_ZONE.w / 2 - PERSON_W / 2, EXIT_ZONE.y + EXIT_ZONE.h / 2 - PERSON_H / 2, false);
    conn.x = spawn.x;
    conn.y = spawn.y;
  } else {
    const spawn = clampPos(200, 200, conn.isLobby);
    conn.x = spawn.x;
    conn.y = spawn.y;
  }
  // Ghost position/facing: a mid-respawn-countdown reconnect carries its ghost forward same as
  // hp/respawnAt/immuneUntil above; every other case (fresh life) just starts the ghost coincident
  // with the body it'll leave behind on the next death.
  conn.gx = resumeFrom?.gx ?? conn.x;
  conn.gy = resumeFrom?.gy ?? conn.y;
  conn.gd = resumeFrom?.gd ?? conn.d;
  joinRoom(conn);
  ensureArenaEnemy(conn.roomSlug);
}

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws, req) => {
  const ip = clientIp(req);
  const ipCount = connectionsByIp.get(ip) ?? 0;
  if (ipCount >= MAX_CONNECTIONS_PER_IP) {
    ws.close(1013, "too many connections");
    return;
  }
  connectionsByIp.set(ip, ipCount + 1);

  // See Conn.stats' doc comment — own copy, not a shared reference, so a future item/character
  // bonus can mutate this connection's stats without touching the default or any other connection.
  const stats: CharacterStats = { ...DEFAULT_CHARACTER_STATS };

  const conn: Conn = {
    id: randomUUID(),
    ws,
    roomSlug: "lobby",
    isLobby: true,
    userId: null,
    nick: null,
    color: "#ffffff",
    x: 0,
    y: 0,
    d: 2,
    inputDx: 0,
    inputDy: 0,
    msgWindowStart: Date.now(),
    msgCount: 0,
    rollUntil: 0,
    rollCooldownUntil: 0,
    rollDx: 0,
    rollDy: 0,
    chargeStartAt: null,
    meleeCooldownUntil: 0,
    staminaAt: stats.staminaMax,
    staminaUpdatedAt: Date.now(),
    speed: stats.moveSpeed,
    stats,
    hp: MAX_HP,
    respawnAt: 0,
    immuneUntil: 0,
    gx: 0,
    gy: 0,
    gd: 2,
  };

  send(ws, { type: "welcome", id: conn.id });

  ws.on("message", (raw) => {
    if (!withinRateLimit(conn)) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "join") {
      void handleJoin(conn, ws, msg);
      return;
    }
    if (msg.type === "input") {
      conn.inputDx = toAxis(msg.dx);
      conn.inputDy = toAxis(msg.dy);
      if (DEV_OVERRIDES_ENABLED && typeof msg.speedOverride === "number" && Number.isFinite(msg.speedOverride)) {
        conn.speed = Math.max(MIN_DEV_SPEED, Math.min(MAX_DEV_SPEED, msg.speedOverride));
      }
      return;
    }
    // Faza F2 (docs/combat_sync_plan.md): a request, not an assertion — the server derives
    // direction/distance itself from this connection's own `d`/`x`/`y`, and silently ignores the
    // request while on cooldown, exactly like a well-behaved client already does today.
    if (msg.type === "roll") {
      if (isDead(conn) || isFrozen(conn)) return;
      const now = Date.now();
      if (now >= conn.rollCooldownUntil) {
        const [ux, uy] = DIRS[conn.d];
        const n = Math.hypot(ux, uy) || 1;
        conn.rollDx = ux / n;
        conn.rollDy = uy / n;
        conn.rollUntil = now + ROLL_MS;
        conn.rollCooldownUntil = conn.rollUntil + ROLL_COOLDOWN_MS;
      }
      return;
    }
    // Faza F3: marks when charging actually started here, so `fire` below can't claim more than
    // really elapsed.
    if (msg.type === "charge") {
      if (isDead(conn) || isFrozen(conn)) return;
      conn.chargeStartAt = msg.on === true ? Date.now() : null;
      return;
    }
    if (msg.type === "fire") {
      if (isDead(conn) || isFrozen(conn)) return;
      const now = Date.now();
      // Stamina, not a salvo cooldown — see currentStamina() and STAMINA_MAX's doc comment in
      // shared/constants.ts. A shot is refused outright (not queued/partial) when the pool can't
      // cover its cost; this is the only fire-rate gate (see pushBall's doc comment). Except: at
      // DESPERATE_HP or below (STU-44, deliberate), the gate and the spend are both skipped — a
      // nearly-dead player can spam shots freely, and the pool keeps regenerating underneath
      // untouched so there's no debt once HP recovers back above the threshold.
      const desperate = conn.hp <= DESPERATE_HP;
      const stamina = currentStamina(conn, now);
      if (!desperate && stamina < conn.stats.staminaCostPerShot) return;
      const elapsed = conn.chargeStartAt !== null ? now - conn.chargeStartAt : 0;
      const claimed = typeof msg.chargeMs === "number" && Number.isFinite(msg.chargeMs) ? msg.chargeMs : 0;
      const chargeMs = Math.max(0, Math.min(CHARGE_MS, Math.min(elapsed, claimed)));
      conn.chargeStartAt = null;
      spawnBall(conn, chargeMs / CHARGE_MS);
      if (!desperate) {
        conn.staminaAt = stamina - conn.stats.staminaCostPerShot;
        conn.staminaUpdatedAt = now;
      }
      return;
    }
    if (msg.type === "strike") {
      if (isDead(conn) || isFrozen(conn)) return;
      const now = Date.now();
      if (now < conn.meleeCooldownUntil) return;
      conn.meleeCooldownUntil = now + STRIKE_COOLDOWN_MS;
      spawnMelee(conn);
      return;
    }
    if (msg.type === "profile") {
      conn.nick = typeof msg.nick === "string" ? msg.nick.slice(0, 40) : null;
      if (typeof msg.color === "string" && msg.color) conn.color = msg.color;
      return;
    }
  });

  ws.on("close", () => {
    // Freeze in place immediately — otherwise stale movement intent would keep sliding a
    // disconnected "ghost" around the room for the rest of its grace period.
    conn.inputDx = 0;
    conn.inputDy = 0;
    const set = rooms.get(conn.roomSlug);
    if (set?.has(conn)) {
      // Was actually joined to a room: give it GRACE_MS to reconnect (see B2 in
      // docs/stateful_server_plan.md) before really removing it. A connection that never
      // finished joining has nothing to grace — leaveRoom is a no-op for it anyway.
      const key = graceKey(conn.roomSlug, conn.id);
      pendingRemoval.set(
        key,
        setTimeout(() => {
          persistPosition(conn);
          leaveRoom(conn);
          pendingRemoval.delete(key);
        }, GRACE_MS),
      );
    }
    const remaining = (connectionsByIp.get(ip) ?? 1) - 1;
    if (remaining <= 0) connectionsByIp.delete(ip);
    else connectionsByIp.set(ip, remaining);
  });
});

// Faza D / D1 (docs/stateful_server_plan.md): tick-loop duration per run, drained into a
// periodic log line below rather than kept forever — this is "minimal, log-based" observability,
// not a metrics stack; see the plan doc for why that's the right amount of effort for now.
let tickDurationsMs: number[] = [];

let last = Date.now();
setInterval(() => {
  const tickStart = Date.now();
  const now = tickStart;
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  // Respawns due this tick, resolved in their own pass before movement: a respawn moves a
  // connection from whatever room it died in into the lobby room's own Set (see leaveRoom/
  // joinRoom below), which would be unsafe to do mid-iteration of the per-room movement loop
  // right after this. Deleting/adding the *current* iterand of a Set (or the current key of the
  // outer Map, via leaveRoom's `rooms.delete` when a room empties out) during iteration is safe
  // per spec; a connection landing in a room this pass hasn't reached yet just gets picked up
  // next tick, and one already past is a no-op here since `respawnAt` is now 0.
  for (const set of rooms.values()) {
    for (const conn of set) {
      if (conn.respawnAt === 0 || now < conn.respawnAt) continue;
      leaveRoom(conn);
      conn.roomSlug = "lobby";
      conn.isLobby = true;
      const spawn = clampPos(worldW(true) / 2, worldH(true) / 2, true);
      conn.x = spawn.x;
      conn.y = spawn.y;
      conn.hp = MAX_HP;
      conn.respawnAt = 0;
      conn.immuneUntil = now + IMMUNITY_MS;
      // Ghost only exists for the respawn countdown that just ended — snap it back onto the body
      // so it isn't left dangling wherever the player last steered it (harmless either way, since
      // clients only read gx/gy/gd while respawnAt > 0, but this keeps it from being stale state).
      conn.gx = conn.x;
      conn.gy = conn.y;
      conn.gd = conn.d;
      joinRoom(conn);
      send(conn.ws, { type: "respawn_redirect" });
    }
  }
  for (const set of rooms.values()) {
    for (const conn of set) {
      if (isDead(conn)) {
        // Ghost movement: the body (x/y/d) stays frozen at the death spot for the whole respawn
        // countdown (the corpse), but the player still steers something — a ghost, at gx/gy/gd —
        // for the same RESPAWN_MS window (see PlayerState.gx/gy/gd's doc comment in
        // shared/types.ts). No roll/charge/fire/strike here: those message handlers already
        // reject while isDead(conn), so raw input is the only thing that can move a ghost — plain
        // walking, at the connection's normal speed, no cooldowns to respect.
        const gdx = conn.inputDx;
        const gdy = conn.inputDy;
        if (!gdx && !gdy) continue;
        if (gdx || gdy) conn.gd = DIR_OF[gdy + 1][gdx + 1] as Dir;
        const gnorm = gdx && gdy ? Math.SQRT1_2 : 1;
        const gnx = conn.gx + gdx * conn.speed * dt * gnorm;
        const gny = conn.gy + gdy * conn.speed * dt * gnorm;
        const gclamped = clampPos(gnx, gny, conn.isLobby);
        const gresolved = resolveObstacleMoveHitbox(conn.gx, conn.gy, gclamped.x, gclamped.y, obstaclesFor(conn.isLobby));
        conn.gx = gresolved.x;
        conn.gy = gresolved.y;
        continue;
      }
      // Work phase of this connection's own room: nobody moves (see isFrozen's doc comment) —
      // skip movement entirely, same as isDead above but without the ghost, so a stray in-flight
      // roll just resumes wherever it left off once the room thaws into "break".
      if (isFrozen(conn)) continue;
      const rolling = now < conn.rollUntil;
      const rawDx = conn.inputDx;
      const rawDy = conn.inputDy;
      // During a roll, movement follows the direction locked in when it started (rollDx/rollDy),
      // not whatever arrows are currently held. Facing (`d`) only follows raw arrow input, and
      // only outside of a roll — matching RoomStage.tsx's tick() exactly, so the reconciliation
      // below doesn't fight what the player just saw locally.
      const dx = rolling ? conn.rollDx : rawDx;
      const dy = rolling ? conn.rollDy : rawDy;
      if (!rolling && (rawDx || rawDy)) {
        conn.d = DIR_OF[rawDy + 1][rawDx + 1] as Dir;
      }
      if (!dx && !dy) continue;
      const norm = !rolling && dx && dy ? Math.SQRT1_2 : 1;
      const speed = conn.speed * (rolling ? ROLL_SPEED_MULT : 1);
      const nx = conn.x + dx * speed * dt * norm;
      const ny = conn.y + dy * speed * dt * norm;
      const clamped = clampPos(nx, ny, conn.isLobby);
      const resolved = resolveObstacleMoveHitbox(conn.x, conn.y, clamped.x, clamped.y, obstaclesFor(conn.isLobby));
      conn.x = resolved.x;
      conn.y = resolved.y;
    }
  }
  // One room-owned enemy's AI (see tickEnemy's doc comment) — after player movement so it always
  // chases this tick's positions, before the ball-physics pass below so a swing thrown just now
  // resolves in the same tick, exactly like a player's own strike would.
  for (const [slug, set] of rooms) {
    if (slug === ARENA_ROOM_SLUG) tickEnemy(slug, set, now, dt);
  }
  // Faza F3: ball/melee-hitbox physics and the single, authoritative "who got hit" decision —
  // same collision geometry as `hits()` in RoomStage.tsx, just decided once here instead of once
  // per client. `roomBalls`/`roomHits` are seeded lazily by spawnBall/spawnMelee, so a room with
  // no combat yet simply isn't in either map.
  for (const [slug, balls] of roomBalls) {
    const set = rooms.get(slug);
    if (!set || set.size === 0) continue; // leaveRoom() already cleans these up when it happens
    const isLobby = slug === "lobby";
    const worldWidth = worldW(isLobby);
    const worldHeight = worldH(isLobby);
    const obstacles = obstaclesFor(isLobby);
    const survivors: ServerBall[] = [];
    for (const b of balls) {
      if (b.until !== undefined && now > b.until) continue;
      if (!b.melee) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
      }
      // Large furniture (see LOBBY_OBSTACLES in shared/obstacles.ts) blocks a thrown ball/melee
      // hitbox exactly like it blocks a player — the ball is simply consumed here, same as flying
      // out of bounds, instead of passing through to whatever's on the other side.
      if (circleIntersectsObstacles(b.x, b.y, b.r, obstacles)) continue;
      let target: Conn | null = null;
      for (const conn of set) {
        if (conn.id === b.owner) continue;
        // Dead (mid-respawn-countdown) or still immune — untargetable, same as owner: the ball/
        // hitbox passes through instead of being consumed by a hit that can't do anything.
        if (isDead(conn) || now < conn.immuneUntil) continue;
        const nx = Math.max(conn.x + HITBOX_OFFSET_X - HIT_PAD, Math.min(b.x, conn.x + HITBOX_OFFSET_X + HITBOX_W + HIT_PAD));
        const ny = Math.max(conn.y + HITBOX_OFFSET_Y - HIT_PAD, Math.min(b.y, conn.y + HITBOX_OFFSET_Y + HITBOX_H + HIT_PAD));
        if (Math.hypot(b.x - nx, b.y - ny) <= b.r) {
          target = conn;
          break;
        }
      }
      // No player in the way: a live room enemy (see roomEnemies' doc comment) is the only other
      // thing this ball/hitbox can hit — never its own swing, same "skip the owner" rule as above.
      const enemy = target ? null : roomEnemies.get(slug);
      const enemyHit =
        enemy && enemy.deadUntil === 0 && b.owner !== enemy.id
          ? (() => {
              const nx = Math.max(enemy.x - HIT_PAD, Math.min(b.x, enemy.x + ENEMY_W + HIT_PAD));
              const ny = Math.max(enemy.y - HIT_PAD, Math.min(b.y, enemy.y + ENEMY_H + HIT_PAD));
              return Math.hypot(b.x - nx, b.y - ny) <= b.r;
            })()
          : false;
      if (enemyHit && enemy) {
        // Decided before mutating enemy.hp below, same "agree with the actual kill" reasoning as
        // the player-kill path just below — this is what the killer's own client uses to trigger
        // the "KILL"/reward callout (see the `killed` doc comment in shared/types.ts).
        const killed = enemy.hp > 0 && enemy.hp - b.dmg <= 0;
        const hits = roomHits.get(slug) ?? [];
        hits.push({
          targetId: enemy.id,
          ownerId: b.owner,
          melee: Boolean(b.melee),
          x: b.x,
          y: b.y,
          r: b.r,
          color: b.color,
          dmg: b.dmg,
          killed,
        });
        roomHits.set(slug, hits);
        enemy.hp = Math.max(0, enemy.hp - b.dmg);
        if (killed) {
          enemy.deadUntil = now + ENEMY_RESPAWN_MS;
          enemy.targetId = null;
          let owner: Conn | null = null;
          for (const c of set) {
            if (c.id === b.owner) {
              owner = c;
              break;
            }
          }
          // Same KILL_XP_REWARD/KILL_GOLD_REWARD as a PvP kill (see supabase/migrations/
          // 0030_mob_kills.sql) — counted separately as mob_kills, never paired with a
          // victimUserId (the enemy isn't a player with deaths to persist).
          void reportCombatEvent(owner?.userId ?? null, null, true);
        }
        continue; // one hit ends the ball/hitbox, same as hitting a player
      }
      if (target) {
        // Decided before mutating target.hp below, so the HitEvent (which the killer's own client
        // uses to trigger the "KILL"/reward callout — see the `killed` doc comment in
        // shared/types.ts) and the actual kill are always in agreement.
        const killed = !isLobby && target.hp > 0 && target.hp - b.dmg <= 0;
        const hits = roomHits.get(slug) ?? [];
        hits.push({
          targetId: target.id,
          ownerId: b.owner,
          melee: Boolean(b.melee),
          x: b.x,
          y: b.y,
          r: b.r,
          color: b.color,
          dmg: isLobby ? 0 : b.dmg,
          killed,
        });
        roomHits.set(slug, hits);
        // The lobby stays a safe space (see MAX_HP's doc comment in shared/constants.ts): the hit
        // still resolves and flashes for everyone, it just never costs HP or a life there.
        if (!isLobby) {
          target.hp = Math.max(0, target.hp - b.dmg);
          if (killed) {
            target.respawnAt = now + RESPAWN_MS;
            target.inputDx = 0;
            target.inputDy = 0;
            // The body (x/y/d) stays right where it dropped — that's the corpse. The ghost starts
            // out standing on top of it and is what the "input" handler actually moves from here
            // (see the isDead(conn) branch in the movement loop above) until the respawn fires.
            target.gx = target.x;
            target.gy = target.y;
            target.gd = target.d;
            let owner: Conn | null = null;
            for (const c of set) {
              if (c.id === b.owner) {
                owner = c;
                break;
              }
            }
            void reportCombatEvent(owner?.userId ?? null, target.userId ?? null);
          }
        }
        continue; // one hit ends the ball/hitbox, same as the client-only version did
      }
      if (b.melee) {
        survivors.push(b); // stays in place until `until`, checked again next tick
        continue;
      }
      if (b.x > -b.r && b.x < worldWidth + b.r && b.y > -b.r && b.y < worldHeight + b.r) survivors.push(b);
    }
    roomBalls.set(slug, survivors);
  }
  tickDurationsMs.push(Date.now() - tickStart);
}, TICK_MS);

setInterval(() => {
  const now = Date.now();
  for (const [slug, set] of rooms) {
    const players: PlayerState[] = [...set].map((c) => ({
      id: c.id,
      userId: c.userId,
      nick: c.nick,
      color: c.color,
      x: c.x,
      y: c.y,
      d: c.d,
      hp: c.hp,
      respawnAt: c.respawnAt,
      immuneUntil: c.immuneUntil,
      gx: c.gx,
      gy: c.gy,
      gd: c.gd,
      stamina: currentStamina(c, now),
      staminaMax: c.stats.staminaMax,
    }));
    const balls = roomBalls.get(slug) ?? [];
    // Drained, not cumulative — each hit is only ever sent once (Faza F3).
    const hits = roomHits.get(slug) ?? [];
    if (hits.length > 0) roomHits.set(slug, []);
    const roomEnemy = roomEnemies.get(slug);
    const enemies: EnemyState[] = roomEnemy
      ? [
          {
            id: roomEnemy.id,
            x: roomEnemy.x,
            y: roomEnemy.y,
            hp: roomEnemy.hp,
            maxHp: ENEMY_MAX_HP,
            state: roomEnemy.deadUntil > 0 ? "dead" : roomEnemy.targetId ? "chase" : "idle",
          },
        ]
      : [];
    const msg: ServerMessage = {
      type: "state",
      schemaVersion: SCHEMA_VERSION,
      players,
      balls,
      hits,
      enemies,
      at: Date.now(),
    };
    for (const conn of set) send(conn.ws, msg);
  }
}, BROADCAST_MS);

// Faza C / C2: periodic sweep, independent of the explicit saves on room-switch/grace-expiry
// above — covers the common case of "still sitting in the same room", and re-saving a frozen
// grace-period ghost's position here is harmless (same value each time).
setInterval(() => {
  const entries: Array<{ userId: string; room: string; x: number; y: number; d: number }> = [];
  for (const set of rooms.values()) {
    for (const conn of set) {
      if (conn.userId) entries.push({ userId: conn.userId, room: conn.roomSlug, x: conn.x, y: conn.y, d: conn.d });
    }
  }
  void savePositions(entries);
}, SAVE_EVERY_MS);

/**
 * Faza D / D1: one structured JSON line every METRICS_INTERVAL_MS — grep-able in `fly logs`.
 * Deliberately not a `/metrics` endpoint or an external metrics service yet (see docs/
 * stateful_server_plan.md, D1/D2): this Machine has never run under real load, so building
 * dashboards/alerts for numbers nobody has looked at would be guessing at what actually matters.
 * A restart-with-active-players alert (D2) needs an external monitor watching Fly itself (Machine
 * lifecycle events aren't visible from inside the process) — that's Fly dashboard/API
 * configuration, not something this file can set up.
 */
const METRICS_INTERVAL_MS = 30_000;
setInterval(() => {
  const totalPlayers = [...rooms.values()].reduce((sum, set) => sum + set.size, 0);
  const tickMsMax = tickDurationsMs.length ? Math.max(...tickDurationsMs) : 0;
  const tickMsAvg = tickDurationsMs.length ? tickDurationsMs.reduce((a, b) => a + b, 0) / tickDurationsMs.length : 0;
  tickDurationsMs = [];
  console.log(
    JSON.stringify({
      metric: "realtime_server_snapshot",
      at: new Date().toISOString(),
      activeRooms: rooms.size,
      totalPlayers,
      tickMsAvg: Math.round(tickMsAvg * 100) / 100,
      tickMsMax,
      rssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    }),
  );
  // Repeats the boot warning every interval (see PERSISTENCE_ENABLED above) so a misconfigured
  // deploy can't just scroll off the bottom of `fly logs` between the one boot line and whenever
  // someone happens to check — this is the loud-but-not-fatal middle ground.
  if (!PERSISTENCE_ENABLED) {
    console.error(
      "PERSISTENCE_API_URL/REALTIME_INTERNAL_SECRET still not set — positions still not being persisted, every spawn is (200,200)",
    );
  }
}, METRICS_INTERVAL_MS);

httpServer.listen(PORT, () => {
  // Distinctive on purpose: a human (or, later, a log-based alert rule — see D2 above) watching
  // Fly logs can spot "did this Machine just restart while players were connected?" just from
  // this line's timestamp reappearing unexpectedly, without any extra monitoring wired up yet.
  console.log(`realtime-server BOOT listening on ${PORT}`);
});
