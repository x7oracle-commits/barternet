import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import {
  db, getProfile, upsertPeer, addMessage, messageId,
} from "../db/db.js";
import { buildBleBundle } from "../utils/bluetooth.js";
import { validateBundle } from "../utils/validate.js";
import { signBundle, verifyBundle } from "../utils/crypto.js";
import {
  isNative, startMesh, stopMesh, updateMeshBundle,
  pullBundleFromPeer, approveSync,
} from "../utils/nativeBluetooth.js";
import { startOnlineSync, stopOnlineSync, pingServer, pushOnlineBundle } from "../utils/onlineSync.js";
import { DEFAULT_RELAY_URL, DEFAULT_ROOM } from "../config.js";

const MeshContext = createContext(null);
export const useMesh = () => useContext(MeshContext);

function fuzzyMatch(query, text) {
  return query.toLowerCase().split(/\s+/).some((w) => w.length > 2 && text.toLowerCase().includes(w));
}

// Persisted settings
const LS_MODE   = "barter_mode";        // "offline" | "online"
const LS_SERVER = "barter_server_url";  // relay URL for online mode
const LS_ROOM   = "barter_room";        // shared room code

export function MeshProvider({ children }) {
  const [mode,      setModeState] = useState(() => localStorage.getItem(LS_MODE) || "offline");
  // Fall back to the built-in relay so online mode works with zero setup.
  const [serverUrl, setServerUrl] = useState(() => localStorage.getItem(LS_SERVER) || DEFAULT_RELAY_URL);
  const [roomCode,  setRoomCode]  = useState(() => localStorage.getItem(LS_ROOM) || DEFAULT_ROOM);
  const [onlineError, setOnlineError] = useState(null);
  const [onlineActive, setOnlineActive] = useState(false);

  const [bleActive,   setBleActive]   = useState(false);
  const [bleError,    setBleError]    = useState(null);
  const [nearbyPeers, setNearbyPeers] = useState([]);
  const [syncing,     setSyncing]     = useState(null);
  const [matches,     setMatches]     = useState([]);
  const [peers,       setPeers]       = useState([]);
  const [meshStats,   setMeshStats]   = useState({ peers: 0, items: 0 });

  // bump this whenever stored data changes so pages can re-read
  const [dataVersion, setDataVersion] = useState(0);
  const bumpData = useCallback(() => setDataVersion((v) => v + 1), []);

  const syncingRef  = useRef(new Set());   // deviceIds currently syncing
  const lastSyncRef = useRef(new Map());   // deviceId → last successful sync ts
  const lastSeenRef = useRef(new Map());   // deviceId → last heartbeat ts

  const RESYNC_INTERVAL_MS = 5000;  // re-pull from an in-range peer every 5s
  const PEER_STALE_MS      = 30000; // drop peer from list if not seen for 30s

  // Build the current outgoing bundle from the DB
  const buildBundle = useCallback(async () => {
    const prof = await getProfile();
    if (!prof) return null;
    const [items, allPeers, trades, msgs] = await Promise.all([
      db.items.toArray().catch(() => []),
      db.peers.toArray().catch(() => []),
      db.trades.toArray().catch(() => []),
      db.messages.filter((m) => m.mine).toArray().catch(() => []),
    ]);
    const myItems = items.filter((i) => i.type !== "want" && i.status === "available");
    const myWants = items.filter((i) => i.type === "want");
    const bundle  = buildBleBundle(prof, myItems, myWants, allPeers, trades, msgs);
    // Sign so receivers can prove this bundle came from us. Legacy profiles with
    // no key go unsigned and will be rejected — App.jsx migrates them on launch.
    return prof.priv ? signBundle(bundle, prof.priv) : bundle;
  }, []);

  // Refresh peer list / stats for the UI
  const refreshStats = useCallback(async () => {
    const allPeers = await db.peers.toArray().catch(() => []);
    setPeers(allPeers);
    const totalItems = allPeers.reduce((n, p) => n + (p.items || []).length, 0);
    setMeshStats({ peers: allPeers.length, items: totalItems });
  }, []);

  // Process a bundle received from a peer (BLE, online relay, or imported file).
  // allowImages is true only for file imports — BLE/online bundles ship without
  // images, so keeping the default false drops any that were smuggled in.
  const processMeshBundle = useCallback(async (raw, { allowImages = false } = {}) => {
    const myProf   = await getProfile();
    const myPeerId = myProf?.uid || myProf?.id;
    if (myPeerId && raw?.peer?.id === myPeerId) return { skipped: true };

    // Authenticity gate FIRST, on the raw bytes as transmitted: the bundle must
    // carry a valid signature from the key whose fingerprint is peer.id. Verifying
    // before sanitizing matters — sanitization rewrites fields, which would change
    // the signed digest. Without this gate any device could publish items,
    // messages, offers, or trade responses under someone else's identity.
    if (!verifyBundle(raw)) {
      return { rejected: "unverified", peerName: raw?.peer?.name };
    }

    // Now sanitize/clamp the verified payload before it touches the database.
    let bundle;
    try {
      bundle = validateBundle(raw, { allowImages });
    } catch {
      return { rejected: "invalid" };
    }

    const { peer, items = [], mesh = [] } = bundle;

    await upsertPeer({ id: peer.id, name: peer.name, location: peer.location, avatar: peer.avatar, pub: peer.pub, items });

    // Forwarded (2-hop) peers are discovery-only — we can't verify their item
    // lists, so we never let them carry messages/offers. Store for browsing but
    // don't clobber a peer we've heard from directly more recently.
    for (const p of mesh) {
      if (p.id === myPeerId) continue;
      const existing = await db.peers.get(p.id);
      if (!existing || existing.lastSeen < bundle.ts - 3_600_000) {
        await upsertPeer({ id: p.id, name: p.name, location: p.location, pub: p.pub, items: p.items || [] });
      }
    }

    // Match my wants against incoming items
    const allIncoming = [
      ...items.map((i) => ({ ...i, _peerName: peer.name, _peerLocation: peer.location })),
      ...mesh.flatMap((p) => (p.items || []).map((i) => ({ ...i, _peerName: p.name, _peerLocation: p.location }))),
    ];
    const myWantsList = await db.items.filter((i) => i.type === "want").toArray();
    const found = [];
    for (const want of myWantsList) {
      for (const item of allIncoming) {
        if (fuzzyMatch(want.title, `${item.title} ${item.description || ""} ${item.category || ""}`)) {
          found.push({ wantTitle: want.title, item, peerName: item._peerName, peerLocation: item._peerLocation });
        }
      }
    }

    // Incoming offers addressed to me
    let newOffers = 0;
    for (const offer of bundle.offers || []) {
      if (offer.toPeerId !== myPeerId) continue;
      if (offer.fromId !== peer.id) continue; // signer can only offer as themselves
      const existing = await db.trades.get(offer.id);
      if (!existing) {
        await db.trades.add({
          id: offer.id, status: "incoming", initiatedByMe: false,
          withPeerId: peer.id, withPeerName: peer.name,
          theirItem: offer.myItem, myItem: offer.theirItem,
          fromMessage: offer.message || "", createdAt: offer.ts || Date.now(),
        });
        newOffers++;
      }
    }

    // Responses to my offers
    let updatedOffers = 0;
    for (const resp of bundle.responses || []) {
      if (resp.toPeerId !== myPeerId) continue;
      const trade = await db.trades.get(resp.tradeId);
      // Only the peer the trade is actually with may respond to it.
      if (trade && trade.withPeerId !== peer.id) continue;
      if (trade && trade.initiatedByMe && !["completed", "declined"].includes(trade.status)) {
        await db.trades.update(resp.tradeId, {
          status: resp.status === "accepted" ? "accepted" : "declined",
          declineReason: resp.reason || "",
        });
        updatedOffers++;
      }
    }

    // Incoming chat messages addressed to me
    let newMessages = 0;
    for (const m of bundle.messages || []) {
      if (m.toPeerId !== myPeerId) continue;
      if (m.fromId !== peer.id) continue; // signer can only deliver their own messages
      const id = m.id || messageId(m.fromId, myPeerId, m.ts, m.text);
      const exists = await db.messages.get(id);
      if (!exists) {
        await addMessage({
          id, peerId: m.fromId, peerName: m.fromName,
          text: m.text, ts: m.ts, mine: false, synced: true,
        });
        newMessages++;
      }
    }

    // We're connected to this peer bidirectionally — mark my pending messages
    // to them as synced (they pull our bundle around the same time we pull theirs)
    await db.messages
      .filter((m) => m.mine && !m.synced && m.peerId === peer.id)
      .modify({ synced: true })
      .catch(() => {});

    // Same for trade responses I sent to this peer
    await db.trades
      .filter((t) => !t.initiatedByMe && t.withPeerId === peer.id
        && ["accepted", "declined_by_me"].includes(t.status) && !t.responseSynced)
      .modify({ responseSynced: true })
      .catch(() => {});

    if (found.length) setMatches(found);
    await refreshStats();
    bumpData();

    return {
      peerName: peer.name,
      matches: found.length,
      newOffers, updatedOffers, newMessages,
    };
  }, [refreshStats, bumpData]);

  // Auto-sync with a peer. force=true bypasses the re-sync interval gate.
  const autoSync = useCallback(async (peer, force = false) => {
    if (syncingRef.current.has(peer.deviceId)) return;

    const last = lastSyncRef.current.get(peer.deviceId) || 0;
    if (!force && Date.now() - last < RESYNC_INTERVAL_MS) return; // synced recently

    syncingRef.current.add(peer.deviceId);
    setSyncing(peer.deviceId);
    try {
      const data = await pullBundleFromPeer(peer.deviceId);
      await processMeshBundle(data);
      lastSyncRef.current.set(peer.deviceId, Date.now());
      // Keep the peer in the nearby list — we re-sync it continuously while in range
    } catch (err) {
      console.warn("Auto-sync failed:", peer.name, err.message);
    } finally {
      syncingRef.current.delete(peer.deviceId);
      setSyncing(null);
    }
  }, [processMeshBundle]);

  // Start the mesh (advertise + scan)
  const initMesh = useCallback(async () => {
    if (!isNative()) return;
    try {
      setBleError(null);
      const bundle = await buildBundle();
      if (!bundle) return; // no profile yet
      await startMesh(JSON.stringify(bundle), {
        // Fires repeatedly (heartbeat) for every in-range device
        onPeerFound: (peer) => {
          lastSeenRef.current.set(peer.deviceId, Date.now());
          setNearbyPeers((prev) => {
            const found = prev.find((p) => p.deviceId === peer.deviceId);
            if (found) return prev.map((p) => p.deviceId === peer.deviceId ? { ...p, ...peer } : p);
            return [...prev, peer];
          });
          autoSync(peer); // gated by RESYNC_INTERVAL — re-syncs every ~5s while near
        },
        onSyncRequest: (req) => { approveSync(req.deviceId).catch(() => {}); },
        onChatMessage: () => {}, // chat now travels inside the bundle
      });
      setBleActive(true);
      await refreshStats();
    } catch (err) {
      const msg = err.message || "";
      setBleError(msg.includes("PERMISSION") || msg.includes("permission")
        ? "PERMISSION_DENIED" : (msg || "Bluetooth failed to start"));
    }
  }, [buildBundle, autoSync, refreshStats]);

  // Push the latest bundle to the native layer whenever stored data changes
  const refreshBundle = useCallback(async () => {
    if (!isNative() || !bleActive) return;
    const bundle = await buildBundle();
    if (bundle) await updateMeshBundle(JSON.stringify(bundle));
  }, [buildBundle, bleActive]);

  // ── Online (WebSocket) transport ──────────────────────────────────────────
  const startOnline = useCallback(() => {
    if (!serverUrl) { setOnlineError("Enter the server address"); return; }
    setOnlineError(null);
    startOnlineSync(
      serverUrl,
      roomCode,                          // shared room
      buildBundle,                       // fresh bundle on connect / heartbeat / change
      (b) => processMeshBundle(b),       // handle each peer's bundle
      (err) => setOnlineError(err),      // null on success
    );
    setOnlineActive(true);
  }, [serverUrl, roomCode, buildBundle, processMeshBundle]);

  // ── Transport selection — switches automatically on mode/server change ─────
  useEffect(() => {
    refreshStats();

    if (mode === "online") {
      // Stop BLE, start the WebSocket sync
      stopMesh().catch(() => {});
      setBleActive(false);
      setNearbyPeers([]);
      if (serverUrl) startOnline();
      else setOnlineError("Enter the server address");
      return () => stopOnlineSync();
    }

    // Offline (BLE) mode
    stopOnlineSync();
    setOnlineActive(false);
    setOnlineError(null);
    if (isNative()) {
      const t = setTimeout(() => initMesh(), 600);
      return () => { clearTimeout(t); stopMesh().catch(() => {}); setBleActive(false); };
    }
  }, [mode, serverUrl, roomCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Whenever local data changes, re-advertise it. BLE pushes to the native
  // advertiser; online mode pushes instantly over the WebSocket.
  useEffect(() => {
    refreshBundle();
    if (mode === "online") pushOnlineBundle();
  }, [dataVersion, refreshBundle, mode]);

  // Drop peers we haven't heard from recently (BLE walked out of range)
  useEffect(() => {
    if (!isNative()) return;
    const t = setInterval(() => {
      const now = Date.now();
      setNearbyPeers((prev) =>
        prev.filter((p) => now - (lastSeenRef.current.get(p.deviceId) || 0) < PEER_STALE_MS)
      );
    }, 10000);
    return () => clearInterval(t);
  }, []);

  // ── Mode + server setters (persisted) ──────────────────────────────────────
  const setMode = useCallback((m) => {
    localStorage.setItem(LS_MODE, m);
    setModeState(m);
  }, []);

  const saveServerUrl = useCallback((u) => {
    const v = (u || "").trim();
    if (v) {
      localStorage.setItem(LS_SERVER, v);
      setServerUrl(v);
    } else {
      // Cleared → fall back to the built-in default rather than going serverless.
      localStorage.removeItem(LS_SERVER);
      setServerUrl(DEFAULT_RELAY_URL);
    }
  }, []);

  const saveRoomCode = useCallback((r) => {
    const room = (r || DEFAULT_ROOM).trim().toLowerCase() || DEFAULT_ROOM;
    localStorage.setItem(LS_ROOM, room);
    setRoomCode(room);
  }, []);

  const testServer = useCallback((u, r) => pingServer(u, r), []);

  const value = {
    // mode
    mode, setMode, serverUrl, saveServerUrl, roomCode, saveRoomCode, testServer,
    onlineActive, onlineError, startOnline,
    // ble
    bleActive, bleError, nearbyPeers, syncing,
    // shared
    matches, peers, meshStats, dataVersion, bumpData,
    initMesh, retryMesh: () => { setBleError(null); initMesh(); },
    processMeshBundle, refreshStats, refreshBundle,
    isNative: isNative(),
    clearMatches: () => setMatches([]),
  };

  return <MeshContext.Provider value={value}>{children}</MeshContext.Provider>;
}
