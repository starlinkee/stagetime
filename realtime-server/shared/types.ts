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
  /** Full stamina pool this connection's `fire` draws from — see `staminaCostPerShot`/
   * `staminaRegenPerSec` and STAMINA_MAX's doc comment in constants.ts for the model. */
  staminaMax: number;
  /** Stamina spent per `fire`; a shot is refused (see the "fire" handler in server.ts) while the
   * connection's current stamina is below this. */
  staminaCostPerShot: number;
  /** Stamina regenerated per second, continuously (not per-tick) — see STAMINA_REGEN_PER_SEC's
   * doc comment in constants.ts. */
  staminaRegenPerSec: number;
  /** Multiplier applied to a shot's/slash's base damage (see spawnBall/spawnSlash in
   * server.ts). 1 = base damage, unmodified. */
  attackPower: number;
  /** This connection's own HP ceiling (STU-77: base MAX_HP plus any equipped helm's bonus, see
   * EQUIPMENT_ITEMS in constants.ts). Conn.hp is clamped to this, not the global MAX_HP, once
   * equipment can raise it. */
  maxHp: number;
  /** Fraction (0..1) of incoming damage this connection ignores (STU-77: from an equipped armor
   * piece, see EQUIPMENT_ITEMS in constants.ts). 0 = no reduction, unmodified damage. Applied once,
   * where a ball/slash actually subtracts from a player's hp — never to enemy/dummy hp, which have
   * no CharacterStats of their own. */
  damageReduction: number;
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
  /** This connection's current fire stamina (0..staminaMax), computed lazily from a timestamp —
   * see `currentStamina` in server.ts — not ticked per-frame server-side. Drives the green meter
   * under the health bar in RoomStage.tsx. */
  stamina: number;
  /** This connection's own stamina pool size — a per-character/item stat (see CharacterStats in
   * this file), not a global constant, so the client can't just read STAMINA_MAX itself. */
  staminaMax: number;
  /** This connection's own HP ceiling — a per-character/item stat (see CharacterStats.maxHp,
   * STU-77's helm equip bonus), not the global MAX_HP constant, same reasoning as staminaMax
   * above: the client can't just read MAX_HP itself once a helm can raise it. */
  maxHp: number;
}

/**
 * The player-triggered combat/movement actions the server decides on, per
 * docs/combat_sync_plan.md (Faza F1) — not consumed by any single generic dispatcher today (the
 * cooldown rules differ too much per kind for that), but named here so `ClientMessage`'s combat
 * variants and any future per-kind bookkeeping share one vocabulary instead of drifting.
 */
