"use client";
import { useSyncExternalStore } from "react";
import {
  BALL_SPEED,
  DMG_MAX,
  DMG_MIN,
  SHURIKEN_COOLDOWN_MS,
  SHURIKEN_DMG,
  SHURIKEN_SPEED,
  SLASH_COOLDOWN_MS,
  SLASH_DMG,
} from "@realtime-shared/constants";

/**
 * Jedno miejsce ze wszystkimi ustawieniami "adminowskimi" apki (rzeczy, które admin chce
 * móc szybko przestroić bez zmian w kodzie). Domyślne wartości są tu; w wersji lokalnej,
 * na Vercel Preview, i (STU-83) na produkcji dla kont z public.admins, można je nadpisać
 * z panelu w headerze (patrz AdminPanel.tsx) — nadpisania trzymane są w localStorage i działają
 * w całej apce na tej przeglądarce, dla tego konkretnego admina. Wysyłane do realtime-server
 * (patrz RoomStage.tsx) tylko wtedy, gdy isAdminUiEnabled() jest prawdziwe — server.ts po swojej
 * stronie weryfikuje to niezależnie, przez podpisany `isAdmin` w entry tokenie (patrz
 * DEV_OVERRIDES_ENABLED w server.ts), więc nieadmin nigdy nie przekona serwera, nawet gdyby
 * ręcznie wysłał te same pola.
 */
export type AdminSettings = {
  /** Ile sekund trzeba przytrzymać E stojąc w kwadracie pokoju, żeby go otworzyć. */
  roomEnterSec: number;
  /** Prędkość postaci gracza w jednostkach świata na sekundę (patrz SPEED w RoomStage.tsx). */
  playerSpeed: number;
  /** Regeneracja staminy (pula pod fire/roll/slash) na sekundę — patrz STAMINA_REGEN_PER_SEC
   * w realtime-server/shared/constants.ts. Wysyłane do realtime-server jako staminaRegenOverride
   * (patrz DEV_OVERRIDES_ENABLED w server.ts), dokładnie tym samym mechanizmem co playerSpeed. */
  staminaRegenPerSec: number;
  /** Prędkość lotu rzuconej kuli (px/s) — patrz BALL_SPEED w realtime-server/shared/constants.ts.
   * Wysyłane jako weapons.ballSpeed (dokładnie ten sam mechanizm co playerSpeed powyżej). */
  ballSpeed: number;
  /** Dolna granica obrażeń rzuconej kuli (przy zerowym ładowaniu) — patrz DMG_MIN. */
  ballDmgMin: number;
  /** Górna granica obrażeń rzuconej kuli (przy pełnym ładowaniu) — patrz DMG_MAX. */
  ballDmgMax: number;
  /** Obrażenia zadawane przez slash (bez ładowania) — patrz SLASH_DMG. */
  slashDmg: number;
  /** Cooldown między slashami (ms) — patrz SLASH_COOLDOWN_MS. */
  slashCooldownMs: number;
  /** Obrażenia zadawane przez szurikena (broń nr 3) — patrz SHURIKEN_DMG. */
  shurikenDmg: number;
  /** Prędkość lotu szurikena (px/s) — patrz SHURIKEN_SPEED. */
  shurikenSpeed: number;
  /** Cooldown między szurikenami (ms) — ammo, nie ten cooldown, jest głównym ogranicznikiem, patrz
   * SHURIKEN_COOLDOWN_MS. */
  shurikenCooldownMs: number;
};

export const DEFAULT_ADMIN_SETTINGS: AdminSettings = {
  roomEnterSec: 0.75,
  playerSpeed: 220,
  staminaRegenPerSec: 100,
  ballSpeed: BALL_SPEED,
  ballDmgMin: DMG_MIN,
  ballDmgMax: DMG_MAX,
  slashDmg: SLASH_DMG,
  slashCooldownMs: SLASH_COOLDOWN_MS,
  shurikenDmg: SHURIKEN_DMG,
  shurikenSpeed: SHURIKEN_SPEED,
  shurikenCooldownMs: SHURIKEN_COOLDOWN_MS,
};

/** Opisuje jedno ustawienie do automatycznego wyrenderowania w panelu admina. */
export type AdminSettingDef = {
  key: keyof AdminSettings;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
};

