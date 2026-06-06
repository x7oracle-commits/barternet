import { useState, useEffect, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Compass, MapPin, AlertCircle } from "lucide-react";
import {
  haversine, bearing, formatDistance, cardinalLabel,
  headingFromEvent, requestCompassPermission,
} from "../utils/navigation.js";
import { formatCoords } from "../utils/location.js";

// ── Compass SVG ────────────────────────────────────────────────────────────
// The rose (N/E/S/W ring) stays fixed.  Only the arrow rotates.
// arrowAngle: clockwise degrees from screen-up pointing toward the target.
function CompassRose({ arrowAngle, arrived, noHeading }) {
  const TICKS = Array.from({ length: 72 }, (_, i) => i * 5); // every 5°

  return (
    <svg viewBox="0 0 240 240" className="w-72 h-72 select-none">
      {/* Outer glow ring */}
      <circle cx="120" cy="120" r="112" fill="none"
        stroke={arrived ? "#4ade80" : "#6c63ff"}
        strokeWidth="2" opacity="0.3" />
      <circle cx="120" cy="120" r="108" fill="#1a1d2e" />

      {/* Tick marks */}
      {TICKS.map((deg) => {
        const isCard  = deg % 90 === 0;
        const isMajor = deg % 45 === 0;
        const rad = ((deg - 90) * Math.PI) / 180;
        const r1  = 104;
        const r2  = isCard ? 88 : isMajor ? 93 : 98;
        return (
          <line
            key={deg}
            x1={120 + r1 * Math.cos(rad)} y1={120 + r1 * Math.sin(rad)}
            x2={120 + r2 * Math.cos(rad)} y2={120 + r2 * Math.sin(rad)}
            stroke={isCard ? "rgba(255,255,255,0.55)" : isMajor ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.1)"}
            strokeWidth={isCard ? 2.5 : isMajor ? 1.5 : 1}
          />
        );
      })}

      {/* Cardinal labels */}
      {[["N", 0, "#f87171"], ["E", 90, "#94a3b8"], ["S", 180, "#94a3b8"], ["W", 270, "#94a3b8"]].map(
        ([dir, deg, color]) => {
          const rad = ((deg - 90) * Math.PI) / 180;
          return (
            <text key={dir}
              x={120 + 76 * Math.cos(rad)} y={120 + 76 * Math.sin(rad)}
              textAnchor="middle" dominantBaseline="middle"
              fill={color} fontSize="15" fontWeight="bold" fontFamily="system-ui">
              {dir}
            </text>
          );
        }
      )}

      {/* ── Rotating arrow group ── */}
      <g transform={`rotate(${arrowAngle ?? 0}, 120, 120)`}>
        {/* North tip (points toward target) */}
        <polygon
          points="120,28 128,90 120,80 112,90"
          fill={arrived ? "#4ade80" : "#6c63ff"}
          opacity="0.95"
        />
        {/* South tail */}
        <polygon
          points="120,212 128,150 120,160 112,150"
          fill="rgba(255,255,255,0.18)"
        />
        {/* Center circle */}
        <circle cx="120" cy="120" r="10"
          fill={arrived ? "#4ade80" : "#6c63ff"} />
        <circle cx="120" cy="120" r="5" fill="#1a1d2e" />
      </g>

      {/* No-heading hint ring */}
      {noHeading && (
        <circle cx="120" cy="120" r="108" fill="none"
          stroke="#fbbf24" strokeWidth="1.5" strokeDasharray="6 4" opacity="0.5" />
      )}
    </svg>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function Navigate() {
  const [params]  = useSearchParams();
  const goBack    = useNavigate();

  const targetLat  = parseFloat(params.get("lat")   || "0");
  const targetLng  = parseFloat(params.get("lng")   || "0");
  const peerName   = params.get("name")  || "Unknown";
  const peerLabel  = params.get("label") || "";

  const [myPos,       setMyPos]       = useState(null);   // { lat, lng, acc }
  const [deviceHead,  setDeviceHead]  = useState(null);   // degrees, 0 = North
  const [distance,    setDistance]    = useState(null);   // metres
  const [bearingDeg,  setBearingDeg]  = useState(null);   // degrees
  const [gpsError,    setGpsError]    = useState(null);
  const [compassOn,   setCompassOn]   = useState(false);
  const [compassErr,  setCompassErr]  = useState(null);
  const [needPrompt,  setNeedPrompt]  = useState(
    typeof DeviceOrientationEvent?.requestPermission === "function"
  );

  const watchRef = useRef(null);

  // Arrow rotation on screen: bearing from North minus device heading from North
  // → how far clockwise to rotate from "pointing up" to reach the target
  const arrowAngle =
    bearingDeg !== null && deviceHead !== null
      ? (bearingDeg - deviceHead + 360) % 360
      : bearingDeg; // fallback: absolute bearing (face North)

  const arrived   = distance !== null && distance < 30;
  const noHeading = deviceHead === null && compassOn;

  // ── GPS watch ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setGpsError("GPS not available on this device");
      return;
    }
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const p = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          acc: Math.round(pos.coords.accuracy),
        };
        setMyPos(p);
        setDistance(haversine(p.lat, p.lng, targetLat, targetLng));
        setBearingDeg(bearing(p.lat, p.lng, targetLat, targetLng));
        setGpsError(null);
      },
      (err) => {
        const codes = { 1: "DENIED", 2: "UNAVAIL", 3: "TIMEOUT" };
        setGpsError(codes[err.code] || "UNAVAIL");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
    return () => {
      if (watchRef.current != null)
        navigator.geolocation.clearWatch(watchRef.current);
    };
  }, []);

  // ── Auto-start compass on Android (no permission needed) ───────────────
  useEffect(() => {
    if (needPrompt) return; // iOS — wait for user tap
    attachCompassListeners();
    setCompassOn(true);
    return detachCompassListeners;
  }, [needPrompt]);

  function handleOrientEvent(e) {
    const h = headingFromEvent(e);
    if (h !== null) setDeviceHead(h);
  }

  function attachCompassListeners() {
    window.addEventListener("deviceorientationabsolute", handleOrientEvent, true);
    window.addEventListener("deviceorientation",         handleOrientEvent, true);
  }
  function detachCompassListeners() {
    window.removeEventListener("deviceorientationabsolute", handleOrientEvent, true);
    window.removeEventListener("deviceorientation",         handleOrientEvent, true);
  }

  // iOS: called when user taps "Enable Compass"
  async function enableCompass() {
    try {
      await requestCompassPermission();
      attachCompassListeners();
      setCompassOn(true);
      setNeedPrompt(false);
    } catch (err) {
      setCompassErr(err.message);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-barter-bg flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-white/10">
        <button
          onClick={() => goBack(-1)}
          className="p-2 rounded-xl active:bg-white/10 text-barter-muted"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">Navigating to {peerName}</p>
          <p className="text-xs text-barter-muted truncate">{peerLabel || formatCoords(targetLat, targetLng)}</p>
        </div>
        <MapPin size={18} className="text-barter-accent shrink-0" />
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6">

        {/* Arrived banner */}
        {arrived && (
          <div className="card border border-barter-green/40 bg-barter-green/10 text-center w-full">
            <p className="text-lg font-bold text-barter-green">You've arrived! 🎉</p>
            <p className="text-sm text-barter-muted mt-1">
              You are within 30 m of {peerName}. Look around and say hi!
            </p>
          </div>
        )}

        {/* GPS error */}
        {gpsError === "DENIED" && (
          <div className="card border border-barter-amber/40 bg-barter-amber/10 w-full space-y-3">
            <div className="flex items-center gap-2 font-semibold text-barter-amber">
              <AlertCircle size={16} /> Location permission blocked
            </div>
            <ol className="text-sm text-barter-muted space-y-1.5">
              <li><strong className="text-barter-text">1.</strong> Tap the lock icon in Chrome's address bar</li>
              <li><strong className="text-barter-text">2.</strong> Permissions → Location → Allow</li>
              <li><strong className="text-barter-text">3.</strong> Come back to this page — it will resume</li>
            </ol>
          </div>
        )}
        {gpsError === "UNAVAIL" && (
          <div className="card border border-barter-red/30 bg-barter-red/10 flex gap-3 w-full">
            <AlertCircle size={18} className="text-barter-red shrink-0 mt-0.5" />
            <p className="text-sm text-barter-muted">No GPS signal. Move outdoors and wait a moment.</p>
          </div>
        )}
        {gpsError === "TIMEOUT" && (
          <div className="card border border-barter-amber/30 bg-barter-amber/10 flex gap-3 w-full">
            <AlertCircle size={18} className="text-barter-amber shrink-0 mt-0.5" />
            <p className="text-sm text-barter-muted">GPS is slow. Move outdoors — it will retry automatically.</p>
          </div>
        )}

        {/* Compass */}
        <div className="relative">
          <CompassRose arrowAngle={arrowAngle} arrived={arrived} noHeading={noHeading} />

          {/* Distance badge in centre */}
          {distance !== null && (
            <div className="absolute inset-0 flex items-end justify-center pb-14 pointer-events-none">
              <div className="bg-barter-surface/90 rounded-xl px-4 py-1.5 text-center">
                <p className="text-xl font-bold text-barter-text tabular-nums">
                  {formatDistance(distance)}
                </p>
                {bearingDeg !== null && (
                  <p className="text-xs text-barter-muted">
                    {Math.round(bearingDeg)}° {cardinalLabel(bearingDeg)}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* iOS compass enable */}
        {needPrompt && (
          <button className="btn-primary flex items-center gap-2" onClick={enableCompass}>
            <Compass size={18} /> Enable Compass
          </button>
        )}
        {compassErr && (
          <p className="text-sm text-barter-red text-center">{compassErr}</p>
        )}

        {/* Hint when no compass heading */}
        {!compassOn && !needPrompt && (
          <p className="text-sm text-barter-muted text-center max-w-xs">
            Compass unavailable — arrow shows absolute bearing.{" "}
            <strong className="text-barter-text">Face North</strong> to align with the arrow.
          </p>
        )}
        {noHeading && (
          <p className="text-sm text-barter-amber text-center max-w-xs">
            Waiting for compass signal… try moving your phone in a figure-8.
          </p>
        )}

        {/* GPS accuracy & my coords */}
        {myPos && (
          <div className="space-y-1 text-center">
            <p className="text-xs text-barter-muted">
              Your position · ±{myPos.acc} m accuracy
            </p>
            <p className="text-xs font-mono text-barter-muted">
              {formatCoords(myPos.lat, myPos.lng)}
            </p>
          </div>
        )}

        {/* Target info */}
        <div className="card w-full bg-barter-surface space-y-1 text-sm">
          <p className="font-medium text-barter-text">Destination</p>
          <p className="text-barter-muted">{peerName}{peerLabel ? ` · ${peerLabel}` : ""}</p>
          <p className="font-mono text-xs text-barter-muted">{formatCoords(targetLat, targetLng)}</p>
        </div>

        {/* Legend */}
        <div className="text-center text-xs text-barter-muted space-y-1 max-w-xs">
          <p>
            The <span className="text-barter-accent font-semibold">purple arrow</span> points toward
            {" "}{peerName}. Walk in that direction.
          </p>
          <p>The arrow updates in real-time as you move.</p>
        </div>
      </div>
    </div>
  );
}
