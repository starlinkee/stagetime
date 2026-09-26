/**
 * Single source of truth for movement constants shared between this server and the client
 * (imported from src/components/RoomStage.tsx via a relative path — see README.md in this
 * folder). Values must match RoomStage.tsx exactly, or client-side prediction/rendering will
 * visibly disagree with what the server decides.
 */

import type { CharacterStats } from "./types";

export const SCREEN_W = 1366;
export const SCREEN_H = 768;
export const PERSON_W = 64;
export const PERSON_H = 96;
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
 * Combat/roll tuning — single source of truth for this server and src/components/
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
/** Charged-ball radius range — interpolated by charge fraction (0..1). */
export const ORB_R_MIN = 10;
export const ORB_R_MAX = 60;
/** Thrown-ball flight speed, px/s. */
export const BALL_SPEED = 520;
/** Melee (slash, weapon slot 2): short reach, no charge, hits immediately on press. Replaces the
 * old "strike"/fist swing (STU-61) — same short-range-hitbox shape, new name/visual, and the
 * client-side animation no longer mixes the server's `ServerBall.until` (epoch ms, `Date.now()`)
 * with its own `performance.now()`-based render clock the way the old one briefly did (that
 * mismatch could blow a hitbox's on-screen radius up to cover the whole canvas for a frame — see
 * the `slashClockRef` doc comment in RoomStage.tsx). */
export const SLASH_REACH = 44;
export const SLASH_R = 40;
export const SLASH_MS = 150;
/** Cooldown between slashes — kept short since stamina (SLASH_STAMINA_COST), not this timer, is
 * now the main brake on melee spam. */
export const SLASH_COOLDOWN_MS = 80;
/** Melee stamina cost — drawn from the same pool as `fire`/roll, refused outright (not queued)
 * when the pool can't cover it, same gate shape as STAMINA_COST_PER_SHOT/ROLL_STAMINA_COST. */
export const SLASH_STAMINA_COST = 15;
/** Character hitbox padding used by ball/melee collision checks. */
export const HIT_PAD = 8;

/**
 * Weapon slot 3: a fast, ammo-limited throwing weapon. Flies exactly like a thrown ball
 * (spawnShuriken in server.ts: same above-the-head spawn, straight line in the facing direction,
 * no charge), just quicker and for a fixed damage instead of one scaled by charge fraction. Ammo
 * (how many a player has left) is a Postgres concern checked client-side before this weapon's
 * ClientMessage is ever sent — same "ownership is Postgres, *use* is realtime-server" split as
 * flash grenades (see supabase/migrations/0040_shuriken_ammo.sql) — neither Conn nor this file
 * track a per-connection ammo count. Every value below is also an admin-panel-editable default
 * (see AdminSettings in src/lib/adminSettings.ts) — a connection's own live value lives in
 * `Conn.weapons` (server.ts), only ever different from these defaults when DEV_OVERRIDES_ENABLED
 * is on (same gate as playerSpeed/staminaRegenPerSec overrides).
 */
export const SHURIKEN_DMG = 5;
/** Flight speed, px/s — deliberately faster than BALL_SPEED so a shuriken reads as a quicker,
 * sharper throw than the charge-and-lob ball. */
export const SHURIKEN_SPEED = 900;
export const SHURIKEN_R = 14;
/** Defense-in-depth only — ammo itself (checked client-side against Postgres before this message
 * is ever sent, see the doc comment above) is the real fire-rate limit, same role
 * FLASH_GRENADE_COOLDOWN_MS plays for that item's own "useItem" message. */
export const SHURIKEN_COOLDOWN_MS = 120;

/** STU-45: cooldown between emotes — generous enough to allow expression, tight enough to stop
 * spam (no per-message-type rate limiter exists elsewhere, see withinRateLimit's doc comment in
 * server.ts, so this cooldown is emote's only anti-spam guard). */
export const EMOTE_COOLDOWN_MS = 1_500;
/** STU-45: the only emojis the server accepts in an `emote` message — anything else is dropped
 * silently (server, not client, is the source of truth here, same as every other input). */
export const EMOJI_EMOTES = ["👍", "😂", "❤️", "😮", "😢", "🔥"] as const;

/** STU-35: cooldown between flash-grenade uses — this is defense-in-depth against a compromised
 * client resending `useItem` faster than the Postgres round-trip (see consume_flash_grenade in
 * supabase/migrations/0037_flash_grenade_item.sql), not the actual supply limit; the real "how
 * many do you have" check happens in Postgres before the client ever sends this message. */
