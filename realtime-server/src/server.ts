import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { verifyEntryToken } from "../shared/entryToken";
import { clampPos } from "../shared/physics";
import { LOBBY_ZONE_RECTS } from "../shared/rooms";
import {
  BALL_SPEED,
  BROADCAST_MS,
  CHARGE_MS,
  DASH_COOLDOWN_MS,
  DASH_DISTANCE_MULT,
  DASH_MS,
  DASH_TELEPORT_AT_MS,
  DEFAULT_PLAYER_SPEED,
  DIRS,
  DIR_OF,
  EXIT_ZONE,
  HIT_PAD,
  MAX_BALLS_PER_PLAYER,
  ORB_R_MAX,
  ORB_R_MIN,
  PERSON_H,
  PERSON_W,
  ROLL_COOLDOWN_MS,
  ROLL_MS,
  ROLL_SPEED_MULT,
  SCHEMA_VERSION,
  STRIKE_COOLDOWN_MS,
  STRIKE_MS,
  STRIKE_R,
  STRIKE_REACH,
  TICK_MS,
  worldH,
  worldW,
} from "../shared/constants";
import type { ClientMessage, Dir, HitEvent, PlayerState, ServerBall, ServerMessage } from "../shared/types";

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

// Faza C / C1-C2 (docs/stateful_server_plan.md): fail loud at boot, same as REALTIME_SECRET —
// a silent (200,200)-spawn/no-persistence fallback here is exactly what made the missing Vercel
// deployment-protection bypass on the preview branch invisible for days (no boot warning survives
// scrolling Fly logs, and per-request failures were swallowed too). Local dev without Next.js
// wired up now needs these two set (see realtime-server/.env.example) rather than silently
// degrading.
const PERSISTENCE_API_URL = (() => {
  const url = process.env.PERSISTENCE_API_URL;
  if (!url) throw new Error("PERSISTENCE_API_URL is not set");
  return url;
})();
const REALTIME_INTERNAL_SECRET = (() => {
  const secret = process.env.REALTIME_INTERNAL_SECRET;
  if (!secret) throw new Error("REALTIME_INTERNAL_SECRET is not set");
  return secret;
})();
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
  // Faza F2 (docs/combat_sync_plan.md): roll/dash state the server tracks per connection, so it
  // can enforce cooldowns and compute position during a roll/dash itself instead of trusting the
  // client — the same reason `inputDx`/`inputDy` exist instead of a client-asserted position.
  // Direction/facing for both comes from `d` above (set by plain movement, held during roll/dash).
  rollUntil: number;
  rollCooldownUntil: number;
  rollDx: number;
  rollDy: number;
  dashUntil: number;
  dashCooldownUntil: number;
  dashTargetX: number;
  dashTargetY: number;
  dashTeleportAt: number;
  dashTeleported: boolean;
  // Faza F3: when the client last told us it started charging a ball (`{ type: "charge", on:
  // true }`), or null if it isn't charging (or never told us this connection). Caps `fire`'s
  // claimed `chargeMs` to what actually elapsed here, not to what the client claims elapsed.
  chargeStartAt: number | null;
  meleeCooldownUntil: number;
  // Normally always DEFAULT_PLAYER_SPEED — only ever different when DEV_OVERRIDES_ENABLED and the
  // client sent an `input.speedOverride` (admin panel), see the "input" handler below.
  speed: number;
};

const rooms = new Map<string, Set<Conn>>();
/** Live projectiles/melee hitboxes per room — Faza F3 (docs/combat_sync_plan.md). */
const roomBalls = new Map<string, ServerBall[]>();
/** Hits resolved since the last broadcast, drained into the next `state` message and cleared —
 * not cumulative, see the broadcast loop below. */
const roomHits = new Map<string, HitEvent[]>();
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
  }
}

let nextBallId = 0;

function countOwnedBalls(roomSlug: string, ownerId: string): number {
  const balls = roomBalls.get(roomSlug);
  if (!balls) return 0;
  let n = 0;
  for (const b of balls) if (b.owner === ownerId) n += 1;
  return n;
}