export type AttackKind = "roll" | "fire" | "slash" | "shuriken" | "fireball";

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
  /** Facing angle (radians) the melee hitbox was spawned at — only set when `melee` is true. Lets
   * the client draw a directional slash swipe instead of a symmetric orb, without having to look
   * up the owner's current facing (which may have turned since the swing was spawned). Never used
   * for hit-testing/physics, purely a rendering hint (STU-61). */
  angle?: number;
  until?: number;
  /** Damage this ball/hitbox deals on impact — fixed for melee (SLASH_DMG), scaled by charge
   * fraction for a thrown ball (DMG_MIN..DMG_MAX), decided once at spawn (see spawnBall/spawnSlash
   * in server.ts) rather than recomputed from `r` at hit time. */
  dmg: number;
  /** Weapon slot 3: renders as a spinning shuriken instead of an orb — purely a rendering hint,
   * never used for hit-testing/physics, same role `melee` plays for the slash swipe. Flies exactly
   * like a thrown ball (see spawnShuriken in server.ts), just faster and for a fixed damage. */
  shuriken?: boolean;
  /** Weapon slot 4: renders as one of a small set of fireball sprite frames (see
   * FIREBALL_TIER_COUNT/fireballTier in shared/constants.ts) instead of the continuous orb glow —
   * purely a rendering hint, never used for hit-testing/physics. Flies exactly like a thrown ball
   * (see spawnFireball in server.ts), charged the same way over a much longer FIREBALL_CHARGE_MS. */
  fireball?: boolean;
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
 * assertion, exactly like `roll` below: when joining "lobby" fresh (no reconnect ghost),
 * it names the room this player just left, so the server can spawn them at that room's own lobby
 * zone (see LOBBY_ZONE_RECTS in rooms.ts) instead of a generic default. An unrecognized or absent
 * value just falls back to that default — it's never trusted as raw coordinates.
 *
 * `roll` carries no coordinates or direction — the server derives both from the connection's
 * own last-known facing (`conn.d`) and position, exactly like `input`'s dx/dy are a request, not
 * an assertion (Faza F2 in docs/combat_sync_plan.md). `charge` marks when charging started/
 * stopped so the server can independently cap `fire`'s claimed `chargeMs`; `slash` needs no
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
      /**
       * Admin-panel `staminaRegenPerSec` debug override (see src/lib/adminSettings.ts), same gate
       * (DEV_OVERRIDES_ENABLED) and shape as `speedOverride` above — mutates this connection's own
       * `stats.staminaRegenPerSec` instead of the global STAMINA_REGEN_PER_SEC constant.
       */
      staminaRegenOverride?: number;
      /**
       * Admin-panel per-weapon stat overrides (see AdminSettings in src/lib/adminSettings.ts) —
       * same dev-only gate as speedOverride/staminaRegenOverride above (DEV_OVERRIDES_ENABLED in
       * server.ts). Each field only overrides this one connection's own copy (Conn.weapons in
       * server.ts), never a shared/global default; any field left out keeps its current value.
       */
      weapons?: {
        ballSpeed?: number;
        ballDmgMin?: number;
        ballDmgMax?: number;
        slashDmg?: number;
        slashCooldownMs?: number;
        shurikenDmg?: number;
        shurikenSpeed?: number;
        shurikenCooldownMs?: number;
      };
    }
  | { type: "roll" }
  | { type: "charge"; on: boolean }
  | { type: "fire"; chargeMs: number }
  | { type: "slash" }
  /**
   * Weapon slot 3: a request, not an assertion, same shape as `slash` above — the server derives
   * direction/position from this connection's own `d`/`x`/`y`. Ammo (does this connection's player
   * have one left) is NOT checked here — that's a Postgres concern the client already resolved via
   * consume_shuriken_ammo before sending this (see supabase/migrations/0040_shuriken_ammo.sql,
   * same "ownership is Postgres, *use* is realtime-server" split as `useItem`/flashGrenade below);
   * `shurikenCooldownUntil` in server.ts is only defense-in-depth against resending faster than
   * that round-trip.
   */
  | { type: "shuriken" }
  /**
   * Weapon slot 4: charge-and-throw, same request shape as `fire` above — the server derives
   * direction/position from this connection's own `d`/`x`/`y` and independently caps `chargeMs`
   * against how long `charge: { on: true }` actually elapsed, this time against
   * FIREBALL_CHARGE_MS (shared/constants.ts) instead of CHARGE_MS. Shares the same `charge`
   * message/`conn.chargeStartAt` as `fire` — only one charge-and-throw attack can be held at a
   * time client-side (see the weapon hotbar in RoomStage.tsx), so there's no ambiguity about which
   * one a given `charge`/release pair belongs to.
   */
  | { type: "fireball"; chargeMs: number }
  /**
   * STU-45: one of EMOJI_EMOTES (shared/constants.ts). Unlike roll/charge/fire/slash this is
   * accepted during the work phase too — see isFrozen's doc comment in server.ts — so it never
   * moves anything and only needs a cooldown, not position/physics validation.
   */
  | { type: "emote"; emoji: string }
  /**
   * STU-35: "I'm using this item right now" — a request, not an assertion, same as `roll`/
   * `startSession` above. The server alone decides whether it actually broadcasts an effect (see
   * FLASH_GRENADE_COOLDOWN_MS's doc comment in server.ts); *owning* one is checked separately, by
   * the client against Postgres (see consume_flash_grenade in
   * supabase/migrations/0037_flash_grenade_item.sql) before it ever sends this message — this
   * message only gates the shared, room-wide effect, not the stock. `"potionOfSwiftness"` is the
   * first consumable item (see POTION_OF_SWIFTNESS_* in shared/constants.ts) — unlike flashGrenade
   * it's not purely cosmetic, it starts a real, timed +50% move-speed buff for this connection
   * alone (see `swiftUntil` in server.ts), so it isn't broadcast room-wide the way `itemEffect`
   * below is for flashGrenade.
   */
  | { type: "useItem"; item: "flashGrenade" | "potionOfSwiftness" }
  /**
   * STU-58: held for START_HOLD_MS on the room's center action zone. A request, not an assertion,
   * same as `roll` above — the server alone decides whether this connection's current room
   * instance is actually a pomodoro door still in `waiting` (see PomodoroInstance in server.ts);
   * anything else (already started, not a pomodoro room, or the client is lying about the hold
   * duration) is silently ignored, exactly like `roll` during its own cooldown.
   */
  | { type: "startSession" }
  /**
   * Sent whenever the client's own nick/color changes after `join` already went out — most
   * commonly because the profile fetch (see useMyProfile's DEFAULT_COLOR fallback) resolves after
   * the WebSocket connects. Updates this connection's `nick`/`color` in place; never touches
   * position, unlike re-sending `join` would (see handleJoin in server.ts).
   */
  | { type: "profile"; nick: string | null; color: string }
  /**
   * A request, not an assertion, same as `roll`/`startSession` above: `id` names one of
   * LOBBY_LAMPS' own ids (shared/obstacles.ts). The server alone decides whether this connection
   * is actually standing close enough (LAMP_INTERACT_RADIUS in shared/constants.ts) and whether
   * this room even has lamps at all (lobby only) before flipping that lamp's state and
   * broadcasting it to the room in the next "state" message's `lamps` field.
   */
  | { type: "toggleLamp"; id: string }
  /**
   * Proximity voice chat: an opaque WebRTC signaling payload (SDP offer/answer or a trickled
   * ICE candidate) addressed to one other connection id in the same room. realtime-server never
   * inspects `data`, only relays it — the actual audio is peer-to-peer (WebRTC), never touching
   * this server. `to` is a request, not an assertion: the server only relays when `to` names a
   * connection actually in this connection's own room right now (see the "voiceSignal" handler
   * in server.ts), same "same room only" reasoning as toggleLamp above.
   */
  | { type: "voiceSignal"; to: string; data: unknown };

