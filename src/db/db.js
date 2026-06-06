import Dexie from "dexie";
import { generateIdentity } from "../utils/crypto.js";

export const db = new Dexie("BarterNet");

db.version(1).stores({
  profile: "id",
  items: "++id, category, status, createdAt",
  trades: "++id, status, withPeerId, createdAt",
  peers: "id, lastSeen",
});

// v2 — chat messages between peers
db.version(2).stores({
  profile: "id",
  items: "++id, category, status, createdAt",
  trades: "++id, status, withPeerId, createdAt",
  peers: "id, lastSeen",
  // id is a deterministic hash so the same message isn't stored twice when synced
  messages: "id, peerId, ts, [peerId+ts]",
});

export async function getProfile() {
  return db.profile.get("me");
}

export async function saveProfile(data) {
  // id: "me" must come last so it can never be overwritten by caller data
  return db.profile.put({ ...data, id: "me" });
}

export async function addItem(item) {
  return db.items.add({ ...item, status: "available", createdAt: Date.now() });
}

export async function updateItem(id, changes) {
  return db.items.update(id, changes);
}

export async function deleteItem(id) {
  return db.items.delete(id);
}

export async function getMyItems() {
  return db.items.orderBy("createdAt").reverse().toArray();
}

export async function addTrade(trade) {
  return db.trades.add({ ...trade, createdAt: Date.now() });
}

export async function updateTrade(id, changes) {
  return db.trades.update(id, changes);
}

export async function getTrades() {
  return db.trades.orderBy("createdAt").reverse().toArray();
}

export async function upsertPeer(peer) {
  return db.peers.put({ ...peer, lastSeen: Date.now() });
}

export async function getPeers() {
  return db.peers.toArray();
}

// Backfill a signing identity for profiles created before signing existed, so
// their outgoing bundles can be verified by peers. Runs once on app launch.
export async function ensureIdentity() {
  const prof = await db.profile.get("me");
  if (prof && !prof.priv) {
    const id = generateIdentity();
    const migrated = { ...prof, uid: id.uid, pub: id.pub, priv: id.priv };
    await db.profile.put(migrated);
    return migrated;
  }
  return prof;
}

// Bound IndexedDB growth: drop peers we haven't heard from in a long time.
// Their gossiped item lists are stale anyway and will re-arrive if still around.
const PEER_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export async function pruneStalePeers(maxAgeMs = PEER_MAX_AGE_MS) {
  const cutoff = Date.now() - maxAgeMs;
  const stale = await db.peers.filter((p) => (p.lastSeen || 0) < cutoff).primaryKeys();
  if (stale.length) await db.peers.bulkDelete(stale);
  return stale.length;
}

// ── Messages ────────────────────────────────────────────────────────────────

// Deterministic ID so re-syncing the same message doesn't create duplicates
export function messageId(fromId, toId, ts, text) {
  let hash = 0;
  const str = `${fromId}|${toId}|${ts}|${text}`;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return `m${Math.abs(hash)}_${ts}`;
}

export async function addMessage(msg) {
  // peerId = the OTHER person in the conversation (for grouping)
  return db.messages.put(msg); // put = idempotent on id
}

export async function getMessagesWith(peerId) {
  return db.messages.where("peerId").equals(peerId).sortBy("ts");
}

export async function getUnsyncedMessages() {
  return db.messages.filter((m) => m.mine && !m.synced).toArray();
}
