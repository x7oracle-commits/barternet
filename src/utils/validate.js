// Bundle validation & sanitization.
//
// Everything arriving from a peer (BLE, online relay, or imported file) is
// untrusted input. Before any of it touches IndexedDB we clamp counts and field
// lengths, coerce types, and drop anything malformed. This bounds local storage
// growth and stops a hostile peer from writing junk or oversized payloads.
//
// React escapes rendered strings, so this is defense-in-depth rather than the
// sole XSS guard — but we still strip control characters and cap lengths.

export const LIMITS = {
  ITEMS: 200,        // items advertised by the direct peer
  WANTS: 100,
  MESH_PEERS: 100,   // forwarded (2-hop) peers
  MESH_ITEMS: 60,    // items per forwarded peer
  OFFERS: 100,
  RESPONSES: 100,
  MESSAGES: 200,
  BUZZES: 50,
  RATINGS: 200,
  COMMENT: 280,
  TITLE: 120,
  DESC: 1000,
  CATEGORY: 40,
  NAME: 80,
  AVATAR: 8,
  TEXT: 2000,        // chat message body
  ID: 128,
  IMAGE: 700_000,    // base64 data-url ceiling (~500KB binary)
  PUB: 64,           // base64 ed25519 public key
  SIG: 128,
};

class ValidationError extends Error {}

// Strip C0 control characters + DEL (keeps emoji, accents, CJK, etc.).
// Constructor form keeps literal control bytes out of the source file.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F]", "g");