/**
 * One room-owned enemy (see ARENA_ROOM_SLUG/ENEMY_* in shared/constants.ts) — everyone in the
 * room can hurt it (its own melee swings go through the same `ServerBall`/hit pipeline as a
 * player's) and it can hurt everyone back (spawns its own melee `ServerBall`, owner set to its
 * own `id`). `state` is purely a rendering hint (idle/chase spins no animation today, but a future
 * sprite easily could); the server alone decides targeting/movement/attacks.
 */
export interface EnemyState {
  id: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  state: "idle" | "chase" | "attack" | "dead";
}

/**
 * STU-40: a stationary training target, same room-owned-entity shape as EnemyState above but
 * unlike it, `hp` is meant to be shown as a plain number, not just an HP-bar fraction — see
 * DUMMY_MAX_HP's doc comment in shared/constants.ts for why it never resets except on an actual
 * kill. `dead` (mid-respawn, see DUMMY_RESPAWN_MS) is the only rendering hint it needs — it never
 * moves or attacks, so there's no idle/chase/attack state to track.
 */
export interface DummyState {
  id: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dead: boolean;
}

/**
 * STU-58: a pomodoro room instance's own session state, carried in the `state` message of every
 * connection inside it (`null`/absent for lobby, stopwatch, shop, arena — no session there).
 * `startedAt` is `null` while `state === "waiting"`; once work starts it's the epoch ms `work`
 * began, and every client derives its own remaining-time countdown from that plus `workMin`/
 * `breakMin`, same pattern as the old getTimerState but instance-relative instead of EPOCH_MS
 * -relative (see PomodoroInstance in server.ts).
 */
