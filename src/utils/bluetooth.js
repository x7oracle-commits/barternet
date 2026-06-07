// BarterNet Bluetooth Utility
//
// UUID strategy: both the requestDevice filter and requestLEScan filter
// use BARTER_SERVICE_UUID so ONLY devices advertising this UUID are shown
// or discovered — all other Bluetooth devices (headphones, keyboards, etc.) are
// hidden from the picker and from background scans.
//
// Two modes:
//   1. requestDevice()   — user taps "Scan", browser shows a one-time picker
//                          filtered to BarterNet devices only.
//   2. requestLEScan()   — continuous passive background scan; fires an event
//                          every time any BarterNet device is in range.
//                          Requires Chrome flag:
//                          chrome://flags/#enable-experimental-web-platform-features

export const BARTER_SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0";
export const BARTER_CHAR_UUID    = "12345678-1234-5678-1234-56789abcdef1";

// ── Capability detection ─────────────────────────────────────────────────────

export const isBluetoothSupported = () =>
  typeof navigator !== "undefined" && "bluetooth" in navigator;

export const isScanSupported = () =>
  isBluetoothSupported() && typeof navigator.bluetooth.requestLEScan === "function";

// ── One-shot scan (standard Web Bluetooth) ───────────────────────────────────
// Shows the browser's native device picker, pre-filtered to BarterNet UUID only.

export async function pickBarterDevice() {
  if (!isBluetoothSupported())
    throw new Error("Web Bluetooth not available. Use Chrome or Edge on desktop/Android.");

  return navigator.bluetooth.requestDevice({
    filters: [
      { services: [BARTER_SERVICE_UUID] },
      { namePrefix: "BarterNet" },        // fallback: device named "BarterNet-*"
    ],
    optionalServices: [BARTER_SERVICE_UUID],
  });
}

// After picking, try to read data over GATT
export async function readPeerDataFromDevice(device) {
  const server  = await device.gatt.connect();
  const service = await server.getPrimaryService(BARTER_SERVICE_UUID);
  const char    = await service.getCharacteristic(BARTER_CHAR_UUID);
  const value   = await char.readValue();
  const text    = new TextDecoder().decode(value);
  return JSON.parse(text);
}

// ── Continuous passive scan (experimental) ───────────────────────────────────
// Fires onDeviceFound(device, rssi) whenever a BarterNet device is nearby.
// Returns a stop() function. No user gesture needed after first permission grant.
//
// Enable at: chrome://flags/#enable-experimental-web-platform-features

let activeScan = null;

export async function startPassiveScan(onDeviceFound) {
  if (!isScanSupported())
    throw new Error(
      "Passive scan needs Chrome with experimental features enabled.\n" +
      "Go to: chrome://flags/#enable-experimental-web-platform-features → Enable → Relaunch"
    );

  if (activeScan) activeScan.stop();

  // Only receive advertisements from our service UUID — nothing else
  const scan = await navigator.bluetooth.requestLEScan({
    filters: [{ services: [BARTER_SERVICE_UUID] }],
    keepRepeatedDevices: false, // only alert once per device per scan session
  });

  const handler = (event) => {
    onDeviceFound({
      device: event.device,
      name:   event.device.name || "Unknown",
      rssi:   event.rssi,
      id:     event.device.id,
    });
  };

  navigator.bluetooth.addEventListener("advertisementreceived", handler);

  activeScan = {
    stop() {
      scan.stop();
      navigator.bluetooth.removeEventListener("advertisementreceived", handler);
      activeScan = null;
    },
  };

  return activeScan;
}

export function stopPassiveScan() {
  activeScan?.stop();
}

export function isPassiveScanActive() {
  return activeScan !== null;
}

// ── File-based exchange (works on ALL devices, any browser) ─────────────────
// Primary data transfer method. User exports JSON → shares via OS Bluetooth
// file transfer → receiver imports in the app.

