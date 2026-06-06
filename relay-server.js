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
<<<<<<< HEAD
// The relay is a dumb store-and-forward box: bundles are opaque, signed blobs it
// never inspects beyond a peer id. Authenticity is enforced end-to-end by the
// clients (Ed25519 signatures). This server only has to survive abuse:
//   • per-IP rate limiting          (stop floods)
//   • bundle size cap               (stop memory blowups)
//   • room + per-room peer caps      (stop unbounded growth)
//   • TTL expiry                     (forget idle peers)
// Data is in-memory only and expires after 5 min of inactivity.
=======
// Data is in-memory only and expires after 5 min of inactivity. Bundles are
// partitioned by "room" so groups don't see each other unless they share a code.
>>>>>>> ff0f92553b455483176028403fe79ae9890b7283

const http = require("http");
const os   = require("os");

<<<<<<< HEAD
const PORT   = process.env.PORT || 4000;
const TTL_MS = 5 * 60 * 1000;

const MAX_BODY_BYTES   = 1_000_000;  // 1 MB per bundle (BLE/online strip images)
const MAX_ROOMS        = 5000;
const MAX_PEERS_ROOM   = 500;
const MAX_ROOM_LEN     = 64;

// Per-IP rate limit: token bucket refilled over a sliding window.
const RATE_WINDOW_MS   = 10_000;
const RATE_MAX_HITS    = 60;         // ~6 req/s sustained per IP
const rate = new Map();              // ip -> { hits, resetAt }

function rateLimited(ip) {
  const now = Date.now();
  let b = rate.get(ip);
  if (!b || now > b.resetAt) {
    b = { hits: 0, resetAt: now + RATE_WINDOW_MS };
    rate.set(ip, b);
  }
  b.hits++;
  return b.hits > RATE_MAX_HITS;
}

=======
const PORT = process.env.PORT || 4000;
const TTL_MS = 5 * 60 * 1000;

>>>>>>> ff0f92553b455483176028403fe79ae9890b7283
// room -> Map(peerId -> { bundle, ts })
const rooms = new Map();

function roomStore(room) {
<<<<<<< HEAD
  if (!rooms.has(room)) {
    if (rooms.size >= MAX_ROOMS) prune();          // try to reclaim space first
    if (rooms.size >= MAX_ROOMS) return null;      // still full → refuse new room
    rooms.set(room, new Map());
  }
=======
  if (!rooms.has(room)) rooms.set(room, new Map());
>>>>>>> ff0f92553b455483176028403fe79ae9890b7283
  return rooms.get(room);
}

function prune() {
  const now = Date.now();
  for (const [room, store] of rooms) {
    for (const [id, v] of store) if (now - v.ts > TTL_MS) store.delete(id);
    if (store.size === 0) rooms.delete(room);
  }
<<<<<<< HEAD
  // Forget rate buckets that have fully reset.
  for (const [ip, b] of rate) if (now > b.resetAt) rate.delete(ip);
=======
>>>>>>> ff0f92553b455483176028403fe79ae9890b7283
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
<<<<<<< HEAD
    const r = (u.searchParams.get("room") || "global").trim().toLowerCase();
    return r.slice(0, MAX_ROOM_LEN) || "global";
  } catch { return "global"; }
}

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});

  if (rateLimited(clientIp(req))) return send(res, 429, { error: "rate limited" });

=======
    return (u.searchParams.get("room") || "global").trim().toLowerCase();
  } catch { return "global"; }
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});

>>>>>>> ff0f92553b455483176028403fe79ae9890b7283
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
<<<<<<< HEAD
    const store = rooms.get(room);
    return send(res, 200, { app: "BarterNet-Relay", room, peers: store ? store.size : 0 });
=======
    return send(res, 200, { app: "BarterNet-Relay", room, peers: roomStore(room).size });
>>>>>>> ff0f92553b455483176028403fe79ae9890b7283
  }

  if (req.method === "POST" && path === "/sync") {
    const room = getRoom(req.url);
    let body = "";
<<<<<<< HEAD
    let aborted = false;
    req.on("data", (c) => {
      body += c;
      if (body.length > MAX_BODY_BYTES) {
        aborted = true;
        send(res, 413, { error: "bundle too large" });
        req.destroy();
      }
    });
    req.on("end", () => {
      if (aborted) return;
      try {
        const bundle = JSON.parse(body);
        // Shallow shape check only — the relay never trusts or interprets the
        // payload; clients verify signatures. We just need a key to file it under.
        const id = bundle && bundle.peer && bundle.peer.id;
        if (bundle.app !== "BarterNet" || typeof id !== "string" || !id) {
          return send(res, 400, { error: "invalid bundle" });
        }

        const store = roomStore(room);
        if (!store) return send(res, 503, { error: "server full, try later" });

        // Per-room cap: if full and this is a new peer, reclaim expired slots;
        // if still full, refuse rather than grow unbounded.
        if (!store.has(id) && store.size >= MAX_PEERS_ROOM) {
          prune();
          if (!store.has(id) && store.size >= MAX_PEERS_ROOM) {
            return send(res, 503, { error: "room full" });
          }
        }

=======
    req.on("data", (c) => { body += c; if (body.length > 5_000_000) req.destroy(); });
    req.on("end", () => {
      try {
        const bundle = JSON.parse(body);
        const id = bundle?.peer?.id;
        if (!id) return send(res, 400, { error: "missing peer id" });

        const store = roomStore(room);
>>>>>>> ff0f92553b455483176028403fe79ae9890b7283
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
