// BarterNet relay — Deno Deploy, WebSocket + Deno KV. Scalable, no cold start.
//
// Why Deno KV instead of in-memory / BroadcastChannel:
//   Deno Deploy runs MANY isolates. In-memory state isn't shared between them,
//   and BroadcastChannel is not reliably bridging isolates on the current
//   platform — so two clients can land on different isolates and never see each
//   other. Deno KV is globally replicated, so we use it as the shared store:
//   every peer's latest signed bundle is written to KV, and each isolate polls
//   KV and pushes new bundles to its own connected sockets.
//
// This is a DUMB, UNTRUSTED forwarder: bundles are opaque, already signed
// (Ed25519) end-to-end by clients. The server only resists abuse.

const TTL_MS         = 5 * 60 * 1000; // forget a peer 5 min after its last update
const POLL_MS        = 2500;          // how often each isolate pushes KV → sockets
const MAX_MSG_BYTES  = 1_000_000;     // 1 MB per bundle
const MAX_ROOM_LEN   = 64;
const RATE_WINDOW_MS = 10_000;
const RATE_MAX_MSGS  = 40;

const kv = await Deno.openKv();

type Stored = { bundle: unknown; ts: number; peerId: string };

// Per-isolate: which sockets are connected to each room. Each socket carries its
// own peerId and a map of peerId→ts of what we've already delivered to it.
const rooms = new Map<string, Set<WebSocket>>();

function roomSet(room: string): Set<WebSocket> {
  let s = rooms.get(room);
  if (!s) { s = new Set(); rooms.set(room, s); }
  return s;
}

// Read every live bundle in a room from KV and push any the local sockets
// haven't seen yet (deduped by ts). This is what bridges across isolates.
async function pushRoom(room: string) {
  const set = rooms.get(room);
  if (!set || set.size === 0) return;

  const now = Date.now();
  const live: Stored[] = [];
  for await (const e of kv.list<Stored>({ prefix: ["room", room] })) {
    const v = e.value;
    if (v && typeof v.ts === "number" && now - v.ts <= TTL_MS) live.push(v);
  }

  for (const ws of set) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    // deno-lint-ignore no-explicit-any
    const meta = ws as any;
    const sent: Map<string, number> = meta._sent;
    for (const v of live) {
      if (v.peerId === meta._peerId) continue;     // don't echo a peer to itself
      if (sent.get(v.peerId) === v.ts) continue;   // already delivered this version
      try {
        ws.send(JSON.stringify({ type: "bundle", bundle: v.bundle }));
        sent.set(v.peerId, v.ts);
      } catch { /* socket went away */ }
    }
  }
}

// One poller per isolate covers every room that has local sockets.
setInterval(() => {
  for (const room of rooms.keys()) pushRoom(room).catch(() => {});
}, POLL_MS);

function normRoom(url: URL): string {
  const r = (url.searchParams.get("room") || "global").trim().toLowerCase();
  return r.slice(0, MAX_ROOM_LEN) || "global";
}

function handleSocket(ws: WebSocket, room: string) {
  // deno-lint-ignore no-explicit-any
  const meta = ws as any;
  meta._peerId = null;
  meta._sent = new Map<string, number>();
  let hits = 0;
  let resetAt = Date.now() + RATE_WINDOW_MS;

  ws.onopen = () => {
    roomSet(room).add(ws);
    pushRoom(room).catch(() => {}); // catch the new socket up immediately
  };

  ws.onmessage = async (ev) => {
    const now = Date.now();
    if (now > resetAt) { hits = 0; resetAt = now + RATE_WINDOW_MS; }
    if (++hits > RATE_MAX_MSGS) return;

    const raw = typeof ev.data === "string" ? ev.data : "";
    if (!raw || raw.length > MAX_MSG_BYTES) return;

    let msg: { type?: string; bundle?: { app?: string; peer?: { id?: string } } };
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type !== "bundle") return;

    const b = msg.bundle;
    const id = b?.peer?.id;
    if (!b || b.app !== "BarterNet" || typeof id !== "string" || !id) return;

    meta._peerId = id;
    // Shared, cross-isolate store. expireIn auto-forgets idle peers.
    await kv.set(["room", room, id], { bundle: b, ts: Date.now(), peerId: id }, { expireIn: TTL_MS });
    pushRoom(room).catch(() => {}); // deliver to same-isolate peers right away
  };

  const cleanup = () => { rooms.get(room)?.delete(ws); };
  ws.onclose = cleanup;
  ws.onerror = cleanup;
}

function cors(h: Headers = new Headers()) {
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type");
  return h;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });

  // WebSocket upgrade — the live transport.
  if (url.pathname === "/ws") {
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const room = normRoom(url);
    const { socket, response } = Deno.upgradeWebSocket(req);
    handleSocket(socket, room);
    return response;
  }

  // Health / ping — used by the app's connectivity check and host health checks.
  if (url.pathname === "/" || url.pathname === "/ping") {
    const room = normRoom(url);
    const now = Date.now();
    let peers = 0;
    for await (const e of kv.list<Stored>({ prefix: ["room", room] })) {
      if (e.value && now - e.value.ts <= TTL_MS) peers++;
    }
    return new Response(
      JSON.stringify({ app: "BarterNet-Relay", transport: "ws+kv", room, peers }),
      { headers: cors(new Headers({ "Content-Type": "application/json" })) },
    );
  }

  return new Response(JSON.stringify({ error: "not found" }), {
    status: 404,
    headers: cors(new Headers({ "Content-Type": "application/json" })),
  });
});
