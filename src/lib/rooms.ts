import type { RoomZone } from "@/components/RoomStage";
import type { RoomConfig } from "./timer";

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

export const ROOMS: RoomConfig[] = [
  { slug: "25-5", name: "Pomodoro 25+5", kind: "pomodoro", workMin: 25, breakMin: 5 },
  { slug: "20-5", name: "Short Focus 20+5", kind: "pomodoro", workMin: 20, breakMin: 5 },
  { slug: "50-10", name: "Hour Block 50+10", kind: "pomodoro", workMin: 50, breakMin: 10 },
  { slug: "timer", name: "Timer Room", kind: "stopwatch" },
];

export const getRoom = (slug: string) => ROOMS.find((r) => r.slug === slug);

/** Czytelna nazwa dowolnego obszaru (pokój z ROOMS, lobby albo cokolwiek przyszłego) do etykiet w czacie "all". */
export const roomLabel = (slug: string) => getRoom(slug)?.name ?? (slug === "lobby" ? "Lobby" : slug);