/** Shared by spawnBall/spawnMelee — enforces MAX_BALLS_PER_PLAYER (Faza F3's anti-spam limit;
 * see the constant's doc comment for why this is per-player rather than per-room). */
function pushBall(conn: Conn, ball: ServerBall) {
  if (countOwnedBalls(conn.roomSlug, conn.id) >= MAX_BALLS_PER_PLAYER) return;
  let balls = roomBalls.get(conn.roomSlug);
  if (!balls) {
    balls = [];
    roomBalls.set(conn.roomSlug, balls);
  }
  balls.push(ball);
}

/** Thrown ball above the connection's head, in its current facing direction — same math as
 * `launch()` in src/components/RoomStage.tsx. `p` is the charge fraction (0..1). */
function spawnBall(conn: Conn, p: number) {
  const [ux, uy] = DIRS[conn.d];
  const n = Math.hypot(ux, uy) || 1;
  const r = ORB_R_MIN + (ORB_R_MAX - ORB_R_MIN) * p;
  pushBall(conn, {
    id: `${conn.id}:${nextBallId++}`,
    x: conn.x + PERSON_W / 2,
    y: Math.max(r + 2, conn.y - r - 4),
    vx: (ux / n) * BALL_SPEED,
    vy: (uy / n) * BALL_SPEED,
    r,
    color: conn.color,
    owner: conn.id,
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
  try {
    const url = new URL("/api/internal/positions", PERSISTENCE_API_URL);
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
  if (entries.length === 0) return;
  try {
    const url = new URL("/api/internal/positions", PERSISTENCE_API_URL);
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
  let resumeFrom: { x: number; y: number; d: Dir } | null = null;
  const targetSet = rooms.get(verified.roomSlug);
  if (targetSet) {
    for (const other of targetSet) {
      if (other !== conn && other.id === newId) {
        resumeFrom = { x: other.x, y: other.y, d: other.d };
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
  const resolved = resumeFrom ?? loaded;
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
  joinRoom(conn);
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
    dashUntil: 0,
    dashCooldownUntil: 0,
    dashTargetX: 0,
    dashTargetY: 0,
    dashTeleportAt: 0,
    dashTeleported: true,
    chargeStartAt: null,
    meleeCooldownUntil: 0,
    speed: DEFAULT_PLAYER_SPEED,
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
      const now = Date.now();
      if (now >= conn.rollCooldownUntil && now >= conn.dashUntil) {
        const [ux, uy] = DIRS[conn.d];
        const n = Math.hypot(ux, uy) || 1;
        conn.rollDx = ux / n;
        conn.rollDy = uy / n;
        conn.rollUntil = now + ROLL_MS;
        conn.rollCooldownUntil = conn.rollUntil + ROLL_COOLDOWN_MS;
      }
      return;
    }
    if (msg.type === "dash") {
      const now = Date.now();
      if (now >= conn.dashCooldownUntil && now >= conn.rollUntil) {
        const [ux, uy] = DIRS[conn.d];
        const n = Math.hypot(ux, uy) || 1;
        const dashDistance = conn.speed * ROLL_SPEED_MULT * (ROLL_MS / 1000) * DASH_DISTANCE_MULT;
        const target = clampPos(conn.x + (ux / n) * dashDistance, conn.y + (uy / n) * dashDistance, conn.isLobby);
        conn.dashTargetX = target.x;
        conn.dashTargetY = target.y;
        conn.dashTeleportAt = now + DASH_TELEPORT_AT_MS;
        conn.dashUntil = now + DASH_MS;
        conn.dashCooldownUntil = conn.dashUntil + DASH_COOLDOWN_MS;
        conn.dashTeleported = false;
      }
      return;
    }
    // Faza F3: marks when charging actually started here, so `fire` below can't claim more than
    // really elapsed.
    if (msg.type === "charge") {
      conn.chargeStartAt = msg.on === true ? Date.now() : null;
      return;
    }
    if (msg.type === "fire") {
      const now = Date.now();
      const elapsed = conn.chargeStartAt !== null ? now - conn.chargeStartAt : 0;
      const claimed = typeof msg.chargeMs === "number" && Number.isFinite(msg.chargeMs) ? msg.chargeMs : 0;
      const chargeMs = Math.max(0, Math.min(CHARGE_MS, Math.min(elapsed, claimed)));
      conn.chargeStartAt = null;
      spawnBall(conn, chargeMs / CHARGE_MS);
      return;
    }
    if (msg.type === "strike") {
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
  for (const set of rooms.values()) {
    for (const conn of set) {
      // Faza F2 (docs/combat_sync_plan.md): dash is a delayed teleport (see spawnBall/dash
      // handler above) — the jump happens once, at dashTeleportAt, not gradually like a roll.
      const dashing = now < conn.dashUntil;
      if (dashing && !conn.dashTeleported && now >= conn.dashTeleportAt) {
        const clamped = clampPos(conn.dashTargetX, conn.dashTargetY, conn.isLobby);
        conn.x = clamped.x;
        conn.y = clamped.y;
        conn.dashTeleported = true;
      }
      const rolling = !dashing && now < conn.rollUntil;
      const rawDx = conn.inputDx;
      const rawDy = conn.inputDy;
      // During a roll, movement follows the direction locked in when it started (rollDx/rollDy),
      // not whatever arrows are currently held; during a dash there's no continuous movement at
      // all (the teleport above is the only position change). Facing (`d`) only follows raw
      // arrow input, and only outside of both — matching RoomStage.tsx's tick() exactly, so the
      // reconciliation below doesn't fight what the player just saw locally.
      const dx = dashing ? 0 : rolling ? conn.rollDx : rawDx;
      const dy = dashing ? 0 : rolling ? conn.rollDy : rawDy;
      if (!rolling && !dashing && (rawDx || rawDy)) {
        conn.d = DIR_OF[rawDy + 1][rawDx + 1] as Dir;
      }
      if (!dx && !dy) continue;
      const norm = !rolling && dx && dy ? Math.SQRT1_2 : 1;
      const speed = conn.speed * (rolling ? ROLL_SPEED_MULT : 1);
      const nx = conn.x + dx * speed * dt * norm;
      const ny = conn.y + dy * speed * dt * norm;
      const clamped = clampPos(nx, ny, conn.isLobby);
      conn.x = clamped.x;
      conn.y = clamped.y;
    }
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
    const survivors: ServerBall[] = [];
    for (const b of balls) {
      if (b.until !== undefined && now > b.until) continue;
      if (!b.melee) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
      }
      let target: Conn | null = null;
      for (const conn of set) {
        if (conn.id === b.owner) continue;
        const nx = Math.max(conn.x - HIT_PAD, Math.min(b.x, conn.x + PERSON_W + HIT_PAD));
        const ny = Math.max(conn.y - HIT_PAD, Math.min(b.y, conn.y + PERSON_H + HIT_PAD));
        if (Math.hypot(b.x - nx, b.y - ny) <= b.r) {
          target = conn;
          break;
        }
      }
      if (target) {
        const hits = roomHits.get(slug) ?? [];
        hits.push({ targetId: target.id, ownerId: b.owner, melee: Boolean(b.melee), x: b.x, y: b.y, r: b.r, color: b.color });
        roomHits.set(slug, hits);
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
  for (const [slug, set] of rooms) {
    const players: PlayerState[] = [...set].map((c) => ({
      id: c.id,
      userId: c.userId,
      nick: c.nick,
      color: c.color,
      x: c.x,
      y: c.y,
      d: c.d,
    }));
    const balls = roomBalls.get(slug) ?? [];
    // Drained, not cumulative — each hit is only ever sent once (Faza F3).
    const hits = roomHits.get(slug) ?? [];
    if (hits.length > 0) roomHits.set(slug, []);
    const msg: ServerMessage = {
      type: "state",
      schemaVersion: SCHEMA_VERSION,
      players,
      balls,
      hits,
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
}, METRICS_INTERVAL_MS);

httpServer.listen(PORT, () => {
  // Distinctive on purpose: a human (or, later, a log-based alert rule — see D2 above) watching
  // Fly logs can spot "did this Machine just restart while players were connected?" just from
  // this line's timestamp reappearing unexpectedly, without any extra monitoring wired up yet.
  console.log(`realtime-server BOOT listening on ${PORT}`);
});
