import type { RoomZone } from "@/components/RoomStage";
import type { PomodoroRoomConfig, RoomConfig } from "./timer";

/**
 * Wyjście z pokoju z powrotem do lobby: ten sam kwadrat "nav" co wejście, trzyma się E, żeby
 * wyjść — postać pojawia się w nim od razu po wejściu do pokoju (patrz spawnZoneSlug w RoomStage),
 * więc wyjście działa identycznie jak wejście, bez ruchu.
 */
export const EXIT_ZONE: RoomZone = {
  slug: "lobby",
  name: "Exit",
  kind: "nav",
  x: 690,
  y: 60,
  w: 220,
  h: 140,
};

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/** Rozkłada `n` odcieni pomiędzy dwoma kolorami krańcowymi (dla n=1 zwraca sam `from`). */
function interpolateShades(from: string, to: string, n: number): string[] {
  if (n <= 1) return [from];
  const [r1, g1, b1] = hexToRgb(from);
  const [r2, g2, b2] = hexToRgb(to);
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
  });
}

/**
 * N wariantów tego samego typu pokoju, rozłożonych równomiernie w cyklu (work+break). N dobrane
 * tak, żeby odstęp między wariantami (cykl/N) nie przekraczał długości przerwy — wtedy przerwy
 * kolejnych wariantów zachodzą na siebie w czasie i zawsze przynajmniej jeden wariant jest akurat
 * na przerwie (czyli wolny), niezależnie od momentu. Dla 20+5 (cykl 25min, przerwa 5min) daje to
 * N=5: zawsze dokładnie 1 z 5 pokoi wolny, 4 zajęte.
 */
function pomodoroVariants(
  slugBase: string,
  nameBase: string,
  workMin: number,
  breakMin: number,
  colorFrom: string,
  colorTo: string,
): PomodoroRoomConfig[] {
  const cycleMs = (workMin + breakMin) * 60_000;
  const count = Math.ceil((workMin + breakMin) / breakMin);
  const shades = interpolateShades(colorFrom, colorTo, count);
  return shades.map((color, i) => ({
    slug: `${slugBase}-${i + 1}`,
    name: `${nameBase} · ${i + 1}`,
    kind: "pomodoro" as const,
    workMin,
    breakMin,
    color,
    offsetMs: Math.round((i / count) * cycleMs),
  }));
}

export const ROOMS: RoomConfig[] = [
  ...pomodoroVariants("25-5", "Pomodoro 25+5", 25, 5, "#7dd3fc", "#0284c7"),
  ...pomodoroVariants("20-5", "Short Focus 20+5", 20, 5, "#c4b5fd", "#7c3aed"),
  ...pomodoroVariants("50-10", "Hour Block 50+10", 50, 10, "#fdba74", "#c2410c"),
  { slug: "timer", name: "Timer Room", kind: "stopwatch" },
];

export const getRoom = (slug: string) => ROOMS.find((r) => r.slug === slug);

/** Czytelna nazwa dowolnego obszaru (pokój z ROOMS, lobby albo cokolwiek przyszłego) do etykiet w czacie "all". */
export const roomLabel = (slug: string) => getRoom(slug)?.name ?? (slug === "lobby" ? "Lobby" : slug);
