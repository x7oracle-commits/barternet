// BarterNet Online Relay — works ANYWHERE over the internet.
//
// Run locally:        node relay-server.js
// Or deploy free to:  Render / Railway / Fly.io / Glitch / Replit / a VPS
//   (it uses process.env.PORT, so most hosts work with zero config)
//
// Once hosted, you get a public URL like  https://barternet.onrender.com
// Anyone in the world enters that URL + a shared room code in the app and
// they sync together — no shared WiFi, no app store, no accounts.
//
// Data is in-memory only and expires after 5 min of inactivity. Bundles are
// partitioned by "room" so groups don't see each other unless they share a code.

const http = require("http");
const os   = require("os");

const PORT = process.env.PORT || 4000;
const TTL_MS = 5 * 60 * 1000;

// room -> Map(peerId -> { bundle, ts })
const rooms = new Map();

function roomStore(room) {
  if (!rooms.has(room)) rooms.set(room, new Map());
  return rooms.get(room);
}

function prune() {
  const now = Date.now();
  for (const [room, store] of rooms) {
    for (const [id, v] of store) if (now - v.ts > TTL_MS) store.delete(id);
    if (store.size === 0) rooms.delete(room);
  }
}

function send(res, code, obj) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(obj));
}

function getRoom(url) {
  try {
    const u = new URL(url, "http://x");
    return (u.searchParams.get("room") || "global").trim().toLowerCase();
  } catch { return "global"; }
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});

  const path = req.url.split("?")[0];

  // Health check — Render (and other hosts) ping "/" to verify the service is
  // alive. Must return 200, otherwise the host marks it unhealthy and restarts
  // it in a loop (which also wipes the in-memory store).
  if ((req.method === "GET" || req.method === "HEAD") && path === "/") {
    return send(res, 200, { app: "BarterNet-Relay", status: "ok", rooms: rooms.size });
  }

  if (req.method === "GET" && path === "/ping") {
    prune();
    const room = getRoom(req.url);
    return send(res, 200, { app: "BarterNet-Relay", room, peers: roomStore(room).size });
  }

  if (req.method === "POST" && path === "/sync") {
    const room = getRoom(req.url);
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 5_000_000) req.destroy(); });
    req.on("end", () => {
      try {
        const bundle = JSON.parse(body);
        const id = bundle?.peer?.id;
        if (!id) return send(res, 400, { error: "missing peer id" });

        const store = roomStore(room);
        store.set(id, { bundle, ts: Date.now() });
        prune();

        const others = [];
        for (const [pid, v] of store) if (pid !== id) others.push(v.bundle);
        return send(res, 200, { bundles: others });
      } catch {
        return send(res, 400, { error: "bad json" });
      }
    });
    return;
  }

  send(res, 404, { error: "not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  BarterNet Relay listening on port ${PORT}\n`);
  // Show LAN addresses too (useful when testing locally)
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        console.log(`     local:  http://${net.address}:${PORT}`);
      }
    }
  }
  console.log(`\n  Deploy this file to any host for a public URL that works worldwide.\n`);
});
