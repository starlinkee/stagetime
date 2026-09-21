import type { RoomConfig } from "./timer";

export const ROOMS: RoomConfig[] = [
  { slug: "25-5", name: "Pomodoro 25+5", workMin: 25, breakMin: 5 },
  { slug: "20-5", name: "Short Focus 20+5", workMin: 20, breakMin: 5 },
  { slug: "50-10", name: "Hour Block 50+10", workMin: 50, breakMin: 10 },
  { slug: "55-15", name: "Deep Work 55+15", workMin: 55, breakMin: 15 },
];

export const getRoom = (slug: string) => ROOMS.find((r) => r.slug === slug);