export const FLASH_GRENADE_COOLDOWN_MS = 2_000;
/**
 * Combat hitbox (ball/melee collision), and — since STU-53 — solid-obstacle collision too (see
 * resolveObstacleMoveHitbox in shared/obstacles.ts) — narrower and shorter than the full
 * PERSON_W x PERSON_H box, which remains the movement footprint for world clamp, zone overlap and
 * spawn centering, and stays the sprite scale, unchanged. Horizontally centered within that box so
 * a thrown ball (or a desk/bookshelf) only blocks against the character's visible silhouette
 * instead of its whole walking footprint. Vertically it's bottom-anchored, not centered: every
 * character sprite stands on the box's bottom edge (feet at PERSON_H), with empty headroom above,
 * not a silhouette centered in the middle of the box — PlayerSprite's fixed art
 * (public/characters/player/rotation/*.png) only fills the bottom 2/3 of its 24x24 canvas (checked
 * via alpha bbox: visible rows 8-24 of 24), so a vertically-centered box used to sit mostly in the
 * empty headroom above the head and miss the feet (or, for obstacles, block from the head down
 * instead of from roughly the waist down) entirely. Must match RoomStage.tsx's `hits()` exactly,
 * same as PERSON_W/PERSON_H above.
 */
export const HITBOX_W = PERSON_W / 2;
export const HITBOX_H = (PERSON_H * 2) / 3;
export const HITBOX_OFFSET_X = (PERSON_W - HITBOX_W) / 2;
export const HITBOX_OFFSET_Y = PERSON_H - HITBOX_H;
/**
 * Stamina (fire-rate) model, replacing the old flat "N shots then a hard 1.8s wait" salvo
 * cooldown: a connection has a pool of `STAMINA_MAX` units that drains by `STAMINA_COST_PER_SHOT`
 * per shot and regenerates continuously at `STAMINA_REGEN_PER_SEC` units/sec — no per-tick loop
 * needed server-side, since stamina at any instant is just `min(max, last + elapsed * rate)`,
 * computed lazily off a timestamp (see `currentStamina` in server.ts) only when it's actually
 * needed (a `fire` message, or a broadcast) — that's what keeps this cheap at hundreds of
 * concurrent fighters, not a per-connection regen tick.
 * Chosen so the numbers still land on the old feel: STAMINA_MAX / STAMINA_COST_PER_SHOT = 3 shots
 * from a full bar (matches the old salvo), and a full bar refills in 1.8s (matches the old
 * FIRE_COOLDOWN_MS) — except now that's smooth/continuous instead of empty-then-suddenly-full, so
 * evenly-spaced taps (one shot every STAMINA_COST_PER_SHOT / STAMINA_REGEN_PER_SEC = 0.6s) go on
 * forever, at that exact cadence. Stamina is the *only* gate on fire rate — there used to be a
 * second, independently-tuned concurrent-in-flight ball cap here too, which could silently drop a
 * shot the stamina bar said was fine (the bar has no idea how many of your balls are still flying);
 * it was removed rather than kept in sync, since two limits that must always agree is itself the
 * bug. Also just defaults — see `DEFAULT_CHARACTER_STATS`; a future character choice or item can
 * raise any of the three per connection (bigger pool, cheaper shots, faster regen) without this
 * code changing.
 */
export const STAMINA_MAX = 180;
export const STAMINA_COST_PER_SHOT = 60;
export const STAMINA_REGEN_PER_SEC = STAMINA_MAX / 1.8;
/** Roll (dash) stamina cost — drawn from the same pool as `fire`, refused outright (not queued)
 * when the pool can't cover it, same gate shape as STAMINA_COST_PER_SHOT above. */
export const ROLL_STAMINA_COST = 40;

/**
 * HP/damage/respawn — combat only deals damage outside the lobby (a decision made when this was
 * added: the lobby stays a safe social space, balls/slashes still fly and visually hit there, but
 * `isLobbyRoom` in server.ts skips the HP subtraction). Every connection starts and respawns at
 * `MAX_HP`, or more with an equipped helm (see CharacterStats.maxHp, EQUIPMENT_ITEMS below).
 */
export const MAX_HP = 25;

/**
 * Every connection's stats until character selection exists (see AGENTS.md's 2026-09-23 note:
 * no character classes/items yet) — copied into `Conn.stats` per connection (never shared by
 * reference, so a future per-connection item bonus can mutate its own copy without touching this
 * default or any other connection's stats).
 */
export const DEFAULT_CHARACTER_STATS: CharacterStats = {
  moveSpeed: DEFAULT_PLAYER_SPEED,
  staminaMax: STAMINA_MAX,
  staminaCostPerShot: STAMINA_COST_PER_SHOT,
  staminaRegenPerSec: STAMINA_REGEN_PER_SEC,
  attackPower: 1,
  maxHp: MAX_HP,
  damageReduction: 0,
};

