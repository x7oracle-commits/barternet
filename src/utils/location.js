export const isGPSSupported = () => "geolocation" in navigator;

// Returns: 'granted' | 'denied' | 'prompt' | 'unknown'
export async function getLocationPermissionState() {
  if (!navigator.permissions) return "unknown";
  try {
    const result = await navigator.permissions.query({ name: "geolocation" });
    return result.state; // 'granted' | 'denied' | 'prompt'
  } catch {
    return "unknown";
  }
}

// Tries to get GPS position.
// Throws an error object with { code, message } where code is:
//   'DENIED'   — user blocked it, needs to re-enable manually
//   'UNAVAIL'  — no GPS signal
//   'TIMEOUT'  — took too long
//   'UNSUPPORTED'
export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!isGPSSupported()) {
      reject({ code: "UNSUPPORTED", message: "GPS not supported on this device" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat:      pos.coords.latitude,
          lng:      pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
          ts:       Date.now(),
        }),
      (err) => {
        // err.code: 1=PERMISSION_DENIED 2=POSITION_UNAVAILABLE 3=TIMEOUT
        const codes = { 1: "DENIED", 2: "UNAVAIL", 3: "TIMEOUT" };
        reject({ code: codes[err.code] || "UNAVAIL", message: err.message });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  });
}

export function formatCoords(lat, lng) {
  const la = Math.abs(lat).toFixed(5);
  const lo = Math.abs(lng).toFixed(5);
  return `${la}°${lat >= 0 ? "N" : "S"}, ${lo}°${lng >= 0 ? "E" : "W"}`;
}

export function formatCoordsDecimal(lat, lng) {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

export function locationLabel(location) {
  if (!location) return "Unknown";
  if (typeof location === "string") return location;
  return location.label || formatCoords(location.lat, location.lng);
}

export function geoUri(lat, lng, label = "") {
  if (label) return `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label)})`;
  return `geo:${lat},${lng}?q=${lat},${lng}`;
}

export async function copyCoords(lat, lng) {
  const text = formatCoordsDecimal(lat, lng);
  await navigator.clipboard.writeText(text);
  return text;
}
