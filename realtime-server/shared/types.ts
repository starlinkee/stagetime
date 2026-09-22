export type Dir = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface PlayerState {
  id: string;
  userId: string | null;
  nick: string | null;
  color: string;
  x: number;
  y: number;
  d: Dir;
}

/**
 * Messages the client sends. `dx`/`dy` are movement *intent*, not a position — the server is
 * the one that turns intent into a position (speed clamp, world-bounds clamp), which is the
 * entire point of this server existing (see docs/stateful_server_plan.md).
 */
export type ClientMessage =
  | { type: "join"; id: string; roomSlug: string; userId: string | null; nick: string | null; color: string }
  | { type: "input"; dx: -1 | 0 | 1; dy: -1 | 0 | 1 };

export type ServerMessage =
  | { type: "welcome"; id: string }
  | { type: "state"; players: PlayerState[]; at: number };