export interface PomodoroSessionState {
  state: "waiting" | "work" | "break";
  startedAt: number | null;
  workMin: number;
  breakMin: number;
}

export type ServerMessage =
  | { type: "welcome"; id: string }
  | {
      type: "state";
      schemaVersion: number;
      /**
       * Bandwidth: full snapshot only for a connection that just landed in this room
       * (`full: true`, see `needsFullState` in server.ts); every other tick, only players whose
       * PlayerState actually changed since this room's last broadcast (`full: false`/absent). A
       * player who left simply stops appearing — RoomStage.tsx never inferred room membership
       * from this list (Supabase Presence owns that), only updated whichever ids showed up in it,
       * so omitting an unchanged id is already indistinguishable from omitting a departed one.
       * Balls/hits/enemies stay full every tick — already small (Faza F3), and hits are already
       * drained-not-cumulative (see roomHits' doc comment).
       */
      players: PlayerState[];
      full?: boolean;
      balls: ServerBall[];
      hits: HitEvent[];
      enemies: EnemyState[];
      at: number;
      /** Only set for a connection currently inside a room that has a training dummy (see
       * MAIN_LOBBY_SLUG in shared/rooms.ts and DUMMY_MAX_HP in shared/constants.ts). */
      dummy?: DummyState;
      /** Only set for a connection currently inside a pomodoro room instance. */
      pomodoro?: PomodoroSessionState;
      /**
       * Only set on the lobby room's own broadcast: per pomodoro-type-slug door state (true = open
       * for a fresh join right now) — lets the lobby grid dim a door for DOOR_REOPEN_MS right after
       * someone starts it (see shared/constants.ts).
       */
      doors?: Record<string, boolean>;
      /**
       * Only set on the lobby room's own broadcast (same gating as `doors` above): per-lamp
       * on/off state, keyed by LOBBY_LAMPS' own ids (shared/obstacles.ts). Missing key means off
       * (a lamp nobody has ever toggled) — see the "toggleLamp" ClientMessage above.
       */
      lamps?: Record<string, boolean>;
    }
  | { type: "join_rejected"; reason: "room_full" | "room_starting" }
  /**
   * STU-45: broadcast immediately to every connection in the room (not queued into `state`,
   * same reasoning as respawn_redirect below being its own message) the instant a player emotes.
   * `id` is the emoting connection's id, matching PlayerState.id, so clients can find which
   * player to show it above.
   */
  | { type: "emote"; id: string; emoji: string }
  /**
   * STU-35: broadcast immediately (same immediate, not-queued-into-`state` reasoning as `emote`
   * above) to every connection in the room the instant someone's flash grenade goes off — purely
   * a rendering cue (full-screen white flash), no HP/damage tie-in, see RoomStage.tsx.
   */
  | { type: "itemEffect"; id: string; item: "flashGrenade" | "potionOfSwiftness" }
  /**
   * Sent only to the one connection that just respawned (never part of `state`) — the server has
   * already moved it into the lobby room server-side (position/hp/immunity reset), but rooms are
   * separate Next.js routes (see AGENTS.md), so only the client's own router can actually navigate
   * its page there. RoomStage.tsx reacts by router.push("/"); the new page's own `join` then
   * resumes from the ghost this leaves behind, same as any other reconnect (see B2 in
   * docs/stateful_server_plan.md).
   */
  | { type: "respawn_redirect" }
  /**
   * STU-58: sent only to a connection whose pomodoro room instance just finished its break phase
   * and was torn down server-side (see the tick loop in server.ts) — same "server already moved
   * you, only the client's own router can navigate" reasoning as `respawn_redirect` above.
   */
  | { type: "session_ended_redirect" }
  /**
   * Relayed straight through from the sender's own "voiceSignal" ClientMessage above — `from` is
   * the sender's connection id (matches PlayerState.id) so the recipient's RTCPeerConnection-per-
   * peer map can route it. Sent only to the one addressed connection, never broadcast.
   */
  | { type: "voiceSignal"; from: string; data: unknown };
