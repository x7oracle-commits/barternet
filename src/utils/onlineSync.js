// Online mode transport — WebSocket to the Deno Deploy relay (deno-relay/).
//
// The server pushes each peer's update the moment it changes, so traffic is
// O(changes), not O(N²) every few seconds. That's what makes online mode scale,
// and the relay has no cold start. The bundle format and the end-to-end Ed25519
// signatures are identical to Bluetooth mode — the relay is a dumb forwarder.
//
// We accept https:// (default) and derive wss://…/ws, or a ws(s):// URL directly.

let transport = null;

const WS_HEARTBEAT_MS = 25_000; // re-announce our bundle so new joiners catch up
const WS_BACKOFF_MS   = [1000, 2000, 5000, 10_000];

function normalizeUrl(url) {
  let u = (url || "").trim().replace(/\/+$/, "");
  if (u && !/^(https?|wss?):\/\//i.test(u)) u = "https://" + u;
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
  const httpBase = base.replace(/^ws/i, "http"); // the relay also answers HTTP /ping

  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${httpBase}/ping?${roomParam(room)}`, { method: "GET" });
      if (res.ok) return await res.json().catch(() => ({}));
      lastErr = `Server responded ${res.status}`;
    } catch (e) {
      lastErr = e.message || "Network error";
    }
    await new Promise((r) => setTimeout(r, 1500 + attempt * 1500));
  }
  throw new Error(lastErr || "Cannot reach server");
}

// ── WebSocket transport ───────────────────────────────────────────────────────

function createWsTransport(base, room, getBundle, onBundle, onError) {
  let ws = null;
  let heartbeat = null;
  let attempt = 0;
  let stopped = false;

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
    catch { onError?.("Bad server address"); return; }

    // If it never opens, force a close so onclose → reconnect kicks in.
    const openTimer = setTimeout(() => {
      if (!opened) { try { ws.close(); } catch { /* */ } }
    }, 8000);

    ws.onopen = () => {
      opened = true;
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

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start online sync over WebSocket.
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
  transport = createWsTransport(base, room, getBundle, onBundle, onError);
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
