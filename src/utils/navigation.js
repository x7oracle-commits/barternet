const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

// Straight-line distance in metres between two GPS points (Haversine)
export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Clockwise bearing in degrees from (lat1,lng1) toward (lat2,lng2), 0 = North
export function bearing(lat1, lng1, lat2, lng2) {
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Human-readable distance
export function formatDistance(metres) {
  if (metres < 10)   return "< 10 m";
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

// Nearest cardinal / intercardinal direction label
export function cardinalLabel(deg) {
  const dirs = ["N","NE","E","SE","S","SW","W","NW"];
  return dirs[Math.round(deg / 45) % 8];
}

// Read compass heading from DeviceOrientationEvent (cross-platform)
export function headingFromEvent(e) {
  if (typeof e.webkitCompassHeading === "number") return e.webkitCompassHeading; // iOS
  if (e.absolute && e.alpha !== null) return (360 - e.alpha + 360) % 360;        // Android absolute
  return null;
}

// Request iOS permission for DeviceOrientationEvent (no-op on Android)
export async function requestCompassPermission() {
  if (typeof DeviceOrientationEvent?.requestPermission === "function") {
    const result = await DeviceOrientationEvent.requestPermission();
    if (result !== "granted") throw new Error("Compass permission denied");
  }
}
