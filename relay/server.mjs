// Babbl clipboard relay: forwards frames between sockets that joined the same room.
// Devices end-to-end encrypt everything, so the relay only ever sees opaque bytes.
import http from "node:http";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 8080);
const MAX_PAYLOAD = 12 * 1024 * 1024; // matches Babbl's 10 MB inline-image cap + overhead
const MAX_GROUP_MEMBERS = 32;
const MAX_PAIR_MEMBERS = 2;
const MAX_CONNECTIONS_PER_IP = 40;
const BYTES_PER_MINUTE = 600 * 1024 * 1024; // per socket; generous for 100 MB file transfers
const ROOM_RE = /^[A-Za-z0-9-]{4,64}$/;

/** @type {Map<string, Set<import("ws").WebSocket>>} */
const rooms = new Map();
/** @type {Map<string, number>} */
const perIp = new Map();

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD, perMessageDeflate: false });

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  return (typeof fwd === "string" ? fwd.split(",")[0].trim() : "") || req.socket.remoteAddress || "?";
}

server.on("upgrade", (req, socket, head) => {
  const match = /^\/ws\/([^/?#]+)/.exec(req.url || "");
  const room = match ? decodeURIComponent(match[1]) : "";
  if (!ROOM_RE.test(room)) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }
  const ip = clientIp(req);
  if ((perIp.get(ip) || 0) >= MAX_CONNECTIONS_PER_IP) {
    socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
    socket.destroy();
    return;
  }
  const members = rooms.get(room);
  const cap = room.startsWith("pair-") ? MAX_PAIR_MEMBERS : MAX_GROUP_MEMBERS;
  if (members && members.size >= cap) {
    socket.write("HTTP/1.1 409 Conflict\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => join(ws, room, ip));
});

function join(ws, room, ip) {
  if (!rooms.has(room)) rooms.set(room, new Set());
  const members = rooms.get(room);
  members.add(ws);
  perIp.set(ip, (perIp.get(ip) || 0) + 1);

  ws.isAlive = true;
  ws.budget = { windowStart: Date.now(), bytes: 0 };
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (data, isBinary) => {
    const now = Date.now();
    if (now - ws.budget.windowStart > 60_000) ws.budget = { windowStart: now, bytes: 0 };
    ws.budget.bytes += data.length;
    if (ws.budget.bytes > BYTES_PER_MINUTE) {
      ws.close(1008, "rate limit");
      return;
    }
    for (const peer of members) {
      if (peer !== ws && peer.readyState === peer.OPEN) peer.send(data, { binary: isBinary });
    }
  });

  ws.on("close", () => {
    members.delete(ws);
    if (members.size === 0) rooms.delete(room);
    const n = (perIp.get(ip) || 1) - 1;
    if (n <= 0) perIp.delete(ip);
    else perIp.set(ip, n);
  });
  ws.on("error", () => ws.terminate());
}

// Heartbeat: drop sockets that stopped answering pings, and keep proxies from idling us out.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

server.listen(PORT, () => {
  console.log(`Babbl relay listening on :${PORT}`);
});
