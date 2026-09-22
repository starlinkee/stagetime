import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { clampPos } from "../shared/physics";
import { BROADCAST_MS, DEFAULT_PLAYER_SPEED, DIR_OF, TICK_MS } from "../shared/constants";
import type { ClientMessage, Dir, PlayerState, ServerMessage } from "../shared/types";

const PORT = Number(process.env.PORT) || 8080;

type Conn = {
  id: string;
  ws: WebSocket;
  roomSlug: string;
  isLobby: boolean;
  userId: string | null;
  nick: string | null;
  color: string;
  x: number;
  y: number;
  d: Dir;
  // Latest movement intent from the client — the server, not the client, turns this into a
  // position. See docs/stateful_server_plan.md for why this exists.
  inputDx: -1 | 0 | 1;
  inputDy: -1 | 0 | 1;
};

const rooms = new Map<string, Set<Conn>>();

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function joinRoom(conn: Conn) {
  let set = rooms.get(conn.roomSlug);
  if (!set) {
    set = new Set();
    rooms.set(conn.roomSlug, set);
  }
  set.add(conn);
}

function leaveRoom(conn: Conn) {
  const set = rooms.get(conn.roomSlug);
  if (!set) return;
  set.delete(conn);
  if (set.size === 0) rooms.delete(conn.roomSlug);
}

/** Only -1/0/1 are ever valid — anything else from the network becomes 0 (no movement in that axis). */
function toAxis(v: unknown): -1 | 0 | 1 {
  return v === -1 || v === 1 ? v : 0;
}

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  if (req.url === "/") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("stagetime realtime-server: up (this is a WebSocket endpoint, not a page)");
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  const conn: Conn = {
    id: randomUUID(),
    ws,
    roomSlug: "lobby",
    isLobby: true,
    userId: null,
    nick: null,
    color: "#ffffff",
    x: 0,
    y: 0,
    d: 2,
    inputDx: 0,
    inputDy: 0,
  };

  send(ws, { type: "welcome", id: conn.id });

  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "join") {
      leaveRoom(conn);
      conn.roomSlug = typeof msg.roomSlug === "string" && msg.roomSlug ? msg.roomSlug : "lobby";
      conn.isLobby = conn.roomSlug === "lobby";
      conn.userId = typeof msg.userId === "string" ? msg.userId : null;
      conn.nick = typeof msg.nick === "string" ? msg.nick.slice(0, 40) : null;
      conn.color = typeof msg.color === "string" ? msg.color : "#ffffff";
      // TODO(stage: persistence bridge): load last-known position from Supabase instead of a
      // fixed spawn point — see Krok 6 in docs/stateful_server_plan.md.
      const spawn = clampPos(200, 200, conn.isLobby);
      conn.x = spawn.x;
      conn.y = spawn.y;
      joinRoom(conn);
      return;
    }
    if (msg.type === "input") {
      conn.inputDx = toAxis(msg.dx);
      conn.inputDy = toAxis(msg.dy);
      return;
    }
  });

  ws.on("close", () => {
    leaveRoom(conn);
  });
});

let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  for (const set of rooms.values()) {
    for (const conn of set) {
      const { inputDx: dx, inputDy: dy } = conn;
      if (!dx && !dy) continue;
      const norm = dx && dy ? Math.SQRT1_2 : 1;
      const nx = conn.x + dx * DEFAULT_PLAYER_SPEED * dt * norm;
      const ny = conn.y + dy * DEFAULT_PLAYER_SPEED * dt * norm;
      const clamped = clampPos(nx, ny, conn.isLobby);
      conn.x = clamped.x;
      conn.y = clamped.y;
      conn.d = DIR_OF[dy + 1][dx + 1] as Dir;
    }
  }
}, TICK_MS);

setInterval(() => {
  for (const set of rooms.values()) {
    const players: PlayerState[] = [...set].map((c) => ({
      id: c.id,
      userId: c.userId,
      nick: c.nick,
      color: c.color,
      x: c.x,
      y: c.y,
      d: c.d,
    }));
    const msg: ServerMessage = { type: "state", players, at: Date.now() };
    for (const conn of set) send(conn.ws, msg);
  }
}, BROADCAST_MS);

httpServer.listen(PORT, () => {
  console.log(`realtime-server listening on ${PORT}`);
});
