// BarterNet relay — Deno Deploy, WebSocket + Deno KV (chunked).
//
// Deno Deploy runs many isolates and BroadcastChannel doesn't bridge them
// reliably, so we use Deno KV (globally replicated) as the shared store: every
// peer's latest signed bundle is written to KV and each isolate polls KV and
// pushes new bundles to its own connected sockets.
//
// Deno KV caps a single value at 64 KB, but real bundles (items + ratings +
// gossiped peers + signatures) are bigger — so each bundle is split into ≤60 KB
// chunks under separate keys and reassembled on read. A per-version cache keeps
// steady-state cheap (we only re-read a peer's chunks when its bundle changes).
//
// This is a DUMB, UNTRUSTED forwarder: bundles are opaque, already signed
// (Ed25519) end-to-end by clients. The server only resists abuse.

const TTL_MS         = 5 * 60 * 1000; // forget a peer 5 min after its last update
const POLL_MS        = 2000;          // how often each isolate pushes KV → sockets
const MAX_MSG_BYTES  = 1_000_000;     // 1 MB per bundle (matches the client cap)
const CHUNK_BYTES    = 60_000;        // < Deno KV's 64 KB per-value limit
const MAX_ROOM_LEN   = 64;
const RATE_WINDOW_MS = 10_000;
const RATE_MAX_MSGS  = 40;

const kv = await Deno.openKv();

// Per-isolate state.
const rooms = new Map<string, Set<WebSocket>>();           // room -> connected sockets
const bundleCache = new Map<string, { ts: number; bundle: unknown }>(); // peerId -> reassembled

function roomSet(room: string): Set<WebSocket> {
  let s = rooms.get(room);
  if (!s) { s = new Set(); rooms.set(room, s); }
  return s;
}

// ── KV storage (chunked) ──────────────────────────────────────────────────────

async function storeBundle(room: string, peerId: string, bundle: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(bundle));
  const ts = Date.now();
  const n = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES));
  // Write chunks first (keyed by ts so a new version never half-overwrites the
  // old one), then the meta last — readers act only on a complete, current set.
  for (let i = 0; i < n; i++) {
    await kv.set(
      ["room", room, "data", peerId, ts, i],
      bytes.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES),
      { expireIn: TTL_MS },
    );
  }
  await kv.set(["room", room, "meta", peerId], { ts, peerId, n }, { expireIn: TTL_MS });
}

// Read + reassemble every live peer bundle in a room.
async function getRoomBundles(room: string): Promise<Array<{ peerId: string; ts: number; bundle: unknown }>> {
  const now = Date.now();
  const out: Array<{ peerId: string; ts: number; bundle: unknown }> = [];

  for await (const e of kv.list<{ ts: number; peerId: string; n: number }>({ prefix: ["room", room, "meta"] })) {
    const meta = e.value;
    if (!meta?.peerId || typeof meta.ts !== "number" || now - meta.ts > TTL_MS) continue;

    const cached = bundleCache.get(meta.peerId);
    if (cached && cached.ts === meta.ts) { out.push({ peerId: meta.peerId, ts: meta.ts, bundle: cached.bundle }); continue; }

    // Re-read this peer's chunks (its bundle changed).
    const parts: Uint8Array[] = [];
    let complete = true;
    for (let i = 0; i < meta.n; i++) {
      const c = await kv.get<Uint8Array>(["room", room, "data", meta.peerId, meta.ts, i]);
      if (!c.value) { complete = false; break; }
      parts.push(c.value);
    }
    if (!complete) continue; // a chunk hasn't replicated yet — try next poll

    const total = parts.reduce((s, p) => s + p.length, 0);
    const all = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { all.set(p, off); off += p.length; }

    let bundle: unknown;
    try { bundle = JSON.parse(new TextDecoder().decode(all)); } catch { continue; }
    bundleCache.set(meta.peerId, { ts: meta.ts, bundle });
    out.push({ peerId: meta.peerId, ts: meta.ts, bundle });
  }
  return out;
}

// ── Fan-out ───────────────────────────────────────────────────────────────────

async function pushRoom(room: string) {
  const set = rooms.get(room);
  if (!set || set.size === 0) return;

  const live = await getRoomBundles(room);
  for (const ws of set) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    // deno-lint-ignore no-explicit-any
    const meta = ws as any;
    const sent: Map<string, number> = meta._sent;
    for (const v of live) {
      if (v.peerId === meta._peerId) continue;   // don't echo a peer to itself
      if (sent.get(v.peerId) === v.ts) continue; // already delivered this version
      try {
        ws.send(JSON.stringify({ type: "bundle", bundle: v.bundle }));
        sent.set(v.peerId, v.ts);
      } catch { /* socket went away */ }
    }
  }
}

// One poller per isolate; also prunes the local reassembly cache.
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
    try {
      await storeBundle(room, id, b);
      pushRoom(room).catch(() => {}); // deliver to same-isolate peers right away
    } catch { /* KV write failed; the next heartbeat will retry */ }
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

  if (url.pathname === "/ws") {
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const room = normRoom(url);
    const { socket, response } = Deno.upgradeWebSocket(req);
    handleSocket(socket, room);
    return response;
  }

  if (url.pathname === "/" || url.pathname === "/ping") {
    const room = normRoom(url);
    const now = Date.now();
    let peers = 0;
    for await (const e of kv.list<{ ts: number }>({ prefix: ["room", room, "meta"] })) {
      if (e.value && now - e.value.ts <= TTL_MS) peers++;
    }
    return new Response(
      JSON.stringify({ app: "BarterNet-Relay", transport: "ws+kv-chunked", room, peers }),
      { headers: cors(new Headers({ "Content-Type": "application/json" })) },
    );
  }

  return new Response(JSON.stringify({ error: "not found" }), {
    status: 404,
    headers: cors(new Headers({ "Content-Type": "application/json" })),
  });
});