function str(v, max) {
  if (v == null) return "";
  const s = String(v).replace(CONTROL_CHARS, "").trim();
  return s.length > max ? s.slice(0, max) : s;
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function clampArray(v, max) {
  if (!Array.isArray(v)) return [];
  return v.length > max ? v.slice(0, max) : v;
}

function cleanLocation(loc) {
  if (!loc || typeof loc !== "object") return null;
  const lat = num(loc.lat);
  const lng = num(loc.lng);
  const out = { label: str(loc.label, LIMITS.NAME) };
  // Keep coords only when both are present and in range.
  if (lat != null && lng != null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
    out.lat = lat;
    out.lng = lng;
    const acc = num(loc.accuracy);
    if (acc != null) out.accuracy = acc;
  }
  if (!out.label && out.lat == null) return null;
  return out;
}

function cleanItem(it, { allowImage } = {}) {
  if (!it || typeof it !== "object") return null;
  const title = str(it.title, LIMITS.TITLE);
  if (!title) return null; // an item without a title is useless / unmatchable
  const out = {
    id: str(it.id, LIMITS.ID) || undefined,
    title,
    description: str(it.description, LIMITS.DESC),
    category: str(it.category, LIMITS.CATEGORY),
  };
  if (allowImage && typeof it.image === "string" && it.image.length <= LIMITS.IMAGE
      && /^data:image\//.test(it.image)) {
    out.image = it.image;
  }
  return out;
}

function cleanItems(arr, max, opts) {
  return clampArray(arr, max).map((i) => cleanItem(i, opts)).filter(Boolean);
}

/**
 * Validate & sanitize a raw bundle. Throws ValidationError on anything that
 * isn't recognizably a BarterNet bundle. Returns a clean copy safe to persist.
 *
 * @param {object} raw          parsed bundle
 * @param {object} [opts]
 * @param {boolean} [opts.allowImages]  keep item images (file import only; BLE strips them)
 */
export function validateBundle(raw, { allowImages = false } = {}) {
  if (!raw || typeof raw !== "object") throw new ValidationError("Not an object");
  if (raw.app !== "BarterNet") throw new ValidationError("Not a BarterNet bundle");
  if (!raw.peer || typeof raw.peer !== "object") throw new ValidationError("Missing peer");

  const peerId = str(raw.peer.id, LIMITS.ID);
  if (!peerId) throw new ValidationError("Missing peer id");

  const itemOpts = { allowImage: allowImages };

  const clean = {
    v: typeof raw.v === "number" ? raw.v : 1,
    app: "BarterNet",
    ts: num(raw.ts) ?? Date.now(),
    sig: str(raw.sig, LIMITS.SIG) || undefined,
    peer: {
      id: peerId,
      name: str(raw.peer.name, LIMITS.NAME) || "Anonymous",
      avatar: str(raw.peer.avatar, LIMITS.AVATAR) || "👤",
      location: cleanLocation(raw.peer.location),
      pub: str(raw.peer.pub, LIMITS.PUB) || undefined,
    },
    items: cleanItems(raw.items, LIMITS.ITEMS, itemOpts),
    wants: clampArray(raw.wants, LIMITS.WANTS)
      .map((w) => ({ title: str(w?.title, LIMITS.TITLE) }))
      .filter((w) => w.title),
    mesh: clampArray(raw.mesh, LIMITS.MESH_PEERS)
      .map((p) => {
        const id = str(p?.id, LIMITS.ID);
        if (!id) return null;
        return {
          id,
          name: str(p?.name, LIMITS.NAME) || "Anonymous",
          location: cleanLocation(p?.location),
          avatar: str(p?.avatar, LIMITS.AVATAR) || undefined,
          pub: str(p?.pub, LIMITS.PUB) || undefined,
          items: cleanItems(p?.items, LIMITS.MESH_ITEMS, itemOpts),
        };
      })
      .filter(Boolean),
  };

  // Optional message/offer/response channels — only present on BLE/online bundles.
  if (Array.isArray(raw.offers)) {
    clean.offers = clampArray(raw.offers, LIMITS.OFFERS)
      .map((o) => (o && typeof o === "object" ? {
        id: str(o.id, LIMITS.ID),
        toPeerId: str(o.toPeerId, LIMITS.ID),
        fromId: str(o.fromId, LIMITS.ID),
        fromName: str(o.fromName, LIMITS.NAME),
        myItem: o.myItem ? cleanItem(o.myItem) : null,
        theirItem: o.theirItem ? cleanItem(o.theirItem) : null,
        message: str(o.message, LIMITS.TEXT),
        ts: num(o.ts) ?? Date.now(),
      } : null))
      .filter((o) => o && o.id && o.toPeerId);
  }

  if (Array.isArray(raw.responses)) {
    clean.responses = clampArray(raw.responses, LIMITS.RESPONSES)
      .map((r) => (r && typeof r === "object" ? {
        tradeId: str(r.tradeId, LIMITS.ID),
        toPeerId: str(r.toPeerId, LIMITS.ID),
        status: r.status === "accepted" ? "accepted" : "declined",
        reason: str(r.reason, LIMITS.TEXT),
      } : null))
      .filter((r) => r && r.tradeId && r.toPeerId);
  }

  if (Array.isArray(raw.messages)) {
    clean.messages = clampArray(raw.messages, LIMITS.MESSAGES)
      .map((m) => (m && typeof m === "object" ? {
        id: str(m.id, LIMITS.ID) || undefined,
        toPeerId: str(m.toPeerId, LIMITS.ID),
        fromId: str(m.fromId, LIMITS.ID),
        fromName: str(m.fromName, LIMITS.NAME),
        text: str(m.text, LIMITS.TEXT),
        ts: num(m.ts) ?? Date.now(),
      } : null))
      .filter((m) => m && m.toPeerId && m.text);
  }

  if (Array.isArray(raw.buzzes)) {
    clean.buzzes = clampArray(raw.buzzes, LIMITS.BUZZES)
      .map((z) => (z && typeof z === "object" ? {
        toPeerId: str(z.toPeerId, LIMITS.ID),
        fromId: str(z.fromId, LIMITS.ID),
        fromName: str(z.fromName, LIMITS.NAME),
        ts: num(z.ts) ?? Date.now(),
      } : null))
      .filter((z) => z && z.toPeerId);
  }

  if (Array.isArray(raw.ratings)) {
    clean.ratings = clampArray(raw.ratings, LIMITS.RATINGS)
      .map((r) => {
        if (!r || typeof r !== "object") return null;
        const stars = num(r.stars);
        return {
          id: str(r.id, LIMITS.ID),
          raterId: str(r.raterId, LIMITS.ID),
          raterPub: str(r.raterPub, LIMITS.PUB),
          ratedId: str(r.ratedId, LIMITS.ID),
          tradeId: str(r.tradeId, LIMITS.ID),
          stars: stars != null ? Math.max(1, Math.min(5, Math.round(stars))) : 0,
          comment: str(r.comment, LIMITS.COMMENT),
          ts: num(r.ts) ?? Date.now(),
          sig: str(r.sig, LIMITS.SIG),
        };
      })
      // Keep only structurally-complete ratings; signature is verified later.
      .filter((r) => r && r.id && r.raterId && r.ratedId && r.raterPub && r.sig && r.stars >= 1);
  }

  return clean;
}

export { ValidationError };
