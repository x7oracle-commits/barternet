import { useState, useEffect } from "react";
import { Navigation, MapPin, Copy, CheckCircle, Loader, ExternalLink, Lock, RefreshCw, AlertTriangle } from "lucide-react";
import {
  isGPSSupported, getCurrentPosition, getLocationPermissionState,
  formatCoords, geoUri, copyCoords,
} from "../utils/location.js";

// value: { lat, lng, accuracy, label } | null
// onChange(newValue)
export default function LocationPicker({ value, onChange, labelPlaceholder }) {
  const [loading,    setLoading]    = useState(false);
  const [permState,  setPermState]  = useState(null); // 'granted'|'denied'|'prompt'|'unknown'
  const [gpsError,   setGpsError]   = useState(null); // 'UNAVAIL' | 'TIMEOUT' etc.
  const [copied,     setCopied]     = useState(false);

  const hasCoords = value?.lat != null && value?.lng != null;

  // Check current permission state on mount and after each attempt
  useEffect(() => {
    checkPerm();
  }, []);

  async function checkPerm() {
    const state = await getLocationPermissionState();
    setPermState(state);
  }

  async function getGPS() {
    if (!isGPSSupported()) {
      setGpsError("UNSUPPORTED");
      return;
    }

    // Re-check before attempting — state may have changed since mount
    const state = await getLocationPermissionState();
    setPermState(state);

    if (state === "denied") {
      // Can't re-ask once denied — show instructions instead
      return;
    }

    setLoading(true);
    setGpsError(null);
    try {
      const pos = await getCurrentPosition();
      onChange({ ...(value || {}), lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy });
      setPermState("granted");
    } catch (err) {
      if (err.code === "DENIED") setPermState("denied");
      else setGpsError(err.code);
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!hasCoords) return;
    await copyCoords(value.lat, value.lng);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const isDenied = permState === "denied";

  return (
    <div className="space-y-3">

      {/* ── GPS button ────────────────────────────────────────────────── */}
      {isGPSSupported() && !isDenied && (
        <button
          type="button"
          onClick={getGPS}
          disabled={loading}
          className={`w-full flex items-center gap-3 py-3 px-4 rounded-xl transition-colors active:opacity-80 disabled:opacity-50 ${
            hasCoords
              ? "bg-barter-green/10 border border-barter-green/30"
              : "bg-barter-card"
          }`}
        >
          {loading
            ? <Loader size={18} className="text-barter-accent animate-spin shrink-0" />
            : <Navigation size={18} className={hasCoords ? "text-barter-green" : "text-barter-accent"} strokeWidth={1.8} />
          }
          <span className={`text-sm font-medium ${hasCoords ? "text-barter-green" : ""}`}>
            {loading ? "Getting GPS position…" : hasCoords ? "GPS captured ✓  (tap to update)" : "Pin My GPS Location"}
          </span>
        </button>
      )}

      {/* ── Permission denied — clear fix instructions ─────────────── */}
      {isDenied && (
        <div className="rounded-xl border border-barter-amber/40 bg-barter-amber/10 p-4 space-y-3">
          <div className="flex items-center gap-2 font-semibold text-barter-amber">
            <Lock size={16} />
            <span>Location permission is blocked</span>
          </div>

          <p className="text-sm text-barter-muted">
            Chrome remembered your earlier "Deny". To allow it now:
          </p>

          <ol className="text-sm text-barter-muted space-y-2">
            <li className="flex gap-2">
              <span className="text-barter-amber font-bold shrink-0">1.</span>
              <span>
                Tap the <strong className="text-barter-text">lock / info icon</strong> in
                Chrome's address bar (left of the URL)
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-barter-amber font-bold shrink-0">2.</span>
              <span>
                Tap <strong className="text-barter-text">Permissions</strong> →{" "}
                <strong className="text-barter-text">Location</strong> → set to{" "}
                <strong className="text-barter-text">Allow</strong>
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-barter-amber font-bold shrink-0">3.</span>
              <span>Come back and tap the button below</span>
            </li>
          </ol>

          <button
            type="button"
            onClick={async () => { await checkPerm(); if (permState !== "denied") getGPS(); else getGPS(); }}
            className="w-full flex items-center justify-center gap-2 btn-primary py-2.5 text-sm"
          >
            <RefreshCw size={15} /> I've enabled it — Try Again
          </button>
        </div>
      )}

      {/* ── Other GPS errors ──────────────────────────────────────────── */}
      {gpsError === "UNAVAIL" && (
        <div className="flex items-start gap-2 rounded-xl bg-barter-red/10 border border-barter-red/30 px-4 py-3">
          <AlertTriangle size={16} className="text-barter-red shrink-0 mt-0.5" />
          <div className="text-sm text-barter-muted">
            <p className="font-medium text-barter-red">No GPS signal</p>
            <p>Move outdoors or near a window and try again.</p>
          </div>
        </div>
      )}
      {gpsError === "TIMEOUT" && (
        <div className="flex items-start gap-2 rounded-xl bg-barter-amber/10 border border-barter-amber/30 px-4 py-3">
          <AlertTriangle size={16} className="text-barter-amber shrink-0 mt-0.5" />
          <p className="text-sm text-barter-muted">GPS took too long. Move outdoors and tap again.</p>
        </div>
      )}
      {gpsError === "UNSUPPORTED" && (
        <p className="text-sm text-barter-red">GPS not supported on this device.</p>
      )}

      {/* ── Coordinate display ─────────────────────────────────────────── */}
      {hasCoords && (
        <div className="bg-barter-surface rounded-xl px-4 py-3 flex items-center gap-3">
          <MapPin size={15} className="text-barter-green shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-mono text-barter-text">{formatCoords(value.lat, value.lng)}</p>
            {value.accuracy && (
              <p className="text-xs text-barter-muted mt-0.5">±{value.accuracy} m accuracy</p>
            )}
          </div>
          <div className="flex gap-1">
            <button type="button" onClick={handleCopy} title="Copy coordinates" className="p-1.5 rounded-lg active:bg-white/10 text-barter-muted">
              {copied ? <CheckCircle size={15} className="text-barter-green" /> : <Copy size={15} />}
            </button>
            <a href={geoUri(value.lat, value.lng, value.label)} target="_blank" rel="noreferrer" title="Open in map app" className="p-1.5 rounded-lg active:bg-white/10 text-barter-muted">
              <ExternalLink size={15} />
            </a>
          </div>
        </div>
      )}

      {/* ── Text label ─────────────────────────────────────────────────── */}
      <div>
        <label className="block text-xs text-barter-muted mb-1.5 font-medium uppercase tracking-wide">
          Area / Landmark Name
        </label>
        <input
          value={value?.label || ""}
          onChange={(e) => onChange({ ...(value || {}), label: e.target.value })}
          placeholder={labelPlaceholder || "e.g. Near East Market, Block 4B…"}
          maxLength={80}
        />
        <p className="text-xs text-barter-muted mt-1">
          Shown to others so they know where to meet you
        </p>
      </div>
    </div>
  );
}
