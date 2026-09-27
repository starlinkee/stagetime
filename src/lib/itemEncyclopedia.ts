/**
 * STU-82: catalog for the Item Encyclopedia (see ENCYCLOPEDIA_ZONE_SLUG in src/app/page.tsx) — a
 * read-only reference listing every purchasable/ownable item with its icon and a description, all
 * in one place. There's no single "all items" table anywhere else in the repo (see ShopRoom.tsx's
 * COSMETIC_ITEMS, EQUIPMENT_ITEMS in realtime-server/shared/constants.ts, and the coin/duration
 * constants in src/lib/coins.ts, each of which only carries what its own NPC/dialog needs) — this
 * file is a display-only summary of all of them, hand-kept in sync with those sources rather than
 * generated from them.
 *
 * `iconSrc: null` means no dedicated sprite exists for that item yet (e.g. equipment gear, which
 * ShopRoom.tsx itself only ever shows as text — see EquipSlotBox in RoomStage.tsx) — the dialog
 * falls back to a plain initial badge for those. "sparkles" is a special case: its only visual is
 * the animated CosmeticOverlay, not a static image, so the dialog renders that component directly
 * instead of using iconSrc.
 */
export type EncyclopediaCategory = "Cosmetics" | "Weapons" | "Gear" | "Consumables";

export interface EncyclopediaEntry {
  slug: string;
  name: string;
  category: EncyclopediaCategory;
  iconSrc: string | null;
  description: string;
}

export const ITEM_ENCYCLOPEDIA: EncyclopediaEntry[] = [
  {
    slug: "flower",
    name: "Flower crown",
    category: "Cosmetics",
    iconSrc: "/cosmetics/flower.png",
    description: "Purely decorative — sits on your head, no effect on gameplay. Sold by the Florist in the Shop.",
  },
  {
    slug: "sparkles",
    name: "Shining",
    category: "Cosmetics",
    iconSrc: null,
    description: "A sparkling aura around you — purely decorative, no effect on gameplay. Sold by the Florist in the Shop.",
  },
  {
    slug: "pistol_black",
    name: "Pistol (black)",
    category: "Weapons",
    iconSrc: "/map/items/modern-items-pack/sliced/pistols/pistol_black.png",
    description:
      "Weapon slot 3's current look, still internally \"shuriken\" — fires for 7 damage, much faster than a thrown ball. Ammo packs sold by the Gunman in the Shop.",
  },
  {
    slug: "pistol_gray",
    name: "Pistol (gray)",
    category: "Weapons",
    iconSrc: "/map/items/modern-items-pack/sliced/pistols/pistol_gray.png",
    description: "A look at what's coming — no stats yet, not for sale.",
  },
  {
    slug: "pistol_silver",
    name: "Pistol (silver)",
    category: "Weapons",
    iconSrc: "/map/items/modern-items-pack/sliced/pistols/pistol_silver.png",
    description: "A look at what's coming — no stats yet, not for sale.",
  },
  {
    slug: "pistol_tan",
    name: "Pistol (tan)",
    category: "Weapons",
    iconSrc: "/map/items/modern-items-pack/sliced/pistols/pistol_tan.png",
    description: "A look at what's coming — no stats yet, not for sale.",
  },
  {
    slug: "iron_helm",
    name: "Iron helm",
    category: "Gear",
    iconSrc: null,
    description: "+10 max HP while equipped. Sold by the Gear specialist in the Shop, equip/unequip it for free from the Tab inventory panel.",
  },
  {
    slug: "iron_armor",
    name: "Iron armor",
    category: "Gear",
    iconSrc: null,
    description:
      "-15% damage taken while equipped. Sold by the Gear specialist in the Shop, equip/unequip it for free from the Tab inventory panel.",
  },
  {
    slug: "swift_boots",
    name: "Swift boots",
    category: "Gear",
    iconSrc: null,
    description:
      "+40 move speed while equipped. Sold by the Gear specialist in the Shop, equip/unequip it for free from the Tab inventory panel.",
  },
  {
    slug: "potion_of_swiftness",
    name: "Potion of swiftness",
    category: "Consumables",
    iconSrc: "/map/items/modern-items-pack/sliced/bottles/bottle_blue_cap.png",
    description: "+50% move speed for 1 minute after drinking (press H). Sold by the Chemist in the Shop.",
  },
  {
    slug: "flash_grenade",
    name: "Flash grenade",
    category: "Consumables",
    iconSrc: null,
    description: "Blinds the whole room with a full-screen flash when thrown (press G). Sold by the Gunman in the Shop.",
  },
];