export function buildMeshBundle(profile, myItems, myWants, knownPeers) {
  // Guard: profile is required; arrays default to [] so bundle is always valid JSON
  if (!profile) throw new Error("Profile not set — complete onboarding first");
  const safeItems = Array.isArray(myItems) ? myItems : [];
  const safeWants = Array.isArray(myWants) ? myWants : [];
  const safePeers = Array.isArray(knownPeers) ? knownPeers : [];

  return {
    v: 1,
    app: "BarterNet",
    ts: Date.now(),
    peer: {
      id:       profile.uid || profile.id || "unknown",
      name:     profile.name || "Anonymous",
      avatar:   profile.avatar || "👤",
      location: profile.location || null,
      // Public key lets receivers verify this bundle really came from us.
      pub:      profile.pub || null,
    },
    items: safeItems.filter((i) => i.status === "available"),
    wants: safeWants.map((w) => ({ title: w.title })),
    mesh: safePeers.map((p) => ({
      id:       p.id,
      name:     p.name,
      location: p.location,
      avatar:   p.avatar || null,
      pub:      p.pub || null,
      items:    Array.isArray(p.items) ? p.items : [],
    })),
  };
}

// Strip image fields before BLE transfer — images are base64 and can be 200KB+,
// which overflows BLE notification queues. The text data is all that matters for matching.
function stripImages(items) {
  // eslint-disable-next-line no-unused-vars
  return items.map(({ image, ...rest }) => rest);
}

// trades: full array from db.trades — offers and responses are extracted here
// messages: unsynced chat messages I've sent
// buzzes: recent nudges I've sent -> { toPeerId, ts }
// ratings: signed reputation ratings to gossip (self-contained, verified on receipt)
export function buildBleBundle(profile, myItems, myWants, knownPeers, trades = [], messages = [], buzzes = [], ratings = []) {
  const bundle = buildMeshBundle(profile, myItems, myWants, knownPeers);
  bundle.items = stripImages(bundle.items);
  bundle.mesh  = bundle.mesh.map((p) => ({ ...p, items: stripImages(p.items || []) }));

  const myId = profile.uid || profile.id;

  // Outgoing offers — let each peer filter which ones are addressed to them
  bundle.offers = trades
    .filter((t) => t.initiatedByMe && ["pending_send", "offered"].includes(t.status) && t.myItem && t.theirItem)
    .map((t) => ({
      id:        t.id,
      toPeerId:  t.withPeerId,
      fromId:    myId,
      fromName:  profile.name,
      myItem:    { id: t.myItem.id, title: t.myItem.title, category: t.myItem.category },
      theirItem: { id: t.theirItem.id, title: t.theirItem.title },
      message:   t.message || "",
      ts:        t.createdAt,
    }));

  // Responses to incoming offers — send back so the offerer learns the result
  bundle.responses = trades
    .filter((t) => !t.initiatedByMe && ["accepted", "declined_by_me"].includes(t.status) && !t.responseSynced)
    .map((t) => ({
      tradeId:  t.id,
      toPeerId: t.withPeerId,
      status:   t.status === "accepted" ? "accepted" : "declined",
      reason:   t.declineReason || "",
    }));

  // Chat messages I've sent that the recipient may not have yet
  bundle.messages = messages.map((m) => ({
    id:       m.id,
    toPeerId: m.peerId,   // recipient
    fromId:   myId,
    fromName: profile.name,
    text:     m.text,
    ts:       m.ts,
  }));

  // Buzzes (nudges) I've recently sent — ride along so the recipient feels them
  bundle.buzzes = buzzes.map((z) => ({
    toPeerId: z.toPeerId,
    fromId:   myId,
    fromName: profile.name,
    ts:       z.ts,
  }));

  // Signed reputation ratings — already self-contained; forward as-is to gossip
  // them across the network. The receiver verifies each one independently.
  bundle.ratings = ratings;

  return bundle;
}

export function downloadBundle(bundle, name) {
  const json = JSON.stringify(bundle, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `barternet-${name.replace(/\s+/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Parse an imported file into a raw bundle. We intentionally do NOT sanitize
// here: the signature must be checked against the exact bytes that were signed,
// so processMeshBundle verifies the raw object first, then sanitizes for storage.
// We only guard size and the app tag so obviously-wrong files fail fast.
export function parseBundle(jsonString) {
  if (jsonString && jsonString.length > 8_000_000)
    throw new Error("File too large");
  const data = JSON.parse(jsonString);
  if (!data || data.app !== "BarterNet")
    throw new Error("Not a valid BarterNet bundle");
  return data;
}
