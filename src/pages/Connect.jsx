import { useState, useRef } from "react";
import { Link } from "react-router-dom";
import {
  FileUp, FileDown, Share2, CheckCircle, Bell, MapPin,
  ExternalLink, Copy, Navigation, ChevronDown, ChevronUp,
  Bluetooth, Radio, Loader, RefreshCw, MessageCircle,
  Zap, Ban, UserMinus, MoreVertical,
} from "lucide-react";
import { locationLabel, formatCoords, geoUri, copyCoords } from "../utils/location.js";
import { db, getProfile } from "../db/db.js";
import { buildMeshBundle, downloadBundle, parseBundle } from "../utils/bluetooth.js";
import { signBundle } from "../utils/crypto.js";
import { useToast } from "../components/Toast.jsx";
import Modal from "../components/Modal.jsx";
import { useMesh } from "../context/MeshContext.jsx";
import Rating from "../components/Rating.jsx";

export default function Connect() {
  const toast   = useToast();
  const fileRef = useRef();
  const mesh    = useMesh();

  const {
    bleActive, bleError, nearbyPeers, syncing, matches, peers, meshStats,
    isNative, initMesh, retryMesh, processMeshBundle, mode, setMode,
    onlineActive, onlineError,
    buzzPeer, blockPeer, unblockPeer, removePeer, blockedPeers, reputations,
  } = mesh;

  const [showShareApp, setShowShareApp] = useState(false);
  const [showPeers,    setShowPeers]    = useState(false);
  const [showBlocked,  setShowBlocked]  = useState(false);
  const [peerMenu,     setPeerMenu]     = useState(null); // peer object for action sheet

  function handleBuzz(p) {
    buzzPeer(p.id);
    toast(`📳 Buzzed ${p.name}!`, "info");
  }

  // ── Browser fallback: file export / import ───────────────────────────────
  async function handleExport() {
    const profile = await getProfile();
    if (!profile) return toast("Set up your profile first", "error");
    const [items, allPeers] = await Promise.all([db.items.toArray(), db.peers.toArray()]);
    const myItems = items.filter((i) => i.type !== "want" && i.status === "available");
    const myWants = items.filter((i) => i.type === "want");
    const bundle  = buildMeshBundle(profile, myItems, myWants, allPeers);
    const signed  = profile.priv ? signBundle(bundle, profile.priv) : bundle;
    downloadBundle(signed, profile.name);
    toast("Saved! Send this file via Bluetooth to the other person.", "success");
  }

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const bundle = parseBundle(await file.text());
      const result = await processMeshBundle(bundle, { allowImages: true });
      if (result?.skipped) toast("That's your own file", "info");
      else if (result?.rejected === "unverified")
        toast("Couldn't verify that file — it may be tampered or from an old version", "error");
      else if (result?.rejected) toast("Not a valid BarterNet file", "error");
      else if (result?.matches) toast(`Match found from ${result.peerName}!`, "success");
      else toast(`Synced with ${result?.peerName || "peer"}`, "success");
    } catch {
      toast("Not a valid BarterNet file", "error");
    }
    e.target.value = "";
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-24">
      <div className="p-4 space-y-5">

        <div>
          <h1 className="text-xl font-bold mb-1">Connect</h1>
          <p className="text-sm text-barter-muted">
            {mode === "online"
              ? "Online — syncs over the internet"
              : isNative
              ? "Offline — connects via Bluetooth when someone is near"
              : "Offline — exchange items via Bluetooth file sharing"}
          </p>
        </div>

        {/* ── Mode toggle ──────────────────────────────────────────────────── */}
        <div className="flex gap-1 bg-barter-card rounded-xl p-1">
          {[
            ["offline", "📡 Offline", "Bluetooth"],
            ["online",  "🌐 Online",  "WiFi"],
          ].map(([v, label]) => (
            <button
              key={v}
              onClick={() => setMode(v)}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                mode === v ? "bg-barter-accent text-white" : "text-barter-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Online status panel ──────────────────────────────────────────── */}
        {mode === "online" && (
          <div className={`rounded-2xl p-5 text-center space-y-2 ${
            onlineActive && !onlineError
              ? "bg-barter-green/10 border border-barter-green/30"
              : "bg-barter-card"
          }`}>
            <div className="relative inline-block">
              <div className="text-3xl">🌐</div>
              {onlineActive && !onlineError && (
                <span className="absolute -top-0.5 -right-1 w-3 h-3 bg-barter-green rounded-full border-2 border-barter-surface animate-pulse" />
              )}
            </div>
            <p className="font-semibold">
              {onlineError ? "Connecting…" : onlineActive ? "Online" : "Starting…"}
            </p>
            <p className="text-xs text-barter-muted">
              {onlineError
                ? "Reaching the network — this can take a moment"
                : "You're on the network — people on BarterNet appear below"}
            </p>
          </div>
        )}

        {/* Live BLE status (APK) — offline mode only */}
        {mode === "offline" && isNative && (
          <div className={`rounded-2xl p-5 text-center space-y-2 ${
            bleActive ? "bg-barter-accent/10 border border-barter-accent/30" : "bg-barter-card"
          }`}>
            <div className="relative inline-block">
              <Radio size={36} className={bleActive ? "text-barter-accent" : "text-barter-muted"} />
              {bleActive && (
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-barter-green rounded-full border-2 border-barter-surface animate-pulse" />
              )}
            </div>
            <p className="font-semibold">
              {syncing ? "Connecting…" : bleActive ? "Searching for nearby traders" : "Bluetooth off"}
            </p>
            <p className="text-xs text-barter-muted">
              {bleActive
                ? "Works on every screen — you don't need to stay here"
                : "Tap to start"}
            </p>
            {!bleActive && (
              <button className="btn-primary text-sm py-2 px-6 mt-1" onClick={initMesh}>Start</button>
            )}
          </div>
        )}

        {/* Permission / error */}
        {mode === "offline" && bleError === "PERMISSION_DENIED" && (
          <div className="card border border-barter-amber/40 bg-barter-amber/10 space-y-3">
            <p className="font-semibold text-barter-amber text-sm">Bluetooth permission needed</p>
            <ol className="text-xs text-barter-muted space-y-1.5 list-decimal list-inside">
              <li>Settings → Apps → BarterNet → Permissions</li>
              <li>Enable <strong className="text-barter-text">Nearby devices</strong></li>
              <li>Come back and tap Retry</li>
            </ol>
            <button className="btn-primary w-full text-sm py-2 flex items-center justify-center gap-2" onClick={retryMesh}>
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        )}
        {mode === "offline" && bleError && bleError !== "PERMISSION_DENIED" && (
          <div className="card border border-barter-red/30 bg-barter-red/10 space-y-2">
            <p className="text-sm text-barter-muted">{bleError}</p>
            <button className="text-sm text-barter-accent underline" onClick={retryMesh}>Retry</button>
          </div>
        )}

        {/* Currently nearby */}
        {mode === "offline" && nearbyPeers.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-barter-muted font-semibold uppercase tracking-wide">Nearby</p>
            {nearbyPeers.map((peer) => (
              <div key={peer.deviceId} className="card flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-barter-accent/20 flex items-center justify-center shrink-0">
                  <Bluetooth size={18} className="text-barter-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{peer.name}</p>
                  <p className="text-xs text-barter-muted">
                    {syncing === peer.deviceId ? "Connecting…" : "Found nearby"}
                  </p>
                </div>
                {syncing === peer.deviceId && (
                  <Loader size={16} className="text-barter-accent animate-spin shrink-0" />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Matches */}
        {matches.length > 0 && (
          <div className="space-y-2">
            <h2 className="font-semibold flex items-center gap-2 text-barter-green">
              <Bell size={16} /> Match Found!
            </h2>
            {matches.map((m, i) => <MatchCard key={i} match={m} />)}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="card text-center">
            <p className="text-2xl font-bold text-barter-accent">{meshStats.peers}</p>
            <p className="text-xs text-barter-muted mt-1">People synced</p>
          </div>
          <div className="card text-center">
            <p className="text-2xl font-bold text-barter-green">{meshStats.items}</p>
            <p className="text-xs text-barter-muted mt-1">Items in network</p>
          </div>
        </div>

        {/* People met */}
        {peers.length > 0 && (
          <div className="space-y-2">
            <button onClick={() => setShowPeers((v) => !v)} className="flex items-center justify-between w-full">
              <h2 className="font-semibold">People You've Met ({peers.length})</h2>
              {showPeers ? <ChevronUp size={16} className="text-barter-muted" /> : <ChevronDown size={16} className="text-barter-muted" />}
            </button>
            {showPeers && peers.map((p) => {
              const hasGPS = p.location?.lat != null;
              return (
                <div key={p.id} className="card flex items-center gap-3">
                  <span className="text-2xl">{p.avatar || "👤"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{p.name}</p>
                    <p className="text-xs text-barter-muted flex items-center gap-1 mt-0.5">
                      <MapPin size={10} className={hasGPS ? "text-barter-green" : ""} />
                      <span className="truncate">{locationLabel(p.location)}</span>
                      <span>· {(p.items || []).length} items</span>
                    </p>
                    <div className="mt-0.5">
                      <Rating avg={reputations[p.id]?.avg || 0} count={reputations[p.id]?.count || 0} />
                    </div>
                    {hasGPS && (
                      <a href={geoUri(p.location.lat, p.location.lng, p.name)} target="_blank" rel="noreferrer"
                        className="text-xs text-barter-accent flex items-center gap-1 mt-0.5">
                        <ExternalLink size={10} /> Open in map
                      </a>
                    )}
                  </div>
                  <div className="flex items-center shrink-0">
                    <button onClick={() => handleBuzz(p)} title="Buzz"
                      className="text-barter-amber p-2 active:bg-white/10 rounded-lg">
                      <Zap size={18} />
                    </button>
                    <Link
                      to={`/chat?peerId=${p.id}&peerName=${encodeURIComponent(p.name)}`}
                      className="text-barter-accent p-2 active:bg-white/10 rounded-lg"
                    >
                      <MessageCircle size={18} />
                    </Link>
                    <button onClick={() => setPeerMenu(p)} title="More"
                      className="text-barter-muted p-2 active:bg-white/10 rounded-lg">
                      <MoreVertical size={18} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Blocked people */}
        {blockedPeers.length > 0 && (
          <div className="space-y-2">
            <button onClick={() => setShowBlocked((v) => !v)} className="flex items-center justify-between w-full">
              <h2 className="font-semibold text-barter-muted">Blocked ({blockedPeers.length})</h2>
              {showBlocked ? <ChevronUp size={16} className="text-barter-muted" /> : <ChevronDown size={16} className="text-barter-muted" />}
            </button>
            {showBlocked && blockedPeers.map((b) => (
              <div key={b.id} className="card flex items-center gap-3">
                <Ban size={18} className="text-barter-red shrink-0" />
                <p className="flex-1 min-w-0 font-medium truncate">{b.name}</p>
                <button onClick={() => unblockPeer(b.id)}
                  className="text-sm text-barter-accent px-3 py-1.5 active:bg-white/10 rounded-lg shrink-0">
                  Unblock
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Browser fallback file exchange (offline mode only) */}
        {mode === "offline" && !isNative && (
          <div className="space-y-3">
            <p className="text-sm text-barter-muted text-center">
              Install the APK for automatic discovery. In browser, use file exchange:
            </p>
            <button className="btn-primary w-full flex items-center gap-4 py-4" onClick={handleExport}>
              <FileUp size={22} />
              <div className="text-left">
                <p className="font-semibold">Share My Items</p>
                <p className="text-xs opacity-75">Save file → send via Bluetooth</p>
              </div>
            </button>
            <button className="w-full flex items-center gap-4 py-4 px-5 bg-barter-card rounded-xl active:opacity-80"
              onClick={() => fileRef.current.click()}>
              <FileDown size={22} className="text-barter-green" />
              <div className="text-left">
                <p className="font-semibold">Receive Items</p>
                <p className="text-xs text-barter-muted">Open a file someone shared</p>
              </div>
            </button>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFile} />
          </div>
        )}

        {/* Share app */}
        <div className="card border border-dashed border-white/20 space-y-2">
          <p className="font-semibold text-sm flex items-center gap-2">
            <Share2 size={15} className="text-barter-accent" /> Share BarterNet
          </p>
          <p className="text-xs text-barter-muted">Send the APK to a friend via Bluetooth so they can join</p>
          <button className="btn-primary w-full text-sm py-2" onClick={() => setShowShareApp(true)}>
            How to share the app
          </button>
        </div>
      </div>

      {showShareApp && (
        <Modal title="Share BarterNet" onClose={() => setShowShareApp(false)} center>
          <div className="space-y-4 text-sm text-barter-muted">
            <p>Send the BarterNet APK to a friend:</p>
            <ol className="list-decimal list-inside space-y-1.5">
              <li>Open <strong className="text-barter-text">Files</strong> → find <code>BarterNet.apk</code></li>
              <li>Share → <strong className="text-barter-text">Bluetooth</strong> → select their device</li>
              <li>They accept → tap to install (allow unknown sources)</li>
              <li>Both open the app near each other → auto-connects!</li>
            </ol>
          </div>
        </Modal>
      )}

      {/* Per-peer action sheet: Buzz / Disconnect / Block */}
      {peerMenu && (
        <Modal title={peerMenu.name} onClose={() => setPeerMenu(null)} center>
          <div className="space-y-2">
            <button
              className="w-full flex items-center gap-3 py-3 px-4 bg-barter-card rounded-xl active:opacity-80"
              onClick={() => { handleBuzz(peerMenu); setPeerMenu(null); }}
            >
              <Zap size={18} className="text-barter-amber shrink-0" />
              <span className="font-medium">Buzz</span>
            </button>

            <button
              className="w-full flex items-center gap-3 py-3 px-4 bg-barter-card rounded-xl active:opacity-80 text-left"
              onClick={() => { removePeer(peerMenu.id); toast(`Removed ${peerMenu.name}`, "info"); setPeerMenu(null); }}
            >
              <UserMinus size={18} className="text-barter-muted shrink-0" />
              <span>
                <span className="font-medium block">Disconnect</span>
                <span className="text-xs text-barter-muted">Remove now — they can reconnect later</span>
              </span>
            </button>

            <button
              className="w-full flex items-center gap-3 py-3 px-4 bg-barter-red/10 rounded-xl active:opacity-80 text-left"
              onClick={() => { blockPeer(peerMenu.id, peerMenu.name); toast(`Blocked ${peerMenu.name}`, "info"); setPeerMenu(null); }}
            >
              <Ban size={18} className="text-barter-red shrink-0" />
              <span>
                <span className="font-medium block text-barter-red">Block</span>
                <span className="text-xs text-barter-muted">Hide them and ignore everything they send</span>
              </span>
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Match card ────────────────────────────────────────────────────────────────
function MatchCard({ match: m }) {
  const [copied, setCopied] = useState(false);
  const loc    = m.peerLocation;
  const hasGPS = loc?.lat != null;

  async function handleCopy() {
    await copyCoords(loc.lat, loc.lng);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="card border border-barter-green/30 bg-barter-green/5 space-y-3">
      <div className="flex items-start gap-2">
        <CheckCircle size={16} className="text-barter-green mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium">
            You wanted: <span className="text-barter-green">{m.wantTitle}</span>
          </p>
          <p className="text-sm">Found: <strong>{m.item.title}</strong></p>
        </div>
      </div>
      <div className="pl-6 space-y-1.5">
        <p className="text-sm font-medium">{m.peerName}</p>
        <div className="flex items-center gap-1.5 text-xs text-barter-muted">
          <MapPin size={11} className={hasGPS ? "text-barter-green" : ""} />
          <span>{locationLabel(loc)}</span>
        </div>
        {hasGPS && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-barter-muted">{formatCoords(loc.lat, loc.lng)}</span>
            <button onClick={handleCopy} className="text-barter-muted p-0.5">
              {copied ? <CheckCircle size={12} className="text-barter-green" /> : <Copy size={12} />}
            </button>
          </div>
        )}
      </div>
      {hasGPS && (
        <Link
          to={`/navigate?lat=${loc.lat}&lng=${loc.lng}&name=${encodeURIComponent(m.peerName)}&label=${encodeURIComponent(locationLabel(loc))}`}
          className="flex items-center justify-center gap-2 btn-primary py-2.5 text-sm"
        >
          <Navigation size={16} /> Navigate There
        </Link>
      )}
    </div>
  );
}
