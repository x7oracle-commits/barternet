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

const PUSH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // remember a device's FCM token 30 days

const kv = await Deno.openKv();

// ── FCM push (HTTP v1) ────────────────────────────────────────────────────────
// Lets the relay wake a device when its app is backgrounded/closed. Configured
// via the FCM_SERVICE_ACCOUNT env var (the Firebase service-account JSON). If
// it's not set, all push code below is a no-op and normal sync is unaffected.

// deno-lint-ignore no-explicit-any
const SA: any = (() => {
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
})();

let fcmAccess: { token: string; exp: number } | null = null;

function pemToBuf(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function fcmAccessToken(): Promise<string | null> {
  if (!SA?.client_email || !SA?.private_key) {
    console.warn("[fcm] service account missing client_email/private_key");
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (fcmAccess && fcmAccess.exp - 60 > now) return fcmAccess.token;

  const tokenUri = SA.token_uri || "https://oauth2.googleapis.com/token";
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: SA.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }));
  const input = `${head}.${claims}`;

  try {
    const key = await crypto.subtle.importKey(
      "pkcs8", pemToBuf(SA.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
    );
    const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input)));
    const jwt = `${input}.${b64url(sig)}`;

    const res = await fetch(tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });
    if (!res.ok) {
      console.error(`[fcm] token endpoint ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    fcmAccess = { token: data.access_token, exp: now + (data.expires_in || 3600) };
    console.log("[fcm] got access token");
    return fcmAccess.token;
  } catch (e) {
    console.error("[fcm] access-token error:", (e as Error).message);
    return null;
  }
}

const PUSH_COPY: Record<string, { title: string; body: (n: string) => string }> = {
  message: { title: "💬 New message", body: (n) => `${n} sent you a message` },
  buzz:    { title: "📳 Buzz!",       body: (n) => `${n} buzzed you` },
  offer:   { title: "🤝 New trade offer", body: (n) => `${n} wants to trade` },
};

async function sendPush(toPeerId: string, kind: string, fromName: string) {
  if (!SA) { console.warn("[push] no FCM_SERVICE_ACCOUNT configured"); return; }
  const rec = await kv.get<string>(["push", toPeerId]);
  if (!rec.value) { console.warn(`[push] no token registered for peer ${toPeerId}`); return; }
  const access = await fcmAccessToken();
  if (!access) { console.warn("[push] could not obtain FCM access token"); return; }
  const copy = PUSH_COPY[kind] || PUSH_COPY.message;
  try {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${SA.project_id}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token: rec.value,
          notification: { title: copy.title, body: copy.body(fromName || "Someone") },
          android: { priority: "high" },
        },
      }),
    });
    const txt = await res.text();
    console.log(`[push] FCM ${res.status} -> ${toPeerId}: ${res.ok ? "sent" : txt.slice(0, 300)}`);
  } catch (e) {
    console.error("[push] FCM send error:", (e as Error).message);
  }
}

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

    // deno-lint-ignore no-explicit-any
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }

    // Control messages for push (separate from bundles).
    if (msg.type === "register") {
      if (typeof msg.peerId === "string" && typeof msg.token === "string" && msg.peerId && msg.token) {
        await kv.set(["push", msg.peerId], msg.token, { expireIn: PUSH_TTL_MS }).catch(() => {});
        console.log(`[register] peer=${msg.peerId} token=${msg.token.slice(0, 16)}…`);
      }
      return;
    }
    if (msg.type === "push") {
      if (typeof msg.toPeerId === "string" && msg.toPeerId) {
        console.log(`[push-req] to=${msg.toPeerId} kind=${msg.kind} from=${msg.fromName}`);
        sendPush(msg.toPeerId, String(msg.kind || "message"), String(msg.fromName || "Someone")).catch(() => {});
      }
      return;
    }

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
      JSON.stringify({ app: "BarterNet-Relay", transport: "ws+kv-chunked", room, peers, push: !!SA }),
      { headers: cors(new Headers({ "Content-Type": "application/json" })) },
    );
  }

  return new Response(JSON.stringify({ error: "not found" }), {
    status: 404,
    headers: cors(new Headers({ "Content-Type": "application/json" })),
  });
});
