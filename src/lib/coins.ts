/**
 * Copper coins — a second reward on top of XP (see src/lib/xp.ts), earned at its own rate:
 * 1 coin per minute of continuous presence in a study room (5 coins per 5 min, work or break
 * phase alike). The Timer Room pays a tenth of that, 0.1 coin per minute, and only while the
 * stopwatch is running — see src/components/TimerRoom.tsx and supabase/migrations/0015_coins.sql.
 */
export const STUDY_SECONDS_PER_COIN = 60;

/** Copper coins earned for `minutes` of continuous study time — the reward shown for a room's work session. */
export function coinsForMinutes(minutes: number): number {
  return Math.round((minutes * 60) / STUDY_SECONDS_PER_COIN);
}

/**
 * Price of a character color change in the Shop (src/components/ShopRoom.tsx) — must match the
 * `v_cost` constant in supabase/migrations/0019_shop_color_purchase.sql, which is the one that
 * actually charges the player; this copy is only for displaying the price client-side.
 */
export const COLOR_CHANGE_COST = 100;

/**
 * Cosmetic items — purely decorative (no gameplay effect, see AGENTS.md), bought in the Shop
 * (src/components/ShopRoom.tsx) for a timed duration. Cost/duration here are display-only copies;
 * `purchase_cosmetic` in supabase/migrations/0027_cosmetic_items.sql is what actually charges the
 * player and is the source of truth.
 */
export const FLOWER_COST = 100;
export const FLOWER_HOURS = 24;

/** Second cosmetic item, added in supabase/migrations/0035_sparkles_cosmetic.sql (STU-54) — same
 * display-only-copy caveat as FLOWER_COST/FLOWER_HOURS above. */
export const SPARKLES_COST = 150;
export const SPARKLES_HOURS = 24;

/**
 * Price of switching character look (src/components/CharacterSprite.tsx) in the Shop — must match
 * `v_cost` in supabase/migrations/0031_character_selection.sql, which is the one that actually
 * charges the player; this copy is only for displaying the price client-side. Switching back to
 * the character already equipped is free (also enforced server-side by that migration).
 */
export const CHARACTER_CHANGE_COST = 10;

/**
 * Gunman shop NPC (src/components/ShopRoom.tsx): shurikens, weapon slot 3's ammo (see
 * WEAPON_SLOTS in src/components/RoomStage.tsx). Starts at SHURIKEN_AMMO_START, buyable in packs
 * of SHURIKEN_AMMO_PACK for SHURIKEN_AMMO_COST coins. Display-only copies; buy_shuriken_ammo in
 * supabase/migrations/0040_shuriken_ammo.sql is what actually charges the player.
 */
export const SHURIKEN_AMMO_START = 10;
export const SHURIKEN_AMMO_PACK = 10;
export const SHURIKEN_AMMO_COST = 10;
