export type Dir = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * Per-connection combat/movement stats — everyone gets `DEFAULT_CHARACTER_STATS` (see
 * constants.ts) today, since there's no character-class selection yet, but every server-side
 * rule that used to read a single global constant now reads a connection's own `stats` instead,
 * so a future character choice (or a stat-boosting item) only has to compute a different
 * `CharacterStats` per connection — no other code needs to change.
 */
export interface CharacterStats {
  /** World units per second. Replaces the old flat DEFAULT_PLAYER_SPEED. */
  moveSpeed: number;
  /** Concurrent projectiles/melee hitboxes this connection may have in flight at once — see
   * MAX_BALLS_PER_PLAYER's doc comment in constants.ts for why this is per-player. */
  maxProjectiles: number;
  /** Minimum time between this connection's own shots, regardless of charge. */
  fireCooldownMs: number;
  /** Multiplier applied to a shot's/strike's base damage (see spawnBall/spawnMelee in
   * server.ts). 1 = base damage, unmodified. */
  attackPower: number;
}

export interface PlayerState {
  id: string;
  userId: string | null;
  nick: string | null;
  color: string;
  x: number;
  y: number;
  d: Dir;
  /** Current HP (0..MAX_HP, see constants.ts). Damage only ever happens outside the lobby. */
  hp: number;
  /** 0 while alive; otherwise the epoch ms this connection respawns at (client shows a countdown). */
  respawnAt: number;
  /** 0/past while not immune; otherwise the epoch ms immunity (post-respawn) ends — client renders
   * reduced opacity for anyone still under it, not just itself. */
  immuneUntil: number;
  /**
   * Ghost position/facing, meaningful only while `respawnAt > 0` (see RESPAWN_MS in constants.ts):
   * on death the body freezes at `x`/`y`/`d` (the corpse, still shown there), and the player keeps
   * moving as a ghost at `gx`/`gy`/`gd` for the rest of the respawn countdown — visible to both the
   * dead player and everyone else. Stale (last life's values) while alive; clients only read these
   * when `respawnAt > 0`.
   */
  gx: number;
  gy: number;
  gd: Dir;
}

/**
 * The four player-triggered combat/movement actions the server decides on, per
 * docs/combat_sync_plan.md (Faza F1) — not consumed by any single generic dispatcher today (the
 * cooldown rules differ too much per kind for that), but named here so `ClientMessage`'s combat
 * variants and any future per-kind bookkeeping share one vocabulary instead of drifting.
 */
export type AttackKind = "roll" | "dash" | "fire" | "strike";

/**
 * A live projectile (thrown ball) or melee hitbox, decided and simulated server-side (Faza F3).
 * `owner` is the acting connection's `id` (matches `PlayerState.id`) — used to exclude the
 * shooter from their own collision check, exactly like `Ball.owner` in RoomStage.tsx today.
 * `melee` hitboxes don't move (`vx`/`vy` are 0) and disappear at `until` instead of leaving the
 * world bounds.
 */
export interface ServerBall {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  owner: string;
  melee?: boolean;
  until?: number;
  /** Damage this ball/hitbox deals on impact — fixed for melee (STRIKE_DMG), scaled by charge
   * fraction for a thrown ball (DMG_MIN..DMG_MAX), decided once at spawn (see spawnBall/spawnMelee
   * in server.ts) rather than recomputed from `r` at hit time. */
  dmg: number;
}

/**
 * One resolved hit, broadcast in the same `state` message as the ball list (Faza F3, open
 * question 2 in docs/combat_sync_plan.md — resolved as "in `state`", not a separate message type:
 * simpler than maintaining a second wire format for something already this infrequent relative to
 * `BROADCAST_MS`). Carries the impact position/radius/color (not just the target id) so the
 * client can draw a particle burst at the actual point of impact without needing the `ServerBall`
 * that caused it — that ball no longer exists by the time this event is sent, since the server
 * removes it in the same tick it resolves the hit.
 */
