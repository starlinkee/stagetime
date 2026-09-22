/**
 * Single source of truth for movement constants shared between this server and the client
 * (imported from src/components/RoomStage.tsx via a relative path — see README.md in this
 * folder). Values must match RoomStage.tsx exactly, or client-side prediction/rendering will
 * visibly disagree with what the server decides.
 */

export const SCREEN_W = 1600;
export const SCREEN_H = 900;
export const PERSON_W = 32;
export const PERSON_H = 48;
export const TAG_H = 18;

/** World units per second — matches DEFAULT_ADMIN_SETTINGS.playerSpeed in src/lib/adminSettings.ts. */
export const DEFAULT_PLAYER_SPEED = 220;

export function worldW(isLobby: boolean): number {
  return isLobby ? SCREEN_W * 2 : SCREEN_W;
}

export function worldH(isLobby: boolean): number {
  return isLobby ? SCREEN_H * 2 : SCREEN_H;
}

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