/** Dodanie tu nowej pozycji automatycznie pokazuje ją w panelu admina. */
export const ADMIN_SETTINGS_SCHEMA: AdminSettingDef[] = [
  { key: "roomEnterSec", label: "Czas otwarcia pokoju (przytrzymanie E)", min: 0, step: 0.05, suffix: "s" },
  { key: "playerSpeed", label: "Prędkość gracza", min: 0, step: 10, suffix: " px/s" },
  { key: "staminaRegenPerSec", label: "Regeneracja staminy", min: 0, step: 5, suffix: " /s" },
  { key: "ballSpeed", label: "Kula: prędkość", min: 1, step: 10, suffix: " px/s" },
  { key: "ballDmgMin", label: "Kula: dmg min", min: 0, step: 1 },
  { key: "ballDmgMax", label: "Kula: dmg max", min: 0, step: 1 },
  { key: "slashDmg", label: "Slash: dmg", min: 0, step: 1 },
  { key: "slashCooldownMs", label: "Slash: cooldown", min: 0, step: 10, suffix: " ms" },
  { key: "shurikenDmg", label: "Shuriken: dmg", min: 0, step: 1 },
  { key: "shurikenSpeed", label: "Shuriken: prędkość", min: 1, step: 10, suffix: " px/s" },
  { key: "shurikenCooldownMs", label: "Shuriken: cooldown", min: 0, step: 10, suffix: " ms" },
];

const STORAGE_KEY = "stagetime:admin-settings";

/** STU-83: set once per session by AdminPanel.tsx, from useIsAdmin() (public.admins). Module-level
 * (not React state) because isAdminUiEnabled() also has to work from plain functions outside
 * React, like RoomStage.tsx's per-tick input-sending code. */
let knownAdminAccount = false;

/** Panel admina i nadpisania ustawień działają poza produkcją (lokalnie, Vercel Preview) dla
 * każdego, i wszędzie — łącznie z produkcją — dla kont z public.admins (STU-83). */
export function isAdminUiEnabled(): boolean {
  return isNonProdEnv() || knownAdminAccount;
}

function isNonProdEnv(): boolean {
  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV;
  if (vercelEnv) return vercelEnv !== "production";
  return process.env.NODE_ENV !== "production";
}

/** Called from AdminPanel.tsx once useIsAdmin() resolves. Re-reads localStorage on a false->true
 * flip so an admin's overrides from a previous session on this browser aren't stuck ignored until
 * their next explicit change — `current` below is otherwise computed once, at module load, before
 * this resolves. */
export function setAdminAccountFlag(isAdmin: boolean) {
  const wasEnabled = isAdminUiEnabled();
  knownAdminAccount = isAdmin;
  if (!wasEnabled && isAdminUiEnabled()) {
    current = { ...DEFAULT_ADMIN_SETTINGS, ...readOverrides() };
    for (const l of listeners) l();
  }
}

function readOverrides(): Partial<AdminSettings> {
  if (!isAdminUiEnabled() || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<AdminSettings>) : {};
  } catch {
    return {};
  }
}

let current: AdminSettings = { ...DEFAULT_ADMIN_SETTINGS, ...readOverrides() };
const listeners = new Set<() => void>();

/** Aktualne ustawienia (domyślne + ewentualne nadpisania z localStorage) — bezpieczne do czytania w pętlach gry. */
export function getAdminSettings(): AdminSettings {
  return current;
}

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // brak dostępu do localStorage (np. tryb prywatny) — nadpisanie działa tylko do odświeżenia
  }
  for (const l of listeners) l();
}

export function setAdminSetting<K extends keyof AdminSettings>(key: K, value: AdminSettings[K]) {
  if (!isAdminUiEnabled()) return;
  current = { ...current, [key]: value };
  persist();
}

export function resetAdminSettings() {
  if (!isAdminUiEnabled()) return;
  current = { ...DEFAULT_ADMIN_SETTINGS };
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // jw.
  }
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Do UI panelu admina — re-renderuje przy każdej zmianie ustawień. Gorące pętle (np. gra) powinny wołać getAdminSettings() bezpośrednio. */
export function useAdminSettings(): AdminSettings {
  return useSyncExternalStore(subscribe, getAdminSettings, () => DEFAULT_ADMIN_SETTINGS);
}