/**
 * "Desperation" threshold (STU-44, an intentional feature, not a bug): at this HP or below, the
 * stamina gate on `fire` is skipped entirely (see the `fire` handler in server.ts) — a nearly-dead
 * player can spam shots with no cooldown. Stamina itself keeps regenerating normally underneath
 * (this only skips the check and the spend), so leaving desperation mode above this threshold just
 * resumes the normal gate against whatever the pool has regenerated to, no debt carried over.
 */
export const DESPERATE_HP = 5;
/** Charged-throw damage range — interpolated by charge fraction (0..1), same `p` spawnBall already
 * uses for `ORB_R_MIN`/`ORB_R_MAX`. */
export const DMG_MIN = 1;
export const DMG_MAX = 5;
/** Melee has no charge to scale off of, so it deals a fixed, mid-range hit. */
export const SLASH_DMG = 4;
/** Charge feedback with no extra art: steps the orb through a fixed color per damage tier (not a
 * smooth blend) so a jump from e.g. dmg 1 to dmg 2 reads as a sharp color change, matching the
 * discrete dmg the server actually deals (`dmg = round(DMG_MIN + (DMG_MAX-DMG_MIN)*p)` in
 * spawnBall, server.ts). Shared (not just RoomStage.tsx's own copy) so the server can stamp the
 * exact same tier color onto a `HitEvent` instead of the shooter's cosmetic `conn.color` — a hit's
 * splash should look like the ball that caused it, not like whatever color that player happens to
 * have equipped. */
export const CHARGE_TIER_COLORS = ["#e4e4e7", "#facc15", "#fb923c", "#f87171", "#dc2626"];
/** Tier color for a *known* dmg value (a thrown ball's real `dmg`, or `SLASH_DMG` for melee) —
 * lets a flying ball, and the splash/`HitEvent` it produces on impact, share one color instead of
 * drifting apart. */
export function dmgTint(dmg: number): string {
  const idx = Math.max(0, Math.min(CHARGE_TIER_COLORS.length - 1, Math.round(dmg) - DMG_MIN));
  return CHARGE_TIER_COLORS[idx];
}
/** How long a dead connection is frozen (no movement/actions) before respawning. */
export const RESPAWN_MS = 5000;
/** Grace window after respawning during which a connection can't be damaged or targeted. */
export const IMMUNITY_MS = 5000;
/** Client-side rendering hint: sprite opacity while `now < immuneUntil`. */
export const IMMUNE_OPACITY = 0.4;
/** Client-side rendering hint: sprite opacity for a ghost (dead player, controllable for
 * RESPAWN_MS — see PlayerState.gx/gy/gd's doc comment in shared/types.ts). */
export const GHOST_OPACITY = 0.35;
/** Same as GHOST_OPACITY, but for the "classic" character look specifically — its art reads as
 * too faint at GHOST_OPACITY, so it gets a higher floor while other looks keep GHOST_OPACITY. */
export const GHOST_OPACITY_CLASSIC = 0.45;

/**
 * Kill reward shown to the killer only (as "+N xp"/"+N gold" text next to the big "KILL" callout,
 * see the `killed` flag on HitEvent in shared/types.ts) and actually credited to their account via
 * src/app/api/internal/combat/route.ts. A single source for both so the number on screen always
 * matches what actually lands in Postgres.
 */
export const KILL_XP_REWARD = 1;
export const KILL_GOLD_REWARD = 5;

/**
 * First test of a room-owned enemy that everyone can hurt and that can hurt everyone back (see
 * AGENTS.md's 2026-09-23 note: no AI/FSM system is planned here — this is a small per-room state
 * machine in the same tick loop as movement/combat, exactly like HP was added, not a new
 * subsystem). Lives only in `ARENA_ROOM_SLUG`, one per room, spawned at full HP the moment the
 * room stops being empty (see ensureArenaEnemy in server.ts) — never persisted, never shared
 * across rooms.
 */
export const ARENA_ROOM_SLUG = "arena";

/**
 * STU-58: on-demand pomodoro sessions. A room type's "door" instance starts in `waiting` — anyone
 * inside can hold the center action zone for START_HOLD_MS to start the session for whoever is
 * inside at that moment (see the `startSession` ClientMessage and PomodoroInstance in server.ts).
 * The instance that was just started stops accepting joins immediately, and a brand-new empty
 * instance becomes the type's new open door — but only after DOOR_REOPEN_MS (the "dimmed for 2s"
 * window the lobby door shows), so a join landing in that window is rejected
 * (`join_rejected`/"room_starting") exactly like `room_full` is.
 */
