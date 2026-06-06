// BarterNet relay for Deno Deploy — the scalable, free, no-cold-start option.
//
// Why this instead of the Node/Render relay:
//   • Deno Deploy runs globally distributed isolates with NO cold start.
//   • WebSockets replace 4s polling, so bandwidth is O(changes), not O(N²/sec).
//   • A global BroadcastChannel fans a peer's update out to every isolate, so
//     two phones connected to different edge locations still see each other.
//
// Like the Node relay, this is a DUMB, UNTRUSTED forwarder: bundles are opaque,
// already signed (Ed25519) end-to-end by clients. The server only resists abuse.
//
// Deploy: see DEPLOY-DENO.md. Entry point = this file. No build step.

const TTL_MS          = 5 * 60 * 1000;
const MAX_MSG_BYTES   = 1_000_000;   // 1 MB per bundle
const MAX_ROOMS       = 5000;
const MAX_PEERS_ROOM  = 500;
const MAX_ROOM_LEN    = 64;

// Per-connection rate limit (token bucket over a sliding window).
const RATE_WINDOW_MS  = 10_000;
const RATE_MAX_MSGS   = 40;

// Unique id for THIS isolate so we ignore our own broadcasts.
const ISO = crypto.randomUUID();
const bc = new BroadcastChannel("barternet-relay");

type Entry = { bundle: unknown; ts: number };
// room -> peerId -> latest bundle (for catch-up of newly joined peers)
const cache = new Map<string, Map<string, Entry>>();
// room -> set of locally-connected sockets
const sockets = new Map<string, Set<WebSocket>>();

function roomCache(room: string): Map<string, Entry> {
  let m = cache.get(room);
  if (!m) { m = new Map(); cache.set(room, m); }
  return m;
}

function prune() {
  const now = Date.now();
  for (const [room, m] of cache) {
    for (const [id, e] of m) if (now - e.ts > TTL_MS) m.delete(id);
    if (m.size === 0 && !(sockets.get(room)?.size)) cache.delete(room);
  }
}
setInterval(prune, 60_000);

function normRoom(url: URL): string {
  const r = (url.searchParams.get("room") || "global").trim().toLowerCase();
  return r.slice(0, MAX_ROOM_LEN) || "global";
}

// Store a peer's latest bundle in this isolate's cache and forward to local
// sockets in the room (except the origin socket).
function fanOutLocal(room: string, peerId: string, bundle: unknown, origin?: WebSocket) {
  roomCache(room).set(peerId, { bundle, ts: Date.now() });
  const set = sockets.get(room);
  if (!set) return;
  const payload = JSON.stringify({ type: "bundle", bundle });
  for (const ws of set) {
    if (ws === origin) continue;
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(payload); } catch { /* dropped */ }
    }
  }
}

// Updates from other isolates arrive here.
bc.onmessage = (ev: MessageEvent) => {
  const d = ev.data as { iso: string; room: string; peerId: string; bundle: unknown };
  if (!d || d.iso === ISO) return; // ignore our own
  fanOutLocal(d.room, d.peerId, d.bundle);
};

function handleSocket(ws: WebSocket, room: string) {
  let peerId: string | null = null;
  let hits = 0;
  let resetAt = Date.now() + RATE_WINDOW_MS;

  ws.onopen = () => {
    const set = sockets.get(room) ?? new Set();
    if (set.size >= MAX_PEERS_ROOM) { ws.close(1013, "room full"); return; }
    if (!sockets.has(room)) {
      if (sockets.size >= MAX_ROOMS) { ws.close(1013, "server full"); return; }
      sockets.set(room, set);
    }
    set.add(ws);

    // Catch the new peer up with everyone we currently know in the room.
    const snap = roomCache(room);
    for (const [, e] of snap) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: "bundle", bundle: e.bundle })); } catch { /* */ }
      }
    }
  };

  ws.onmessage = (ev) => {
    const now = Date.now();
    if (now > resetAt) { hits = 0; resetAt = now + RATE_WINDOW_MS; }
    if (++hits > RATE_MAX_MSGS) return; // silently drop floods

    const raw = typeof ev.data === "string" ? ev.data : "";
    if (!raw || raw.length > MAX_MSG_BYTES) return;

    let msg: { type?: string; bundle?: { app?: string; peer?: { id?: string } } };
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type !== "bundle") return;

    const b = msg.bundle;
    const id = b?.peer?.id;
    if (!b || b.app !== "BarterNet" || typeof id !== "string" || !id) return;
    peerId = id;

    fanOutLocal(room, id, b, ws);                       // local subscribers
    bc.postMessage({ iso: ISO, room, peerId: id, bundle: b }); // other isolates
  };

  const cleanup = () => {
    const set = sockets.get(room);
    if (set) { set.delete(ws); if (set.size === 0) sockets.delete(room); }
    if (peerId) roomCache(room).delete(peerId);
  };
  ws.onclose = cleanup;
  ws.onerror = cleanup;
}

function cors(h: Headers = new Headers()) {
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type");
  return h;
}

Deno.serve((req: Request) => {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });

  // WebSocket upgrade — the scalable path.
  if (url.pathname === "/ws") {
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const room = normRoom(url);
    const { socket, response } = Deno.upgradeWebSocket(req);
    handleSocket(socket, room);
    return response;
  }

  // HTTP health / ping — used by the app's "test server" and host health checks.
  if (url.pathname === "/" || url.pathname === "/ping") {
    const room = normRoom(url);
    const peers = (sockets.get(room)?.size) ?? roomCache(room).size;
    return new Response(
      JSON.stringify({ app: "BarterNet-Relay", transport: "ws", room, peers }),
      { headers: cors(new Headers({ "Content-Type": "application/json" })) },
    );
  }

  return new Response(JSON.stringify({ error: "not found" }), {
    status: 404,
    headers: cors(new Headers({ "Content-Type": "application/json" })),
  });
});
