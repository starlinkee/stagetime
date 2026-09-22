"use client";
import { useSyncExternalStore } from "react";

/**
 * Jedno miejsce ze wszystkimi ustawieniami "adminowskimi" apki (rzeczy, które admin chce
 * móc szybko przestroić bez zmian w kodzie). Domyślne wartości są tu; w wersji lokalnej
 * i na Vercel Preview (nigdy na produkcji) można je nadpisać z panelu w lewym dolnym rogu —
 * nadpisania trzymane są w localStorage i działają w całej apce na tej wersji przeglądarki.
 */
export type AdminSettings = {
  /** Ile sekund trzeba przytrzymać E stojąc w kwadracie pokoju, żeby go otworzyć. */
  roomEnterSec: number;
};

export const DEFAULT_ADMIN_SETTINGS: AdminSettings = {
  roomEnterSec: 0.75,
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
];

const STORAGE_KEY = "stagetime:admin-settings";

/** Panel admina i nadpisania ustawień działają tylko poza produkcją: lokalnie i na Vercel Preview. */
export function isAdminUiEnabled(): boolean {
  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV;
  if (vercelEnv) return vercelEnv !== "production";
  return process.env.NODE_ENV !== "production";
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
