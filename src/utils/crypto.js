// BarterNet identity & bundle signing.
//
// Every user has an Ed25519 keypair generated once at onboarding. The public
// key's fingerprint *is* the peer id, so identity is self-certifying: you can't
// claim to be peer X unless you hold X's private key. Outgoing bundles are
// signed; incoming bundles are verified before any message / offer / trade is
// trusted.
//
// We use @noble/ed25519 (not WebCrypto SubtleCrypto) on purpose: the app runs
// in insecure contexts — file:// exchange, Capacitor WebView, plain http — where
// `crypto.subtle` is unavailable. Noble is pure JS and works anywhere.

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512.js";
import { sha256 } from "@noble/hashes/sha256.js";

// Enable synchronous sign/verify (noble needs a sha512 implementation wired in).
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

// ── base64 (url-safe, no padding) ────────────────────────────────────────────

function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64ToBytes(b64) {
  const norm = b64.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Identity ──────────────────────────────────────────────────────────────────

// Peer id = first 160 bits of SHA-256(publicKey), base64url. 27 chars, collision
// resistant, and verifiable from the public key alone.
export function fingerprint(pubBytes) {
  return bytesToB64(sha256(pubBytes).slice(0, 20));
}

/** Generate a fresh identity. Returns base64 strings safe to store in IndexedDB. */
export function generateIdentity() {
  const priv = ed.utils.randomPrivateKey(); // 32 bytes
  const pub = ed.getPublicKey(priv);        // 32 bytes
  return {
    uid: fingerprint(pub),
    pub: bytesToB64(pub),
    priv: bytesToB64(priv),
  };
}

// ── Canonical serialization ──────────────────────────────────────────────────
// A bundle is re-serialized in transit (relay, BLE, file), so we must sign over
// a representation that survives JSON round-trips regardless of key order. We
// sort object keys recursively and exclude the signature field itself.

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const keys = Object.keys(value).filter((k) => k !== "sig").sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
}

function digestOf(bundle) {
  return sha256(new TextEncoder().encode(stableStringify(bundle)));
}

// ── Sign / verify ─────────────────────────────────────────────────────────────

/**
 * Sign a bundle in place-ish. Returns a new bundle object with `.sig` set.
 * @param bundle  the constructed bundle (must already carry peer.pub + peer.id)
 * @param privB64 the author's private key (base64url)
 */
export function signBundle(bundle, privB64) {
  if (!privB64) throw new Error("Cannot sign without a private key");
  const unsigned = { ...bundle, sig: undefined };
  const sig = ed.sign(digestOf(unsigned), b64ToBytes(privB64));
  return { ...bundle, sig: bytesToB64(sig) };
}

/**
 * Verify a bundle's signature and that its peer id matches its public key.
 * Returns true only when the bundle is authentically from the claimed peer.
 */
export function verifyBundle(bundle) {
  try {
    const pubB64 = bundle?.peer?.pub;
    const id = bundle?.peer?.id;
    const sig = bundle?.sig;
    if (!pubB64 || !id || !sig) return false;

    const pub = b64ToBytes(pubB64);
    // The id must be the fingerprint of the presented public key — otherwise an
    // attacker could attach their own valid signature under someone else's id.
    if (fingerprint(pub) !== id) return false;

    const unsigned = { ...bundle, sig: undefined };
    return ed.verify(b64ToBytes(sig), digestOf(unsigned), pub);
  } catch {
    return false;
  }
}

// ── Generic object signing (used for individually-signed ratings) ────────────
// Signs over a stable serialization of the object (excluding any `sig` field),
// so the signature survives JSON round-trips and key reordering in transit.

export function signObject(obj, privB64) {
  if (!privB64) throw new Error("Cannot sign without a private key");
  const digest = sha256(new TextEncoder().encode(stableStringify(obj)));
  return bytesToB64(ed.sign(digest, b64ToBytes(privB64)));
}

export function verifyObject(obj, sigB64, pubB64) {
  try {
    if (!sigB64 || !pubB64) return false;
    const digest = sha256(new TextEncoder().encode(stableStringify(obj)));
    return ed.verify(b64ToBytes(sigB64), digest, b64ToBytes(pubB64));
  } catch {
    return false;
  }
}

// Recover the peer-id fingerprint from a base64 public key (helper for verifiers).
export function fingerprintOf(pubB64) {
  try { return fingerprint(b64ToBytes(pubB64)); } catch { return null; }
}

// Exposed for tests
export const _internal = { stableStringify, bytesToB64, b64ToBytes };
