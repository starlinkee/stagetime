/**
 * Single source of truth for movement constants shared between this server and the client
 * (imported from src/components/RoomStage.tsx via a relative path — see README.md in this
 * folder). Values must match RoomStage.tsx exactly, or client-side prediction/rendering will
 * visibly disagree with what the server decides.
 */

import type { CharacterStats } from "./types";

export const SCREEN_W = 1366;
export const SCREEN_H = 768;
export const PERSON_W = 32;
export const PERSON_H = 48;
export const TAG_H = 26;

/** World units per second — matches DEFAULT_ADMIN_SETTINGS.playerSpeed in src/lib/adminSettings.ts. */
export const DEFAULT_PLAYER_SPEED = 220;

export function worldW(isLobby: boolean): number {
  return isLobby ? SCREEN_W * 2 : SCREEN_W;
}

export function worldH(isLobby: boolean): number {
  return isLobby ? SCREEN_H * 2 : SCREEN_H;
}

/**
 * Exit/entry zone every non-lobby room has — must match EXIT_ZONE in src/lib/rooms.ts exactly.
 * A fresh entry into any such room (no reconnect ghost to resume from) always lands at its
 * center, regardless of any saved position, so the player can hold E right away to walk back out
 * the same way they came in — see spawnZoneSlug in RoomStage.tsx.
 */
export const EXIT_ZONE = { x: 690, y: 60, w: 220, h: 140 } as const;

export const DIR_DOWN = 2 as const;

/** 8-direction vectors, order matches Dir: E, SE, S, SW, W, NW, N, NE. */
export const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/** Direction from a movement vector: DIR_OF[dy + 1][dx + 1]. */
export const DIR_OF: ReadonlyArray<ReadonlyArray<number>> = [
  [5, 6, 7],
  [4, DIR_DOWN, 0],
  [3, 2, 1],
];

/** Simulation tick rate. */
export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;

/** How often the server broadcasts a state snapshot to clients in a room. */
export const BROADCAST_MS = 50;

/**
 * Bumped whenever the shape of `RoomState`/`ServerMessage` changes incompatibly. Not enforced at
 * runtime today — the deploy strategy is "deploy while rooms are empty" (see Krok 7 in
 * docs/stateful_server_plan.md), which sidesteps the need for a client that understands two
 * versions at once. Carried in every `state` message mainly so that a future stricter check (or
 * just debugging "why do these two Machines disagree") has something to look at without a
 * redeploy.
 */
export const SCHEMA_VERSION = 1;

/**
 * Combat/roll/dash tuning — single source of truth for this server and src/components/
 * RoomStage.tsx (see docs/combat_sync_plan.md, Faza F1). Values must match RoomStage.tsx exactly:
 * this is what let movement drift silently before A2 in docs/stateful_server_plan.md, and the
 * same risk applies here.
 */

/** How long holding Space (charge attack) takes to reach full charge. */
export const CHARGE_MS = 3000;
/** Roll (C): short, fast burst in the facing direction, faster than normal walking. */
export const ROLL_SPEED_MULT = 2.5;
export const ROLL_MS = 240;
/** How long after a roll ends before another one can start. */
export const ROLL_COOLDOWN_MS = 260;
/** Dash (V): a further, instant teleport in the facing direction, no distance covered on the way. */
export const DASH_DISTANCE_MULT = 1.8;
export const DASH_MS = 220;
export const DASH_TELEPORT_AT_MS = DASH_MS / 2;
/** Dash cooldown is 4x the roll cooldown. */
export const DASH_COOLDOWN_MS = ROLL_COOLDOWN_MS * 4;
/** Charged-ball radius range — interpolated by charge fraction (0..1). */
export const ORB_R_MIN = 5;
export const ORB_R_MAX = 30;
/** Thrown-ball flight speed, px/s. */
export const BALL_SPEED = 520;
/** Melee (fist swing, key 1): short reach, no charge, hits immediately on press. */
export const STRIKE_REACH = 22;
export const STRIKE_R = 20;
export const STRIKE_MS = 150;
/** Cooldown between melee swings. */
export const STRIKE_COOLDOWN_MS = 260;
/** Character hitbox padding used by ball/melee collision checks. */
export const HIT_PAD = 4;
/**
 * Concurrent projectiles/melee hitboxes allowed per player at once — the anti-spam mechanism
 * called for in docs/combat_sync_plan.md Faza F3 (resolves open question 3 in that doc: chosen
 * per-player rather than per-room, since it composes with MAX_PLAYERS_PER_ROOM to give an
 * implicit room-wide ceiling — 50 players x 3 balls — without a second, redundant counter).
 * This is a *default*, not a hardcoded ceiling: it's the `maxProjectiles` every connection starts
 * with in `DEFAULT_CHARACTER_STATS` below, which an item or character choice can later raise per
 * connection (see `Conn.stats` in server.ts).
 */
export const MAX_BALLS_PER_PLAYER = 3;
/** Salvo cooldown, not a per-shot one: a connection can fire MAX_BALLS_PER_PLAYER shots back to
 * back, and only once it's used all of them does this cooldown start — see the "fire" handler
 * (shotsFired/fireCooldownUntil) in server.ts, and its mirror in RoomStage.tsx's release(). Also
 * just a default; see `DEFAULT_CHARACTER_STATS`. */
export const FIRE_COOLDOWN_MS = 1800;

/**
 * Every connection's stats until character selection exists (see AGENTS.md's 2026-09-23 note:
 * no character classes/items yet) — copied into `Conn.stats` per connection (never shared by
 * reference, so a future per-connection item bonus can mutate its own copy without touching this
 * default or any other connection's stats).
 */
export const DEFAULT_CHARACTER_STATS: CharacterStats = {
  moveSpeed: DEFAULT_PLAYER_SPEED,
  maxProjectiles: MAX_BALLS_PER_PLAYER,
  fireCooldownMs: FIRE_COOLDOWN_MS,
  attackPower: 1,
};

/**
 * HP/damage/respawn — combat only deals damage outside the lobby (a decision made when this was
 * added: the lobby stays a safe social space, balls/melee still fly and visually hit there, but
 * `isLobbyRoom` in server.ts skips the HP subtraction). Every connection starts and respawns at
 * `MAX_HP`.
 */
export const MAX_HP = 50;
/** Charged-throw damage range — interpolated by charge fraction (0..1), same `p` spawnBall already
 * uses for `ORB_R_MIN`/`ORB_R_MAX`. */
export const DMG_MIN = 1;
export const DMG_MAX = 5;
/** Melee has no charge to scale off of, so it deals a fixed, mid-range hit. */
export const STRIKE_DMG = 3;
/** How long a dead connection is frozen (no movement/actions) before respawning. */
export const RESPAWN_MS = 5000;
/** Grace window after respawning during which a connection can't be damaged or targeted. */
export const IMMUNITY_MS = 5000;
/** Client-side rendering hint: sprite opacity while `now < immuneUntil`. */
export const IMMUNE_OPACITY = 0.4;
/** Client-side rendering hint: sprite opacity for a ghost (dead player, controllable for
 * RESPAWN_MS — see PlayerState.gx/gy/gd's doc comment in shared/types.ts). */
export const GHOST_OPACITY = 0.35;

/**
 * Kill reward shown to the killer only (as "+N xp"/"+N gold" text next to the big "KILL" callout,
 * see the `killed` flag on HitEvent in shared/types.ts) and actually credited to their account via
 * src/app/api/internal/combat/route.ts. A single source for both so the number on screen always
 * matches what actually lands in Postgres.
 */
export const KILL_XP_REWARD = 1;
export const KILL_GOLD_REWARD = 5;
