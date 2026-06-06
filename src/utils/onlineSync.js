// Online mode transport.
//
// Two transports, auto-selected per server:
//   1. WebSocket (preferred) — used by the Deno Deploy relay (deno-relay/). The
//      server pushes each peer's update the moment it changes, so traffic is
//      O(changes), not O(N²) every few seconds. This is what makes online scale.
//   2. HTTP polling (fallback) — used by the Node relay (relay-server.js) on
//      Render and by local LAN testing. We POST our bundle and GET the others
//      every few seconds.
//
// We try the WebSocket first; if it can't connect (e.g. the server is the old
// Node relay, which has no /ws), we fall back to polling automatically. Either
// way the bundle format and the end-to-end Ed25519 signatures are identical.

let transport = null;

const POLL_INTERVAL_MS = 4000;
const WS_HEARTBEAT_MS  = 25_000; // re-announce our bundle so new joiners catch up
const WS_OPEN_TIMEOUT  = 6000;   // if it doesn't open in time, fall back to polling
const WS_BACKOFF_MS     = [1000, 2000, 5000, 10_000];

function normalizeUrl(url) {
  let u = (url || "").trim().replace(/\/+$/, "");
  if (u && !/^(https?|wss?):\/\//i.test(u)) u = "http://" + u;
  return u;
}

function roomParam(room) {
  const r = (room || "global").trim().toLowerCase() || "global";
  return `room=${encodeURIComponent(r)}`;
}

function toWsUrl(base, room) {
  const ws = base.replace(/^http/i, "ws"); // http→ws, https→wss, ws(s) untouched
  return `${ws}/ws?${roomParam(room)}`;
}

export async function pingServer(serverUrl, room) {
  const base = normalizeUrl(serverUrl);
  if (!base) throw new Error("Enter the server address");
  // WebSocket relays (Deno) still answer HTTP /ping; so does the Node relay.
  const httpBase = base.replace(/^ws/i, "http");

  // Free hosts (e.g. Render) spin down when idle — the first request after idle
  // can 404/502 while the instance boots. Retry a few times before giving up.
  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${httpBase}/ping?${roomParam(room)}`, { method: "GET" });
      if (res.ok) return await res.json().catch(() => ({}));
      lastErr = `Server responded ${res.status}`;
    } catch (e) {
      lastErr = e.message || "Network error";
    }
    await new Promise((r) => setTimeout(r, 2000 + attempt * 2000));
  }
  throw new Error(lastErr + " (server may be waking up — try again)");
}

// ── WebSocket transport ───────────────────────────────────────────────────────

function createWsTransport(base, room, getBundle, onBundle, onError, onFatal) {
  let ws = null;
  let heartbeat = null;
  let attempt = 0;
  let stopped = false;
  let everOpened = false;

  const send = async () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      const bundle = await getBundle();
      if (bundle) ws.send(JSON.stringify({ type: "bundle", bundle }));
    } catch { /* skip */ }
  };

  const connect = () => {
    if (stopped) return;
    let opened = false;
    try { ws = new WebSocket(toWsUrl(base, room)); }
    catch { return onFatal?.(); } // bad URL → let caller fall back to polling

    // If the socket never opens (old Node relay, blocked, etc.), bail to polling
    // — but only on the very first attempt; after we've worked once we reconnect.
    const openTimer = setTimeout(() => {
      if (!opened && !everOpened) { try { ws.close(); } catch { /* */ } onFatal?.(); }
    }, WS_OPEN_TIMEOUT);

    ws.onopen = () => {
      opened = everOpened = true;
      attempt = 0;
      clearTimeout(openTimer);
      onError?.(null);
      send(); // announce ourselves immediately
      heartbeat = setInterval(send, WS_HEARTBEAT_MS);
    };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg?.type === "bundle" && msg.bundle) {
        Promise.resolve(onBundle(msg.bundle)).catch(() => {});
      }
    };

    const drop = () => {
      clearTimeout(openTimer);
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
      if (stopped) return;
      onError?.("Reconnecting…");
      const delay = WS_BACKOFF_MS[Math.min(attempt++, WS_BACKOFF_MS.length - 1)];
      setTimeout(connect, delay);
    };
    ws.onclose = drop;
    ws.onerror = () => { try { ws.close(); } catch { /* */ } };
  };

  connect();

  return {
    push: send,
    stop() {
      stopped = true;
      if (heartbeat) clearInterval(heartbeat);
      if (ws) { try { ws.close(); } catch { /* */ } ws = null; }
    },
  };
}

// ── HTTP polling transport (fallback) ─────────────────────────────────────────

function createPollTransport(base, room, getBundle, onBundle, onError) {
  const httpBase = base.replace(/^ws/i, "http");
  let timer = null;
  let stopped = false;

  const tick = async () => {
    try {
      const bundle = await getBundle();
      if (!bundle) return;
      const res = await fetch(`${httpBase}/sync?${roomParam(room)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bundle),
      });
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const data = await res.json();
      const others = Array.isArray(data?.bundles) ? data.bundles : [];
      for (const b of others) {
        try { await onBundle(b); } catch { /* skip bad bundle */ }
      }
      onError?.(null);
    } catch (err) {
      if (!stopped) onError?.(err.message || "Cannot reach server");
    }
  };

  tick();
  timer = setInterval(tick, POLL_INTERVAL_MS);

  return {
    push: tick,
    stop() { stopped = true; if (timer) { clearInterval(timer); timer = null; } },
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start online sync. Tries WebSocket (scalable), auto-falls back to HTTP polling.
 * @param {string}   serverUrl
 * @param {string}   room
 * @param {function} getBundle  async () => bundle object (fresh data)
 * @param {function} onBundle   (bundle) => void, per received peer bundle
 * @param {function} onError    (msg|null) => void
 */
export function startOnlineSync(serverUrl, room, getBundle, onBundle, onError) {
  stopOnlineSync();
  const base = normalizeUrl(serverUrl);
  if (!base) { onError?.("Enter the server address"); return; }

  const startPolling = () =>
    (transport = createPollTransport(base, room, getBundle, onBundle, onError));

  // ws:// or wss:// → WebSocket only. http(s):// → try WS, fall back to polling.
  if (/^wss?:\/\//i.test(base)) {
    transport = createWsTransport(base, room, getBundle, onBundle, onError, () => {
      onError?.("Cannot reach server");
    });
  } else {
    transport = createWsTransport(base, room, getBundle, onBundle, onError, () => {
      // WebSocket unavailable on this host → switch to polling once.
      if (transport) transport.stop();
      startPolling();
    });
  }
}

export function stopOnlineSync() {
  if (transport) { transport.stop(); transport = null; }
}

// Push our latest bundle right now (called when local data changes).
export function pushOnlineBundle() {
  transport?.push?.();
}

export function isOnlineSyncRunning() {
  return transport !== null;
}