export const START_HOLD_MS = 3000;
export const DOOR_REOPEN_MS = 2000;
export const ENEMY_MAX_HP = 60;
/** World units per second — slower than DEFAULT_PLAYER_SPEED so a chased player can outrun it. */
export const ENEMY_SPEED = 140;
/** Box used both for its melee-swing hitbox target test and for the client's own sprite footprint. */
export const ENEMY_W = 96;
export const ENEMY_H = 96;
/** Starts chasing the nearest player within this distance (px, from box centers). */
export const ENEMY_AGGRO_RANGE = 420;
/** Keeps chasing its current target until it gets this far away, even past ENEMY_AGGRO_RANGE —
 * without a wider leash than the aggro range, a target orbiting right at the aggro edge would
 * flicker the enemy between chase and idle every tick. */
export const ENEMY_LEASH_RANGE = 620;
/** Switches from chase to attack once this close (px, from box centers). */
export const ENEMY_ATTACK_RANGE = 70;
/** Melee hitbox radius/lifetime/cooldown — same shape of numbers as SLASH_R/SLASH_MS/
 * SLASH_COOLDOWN_MS above, just tuned for one big slow attacker instead of many players. */
export const ENEMY_ATTACK_R = 46;
export const ENEMY_ATTACK_MS = 200;
export const ENEMY_ATTACK_COOLDOWN_MS = 1200;
export const ENEMY_ATTACK_DMG = 4;
/** How long the enemy stays dead before respawning at full HP — only while the room isn't empty
 * (see the tick loop in server.ts); an empty room just deletes it outright instead of waiting. */
export const ENEMY_RESPAWN_MS = 8000;

/**
 * STU-40: a stationary, non-attacking training target — same "small per-room state in the existing
 * tick loop" pattern as the arena enemy above, not a new subsystem. Unlike the enemy, its HP is
 * broadcast as a plain number every tick (see DummyState in shared/types.ts) so players can watch
 * it drain in real time, instead of only an HP-bar fraction. Lives only in ARENA_ROOM_SLUG, one per
 * room, spawned at full HP the moment the room stops being empty (see ensureArenaDummy in
 * server.ts) — same lifecycle as the enemy. While it has HP left, nothing ever restores it except a
 * hit — there is no timer that heals or resets it while it's still alive; only an actual kill (hp
 * reaches 0) respawns it, after DUMMY_RESPAWN_MS, same "brief death, then back to full" shape as
 * the enemy's own respawn.
 */
export const DUMMY_MAX_HP = 10_000;
export const DUMMY_W = 96;
export const DUMMY_H = 96;
export const DUMMY_RESPAWN_MS = 3000;

/**
 * STU-77: equipment slots shown in the Tab inventory panel (RoomStage.tsx). Each slot holds at
 * most one owned item at a time (see equipped_helm/equipped_armor/equipped_boots in
 * supabase/migrations/0043_equipment.sql) — same "one active slot" shape as `cosmetic`
 * (0027_cosmetic_items.sql), just three slots instead of one. Unlike cosmetic, these carry a real
 * CharacterStats bonus, so this catalog is the single source of truth both sides read from:
 * src/app/api/realtime/token/route.ts turns a player's equipped slugs into signed bonus numbers on
 * the entry token (see mintEntryToken in entryToken.ts), and server.ts applies those numbers to
 * `Conn.stats` at join — realtime-server never looks up a slug against this table itself, so this
 * file changing shape doesn't require a server.ts change beyond the join-time lookup.
 */
export type EquipSlot = "helm" | "armor" | "boots";
export interface EquipmentItem {
  slug: string;
  slot: EquipSlot;
  name: string;
  /** Copper coins, same currency as purchase_cosmetic/buy_shuriken_ammo. */
  cost: number;
  /** Flat addition to CharacterStats.maxHp. */
  maxHpBonus?: number;
  /** Flat addition to CharacterStats.damageReduction (0..1 fraction of incoming damage ignored). */
  damageReductionBonus?: number;
  /** Flat addition to CharacterStats.moveSpeed (world units/s). */
  moveSpeedBonus?: number;
}
export const EQUIPMENT_ITEMS: readonly EquipmentItem[] = [
  { slug: "iron_helm", slot: "helm", name: "Iron helm", cost: 150, maxHpBonus: 10 },
  { slug: "iron_armor", slot: "armor", name: "Iron armor", cost: 200, damageReductionBonus: 0.15 },
  { slug: "swift_boots", slot: "boots", name: "Swift boots", cost: 150, moveSpeedBonus: 40 },
];