export interface HitEvent {
  targetId: string;
  ownerId: string;
  melee: boolean;
  x: number;
  y: number;
  r: number;
  color: string;
  /** HP actually removed by this hit (0 in the lobby, which stays a safe space — see MAX_HP's
   * doc comment in shared/constants.ts). Lets the client show a floating damage number without
   * having to look up the `ServerBall`, which is already gone by the time this event is sent. */
  dmg: number;
  /** True when this hit brought `targetId` to 0 HP — the killing blow. Lets `ownerId`'s own client
   * show the "KILL" callout and reward text (see KILL_XP_REWARD/KILL_GOLD_REWARD in
   * shared/constants.ts) without having to diff HP itself. Always false in the lobby (no damage
   * there, see `dmg` above). */
  killed: boolean;
}

/**
 * Messages the client sends. `dx`/`dy` are movement *intent*, not a position — the server is
 * the one that turns intent into a position (speed clamp, world-bounds clamp), which is the
 * entire point of this server existing (see docs/stateful_server_plan.md).
 *
 * `join` carries a signed `token` (see entryToken.ts) instead of a client-asserted `userId`/
 * `roomSlug` — the server derives both from the token it verifies, never from the client
 * directly (Faza A / A1 in docs/stateful_server_plan.md). `fromRoomSlug` is a request, not an
 * assertion, exactly like `roll`/`dash` below: when joining "lobby" fresh (no reconnect ghost),
 * it names the room this player just left, so the server can spawn them at that room's own lobby
 * zone (see LOBBY_ZONE_RECTS in rooms.ts) instead of a generic default. An unrecognized or absent
 * value just falls back to that default — it's never trusted as raw coordinates.
 *
 * `roll`/`dash` carry no coordinates or direction — the server derives both from the connection's
 * own last-known facing (`conn.d`) and position, exactly like `input`'s dx/dy are a request, not
 * an assertion (Faza F2 in docs/combat_sync_plan.md). `charge` marks when charging started/
 * stopped so the server can independently cap `fire`'s claimed `chargeMs`; `strike` needs no
 * payload beyond the request itself (Faza F3).
 */
export type ClientMessage =
  | { type: "join"; id: string; token: string; nick: string | null; color: string; fromRoomSlug?: string | null }
  | {
      type: "input";
      dx: -1 | 0 | 1;
      dy: -1 | 0 | 1;
      /**
       * Admin-panel `playerSpeed` debug override (see src/lib/adminSettings.ts). The server only
       * honors this outside production (see DEV_OVERRIDES_ENABLED in server.ts) — a real client
       * can't otherwise change its own speed, that would defeat the entire point of this server.
       */
      speedOverride?: number;
    }
  | { type: "roll" }
  | { type: "dash" }
  | { type: "charge"; on: boolean }
  | { type: "fire"; chargeMs: number }
  | { type: "strike" }
  /**
   * Sent whenever the client's own nick/color changes after `join` already went out — most
   * commonly because the profile fetch (see useMyProfile's DEFAULT_COLOR fallback) resolves after
   * the WebSocket connects. Updates this connection's `nick`/`color` in place; never touches
   * position, unlike re-sending `join` would (see handleJoin in server.ts).
   */
  | { type: "profile"; nick: string | null; color: string };

export type ServerMessage =
  | { type: "welcome"; id: string }
  | {
      type: "state";
      schemaVersion: number;
      players: PlayerState[];
      balls: ServerBall[];
      hits: HitEvent[];
      at: number;
    }
  | { type: "join_rejected"; reason: "room_full" }
  /**
   * Sent only to the one connection that just respawned (never part of `state`) — the server has
   * already moved it into the lobby room server-side (position/hp/immunity reset), but rooms are
   * separate Next.js routes (see AGENTS.md), so only the client's own router can actually navigate
   * its page there. RoomStage.tsx reacts by router.push("/"); the new page's own `join` then
   * resumes from the ghost this leaves behind, same as any other reconnect (see B2 in
   * docs/stateful_server_plan.md).
   */
  | { type: "respawn_redirect" };
