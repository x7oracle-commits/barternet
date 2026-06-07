// Decentralized, tamper-proof reputation.
//
// When you complete a trade you rate the other person. That rating is
// individually signed with your Ed25519 key and carries your public key, so it
// can travel hop-to-hop across the mesh and ANY device can verify it came from
// you and wasn't altered — no central server needed.
//
// A rating is identified by `raterId:tradeId`, so each person can leave exactly
// one rating per trade (re-rating overwrites).

import { signObject, verifyObject, fingerprintOf } from "./crypto.js";

export const MAX_STARS = 5;

/**
 * Build a signed rating. `me` is the rater's profile (needs uid, pub, priv).
 * Returns the rating object including `id` and `sig`, ready to store + broadcast.
 */
export function buildRating(me, ratedId, stars, tradeId, comment = "") {
  const raterId = me.uid || me.id;
  if (!raterId || !me.priv || !me.pub) throw new Error("No signing identity");
  if (raterId === ratedId) throw new Error("Cannot rate yourself");

  const s = Math.max(1, Math.min(MAX_STARS, Math.round(stars) || 0));
  const rating = {
    id: `${raterId}:${tradeId}`,
    raterId,
    raterPub: me.pub,
    ratedId,
    tradeId: String(tradeId),
    stars: s,
    comment: (comment || "").slice(0, 280),
    ts: Date.now(),
  };
  rating.sig = signObject(rating, me.priv);
  return rating;
}

/**
 * Verify a rating is authentic: its public key fingerprints to the claimed
 * raterId, it isn't a self-rating, and the signature checks out. This holds no
 * matter who forwarded it, which is what makes reputation gossipable.
 */
export function verifyRating(r) {
  if (!r || typeof r !== "object") return false;
  if (!r.raterId || !r.ratedId || !r.raterPub || !r.sig) return false;
  if (r.raterId === r.ratedId) return false;
  if (typeof r.stars !== "number" || r.stars < 1 || r.stars > MAX_STARS) return false;
  if (fingerprintOf(r.raterPub) !== r.raterId) return false;
  return verifyObject(r, r.sig, r.raterPub);
}

/** Aggregate a flat list of ratings into { peerId: { avg, count } }. */
export function aggregateReputations(ratings) {
  const byPeer = new Map();
  for (const r of ratings) {
    const g = byPeer.get(r.ratedId) || { sum: 0, count: 0 };
    g.sum += r.stars;
    g.count += 1;
    byPeer.set(r.ratedId, g);
  }
  const out = {};
  for (const [id, g] of byPeer) {
    out[id] = { avg: g.sum / g.count, count: g.count };
  }
  return out;
}
