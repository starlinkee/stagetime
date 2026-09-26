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

/**
 * STU-58: center button of a pomodoro room — hold E for START_HOLD_MS to start the session for
 * everyone currently inside. Slug must match START_SESSION_ZONE_SLUG in RoomStage.tsx, which
 * special-cases it (sends `startSession` over the room's own WS connection instead of bubbling
 * through `onZoneAction`, since there's no page-level callback that could relay it back down into
 * that connection).
 */
export const START_SESSION_ZONE: RoomZone = {
  slug: "start-session",
  name: "Start session",
  kind: "action",
  x: 573,
  y: 314,
  w: 220,
  h: 140,
};

/**
 * STU-58: one door per pomodoro type, not N phase-offset variants — each type now starts its own
 * work/break cycle on demand (see PomodoroSessionState in @realtime-shared/types), so there's
 * nothing left for a variant's `offsetMs`/shade-per-variant color to distinguish.
 */
const POMODORO_ROOMS: PomodoroRoomConfig[] = [
  { slug: "25-5", name: "Pomodoro 25+5", kind: "pomodoro", workMin: 25, breakMin: 5, color: "#0284c7" },
  { slug: "20-5", name: "Short Focus 20+5", kind: "pomodoro", workMin: 20, breakMin: 5, color: "#7c3aed" },
  { slug: "50-10", name: "Hour Block 50+10", kind: "pomodoro", workMin: 50, breakMin: 10, color: "#c2410c" },
];

/**
 * STU-56: mirrors of the existing Arena/Timer rooms, placed only in lobby2 (see
 * src/app/lobby2/page.tsx) — same room kinds, no new gameplay. `exitTo: "lobby2"` is what makes
 * their exit zone lead back into lobby2 instead of the default main lobby (see RoomConfig.exitTo's
 * doc comment and how /rooms/[slug]/page.tsx builds `exitZone` from it).
 */
const LOBBY2_ROOMS: RoomConfig[] = [
  { slug: "arena-2", name: "Arena 2", kind: "arena", color: "#dc2626", exitTo: "lobby2" },
  { slug: "timer-2", name: "Timer Room 2", kind: "stopwatch", exitTo: "lobby2" },
];

/**
 * House: an empty room behind the decorative house sprite in the lobby (see HOUSE_ROOM_SLUG's
 * doc comment / housePortalZone in src/app/page.tsx) — nothing in it yet beyond its own exit zone.
 */
export const HOUSE_ROOM_SLUG = "house";

export const ROOMS: RoomConfig[] = [
  ...POMODORO_ROOMS,
  { slug: "timer", name: "Timer Room", kind: "stopwatch" },
  { slug: "shop", name: "Shop", kind: "shop", color: "#eab308" },
  { slug: "arena", name: "Arena", kind: "arena", color: "#dc2626" },
  { slug: HOUSE_ROOM_SLUG, name: "House", kind: "empty" },
  ...LOBBY2_ROOMS,
];

export const getRoom = (slug: string) => ROOMS.find((r) => r.slug === slug);

/** Czytelna nazwa dowolnego obszaru (pokój z ROOMS, lobby/lobby2 albo cokolwiek przyszłego) do etykiet w czacie "all". */
export const roomLabel = (slug: string) => getRoom(slug)?.name ?? (slug === "lobby" ? "Lobby" : slug === "lobby2" ? "Lobby 2" : slug);
