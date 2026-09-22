import { PERSON_W, PERSON_H, TAG_H, worldW, worldH } from "./constants";

/** Clamps a position (e.g. from network input) to the playable board — same rule client and server. */
export function clampPos(x: number, y: number, isLobby: boolean): { x: number; y: number } {
  return {
    x: Math.min(worldW(isLobby) - PERSON_W, Math.max(0, x)),
    y: Math.min(worldH(isLobby) - PERSON_H, Math.max(TAG_H, y)),
  };
}
