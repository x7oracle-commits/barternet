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

// v3 — blocked peers + outgoing buzzes (nudges)
db.version(3).stores({
  profile: "id",
  items: "++id, category, status, createdAt",
  trades: "++id, status, withPeerId, createdAt",
  peers: "id, lastSeen",
  messages: "id, peerId, ts, [peerId+ts]",
  blocked: "id",        // peerId -> { id, name, ts }
  buzzes: "++id, ts",   // outgoing buzzes I've sent -> { toPeerId, ts }
});

// v4 — signed reputation ratings (gossiped across the mesh)
db.version(4).stores({
  profile: "id",
  items: "++id, category, status, createdAt",
  trades: "++id, status, withPeerId, createdAt",
  peers: "id, lastSeen",
  messages: "id, peerId, ts, [peerId+ts]",
  blocked: "id",
  buzzes: "++id, ts",
  // id = `${raterId}:${tradeId}` -> one rating per rater per trade
  ratings: "id, ratedId, raterId, ts",
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

// ── Blocking ──────────────────────────────────────────────────────────────────

export async function isBlocked(peerId) {
  if (!peerId) return false;
  return !!(await db.blocked.get(peerId));
}

export async function getBlocked() {
  return db.blocked.orderBy("id").toArray();
}

// Block a peer: record them and wipe their presence (met-list entry + gossiped
// items). Their incoming bundles are rejected from then on (see processMeshBundle).
export async function blockPeer(peerId, name) {
  if (!peerId) return;
  await db.blocked.put({ id: peerId, name: name || "Unknown", ts: Date.now() });
  await db.peers.delete(peerId).catch(() => {});
}

export async function unblockPeer(peerId) {
  await db.blocked.delete(peerId);
}

// "Disconnect" — remove a peer's local data without permanently blocking them.
// They can reappear if you sync again (unlike block).
export async function removePeer(peerId) {
  if (!peerId) return;
  await db.peers.delete(peerId).catch(() => {});
}

// ── Buzz (nudge) ────────────────────────────────────────────────────────────

const BUZZ_FRESH_MS = 60_000;   // include in outgoing bundles for this long
const BUZZ_KEEP_MS  = 5 * 60_000; // then prune

export async function addBuzz(toPeerId) {
  if (!toPeerId) return;
  await db.buzzes.add({ toPeerId, ts: Date.now() });
  // opportunistic cleanup of old buzzes
  const cutoff = Date.now() - BUZZ_KEEP_MS;
  const old = await db.buzzes.where("ts").below(cutoff).primaryKeys();
  if (old.length) await db.buzzes.bulkDelete(old);
}

// Recent buzzes to ride along in the outgoing bundle so peers receive them.
export async function getRecentBuzzes() {
  const cutoff = Date.now() - BUZZ_FRESH_MS;
  return db.buzzes.where("ts").above(cutoff).toArray();
}

// ── Ratings (reputation) ──────────────────────────────────────────────────────

export async function saveRating(rating) {
  return db.ratings.put(rating); // idempotent on id
}

export async function getAllRatings() {
  return db.ratings.toArray();
}

// Ratings to gossip in the outgoing bundle. We forward the freshest ones (ours
// and others' we've collected) so reputation spreads even when a rater is offline.
const RATINGS_BUNDLE_LIMIT = 150;
export async function getRatingsForBundle() {
  return db.ratings.orderBy("ts").reverse().limit(RATINGS_BUNDLE_LIMIT).toArray();
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
