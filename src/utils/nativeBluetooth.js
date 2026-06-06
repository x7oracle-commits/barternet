import { Capacitor, registerPlugin } from "@capacitor/core";
import { BleClient } from "@capacitor-community/bluetooth-le";

const BarterBluetooth = registerPlugin("BarterBluetooth");

export const isNative = () => Capacitor.isNativePlatform();

const SERVICE_UUID   = "12345678-1234-5678-1234-56789abcdef0";
const DATA_CHAR_UUID = "12345678-1234-5678-1234-56789abcdef1";
const CTRL_CHAR_UUID = "12345678-1234-5678-1234-56789abcdef2";
const CHAT_CHAR_UUID = "12345678-1234-5678-1234-56789abcdef3";

const TRANSFER_TIMEOUT_MS = 30_000;
const END_SEQ = 0xFFFF;

// ── Mesh lifecycle ────────────────────────────────────────────────────────────

export async function startMesh(bundleJson, { onPeerFound, onSyncRequest, onChatMessage }) {
  if (!isNative()) throw new Error("Native BLE only in APK");

  // Remove all previous listeners before adding new ones (prevents duplicates)
  BarterBluetooth.removeAllListeners();

  await BarterBluetooth.startMesh({ bundle: bundleJson });

  if (onPeerFound)    BarterBluetooth.addListener("peerFound",    onPeerFound);
  if (onSyncRequest)  BarterBluetooth.addListener("syncRequest",  onSyncRequest);
  if (onChatMessage)  BarterBluetooth.addListener("chatMessage",  onChatMessage);
}

export async function stopMesh() {
  if (!isNative()) return;
  BarterBluetooth.removeAllListeners();
  await BarterBluetooth.stopMesh().catch(() => {});
}

export async function updateMeshBundle(bundleJson) {
  if (!isNative()) return;
  await BarterBluetooth.updateBundle({ bundle: bundleJson }).catch(() => {});
}

export async function approveSync(deviceId) {
  return BarterBluetooth.approveSync({ deviceId });
}

export async function denySync(deviceId) {
  return BarterBluetooth.denySync({ deviceId }).catch(() => {});
}

// ── Chat ──────────────────────────────────────────────────────────────────────

/** Send a chat message to all connected peers via BLE */
export async function sendChatViaBLE(message, fromName) {
  if (!isNative()) throw new Error("Native only");
  return BarterBluetooth.sendChat({ message, fromName });
}

/**
 * Subscribe to chat messages from a specific peer device.
 * Used by the client side (after connecting to a peer's GATT server).
 */
export async function subscribePeerChat(deviceId, onMessage) {
  if (!isNative()) return;
  await BleClient.startNotifications(deviceId, SERVICE_UUID, CHAT_CHAR_UUID, (dataView) => {
    const raw   = new TextDecoder().decode(dataView.buffer);
    const parts = raw.split(" ", 2);
    onMessage({
      from:    parts.length > 1 ? parts[0] : "Peer",
      message: parts.length > 1 ? parts[1] : raw,
      ts:      Date.now(),
    });
  });
}

/** Write a chat message to a peer's CHAT characteristic (client side) */
export async function writeChatToPeer(deviceId, message, fromName) {
  if (!isNative()) return;
  const text    = `${fromName} ${message}`;
  const encoded = new TextEncoder().encode(text);
  await BleClient.writeWithoutResponse(deviceId, SERVICE_UUID, CHAT_CHAR_UUID,
    new DataView(encoded.buffer));
}

// ── Pull bundle via notifications ─────────────────────────────────────────────

export async function pullBundleFromPeer(deviceId) {
  if (!isNative()) throw new Error("Native only");

  await BleClient.initialize();
  await BleClient.connect(deviceId, () => {
    console.log("Disconnected from:", deviceId);
  });

  try {
    await BleClient.discoverServices(deviceId);

    const chunks = new Map();

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Transfer timed out — try moving closer")),
        TRANSFER_TIMEOUT_MS
      );

      BleClient.startNotifications(deviceId, SERVICE_UUID, DATA_CHAR_UUID, (dataView) => {
        const seq = (dataView.getUint8(0) << 8) | dataView.getUint8(1);
        if (seq === END_SEQ) { clearTimeout(timeout); resolve(); return; }
        const payload = new Uint8Array(dataView.buffer, 2, dataView.byteLength - 2);
        chunks.set(seq, payload.slice());
      })
      .then(() =>
        BleClient.writeWithoutResponse(deviceId, SERVICE_UUID, CTRL_CHAR_UUID,
          new DataView(new TextEncoder().encode("GET").buffer))
      )
      .catch((err) => { clearTimeout(timeout); reject(err); });
    });

    await BleClient.stopNotifications(deviceId, SERVICE_UUID, DATA_CHAR_UUID).catch(() => {});

    if (chunks.size === 0) throw new Error("No data received from peer");

    const totalBytes = Array.from(chunks.values()).reduce((n, c) => n + c.length, 0);
    const assembled  = new Uint8Array(totalBytes);
    let offset = 0;
    for (let i = 0; chunks.has(i); i++) {
      assembled.set(chunks.get(i), offset);
      offset += chunks.get(i).length;
    }

    const bundle = JSON.parse(new TextDecoder().decode(assembled));
    if (!bundle.app || bundle.app !== "BarterNet")
      throw new Error("Not a valid BarterNet bundle");
    return bundle;

  } finally {
    await BleClient.disconnect(deviceId).catch(() => {});
  }
}
