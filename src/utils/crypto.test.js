import { describe, it, expect } from "vitest";
import {
  generateIdentity, fingerprint, signBundle, verifyBundle, _internal,
} from "./crypto.js";

const { b64ToBytes, stableStringify } = _internal;

function baseBundle(id, pub) {
  return {
    v: 1, app: "BarterNet", ts: 1000,
    peer: { id, name: "Ada", avatar: "🦊", location: null, pub },
    items: [{ title: "Bike", description: "red", category: "transport" }],
    wants: [{ title: "Helmet" }],
    mesh: [],
  };
}

describe("identity", () => {
  it("generates distinct keypairs", () => {
    const a = generateIdentity();
    const b = generateIdentity();
    expect(a.uid).not.toBe(b.uid);
    expect(a.priv).not.toBe(b.priv);
    expect(a.uid.length).toBeGreaterThan(10);
  });

  it("derives the uid as the public-key fingerprint", () => {
    const id = generateIdentity();
    expect(fingerprint(b64ToBytes(id.pub))).toBe(id.uid);
  });
});

describe("signBundle / verifyBundle", () => {
  it("verifies a correctly signed bundle", () => {
    const me = generateIdentity();
    const signed = signBundle(baseBundle(me.uid, me.pub), me.priv);
    expect(signed.sig).toBeTruthy();
    expect(verifyBundle(signed)).toBe(true);
  });

  it("survives a JSON round-trip (transport)", () => {
    const me = generateIdentity();
    const signed = signBundle(baseBundle(me.uid, me.pub), me.priv);
    const round = JSON.parse(JSON.stringify(signed));
    expect(verifyBundle(round)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const me = generateIdentity();
    const signed = signBundle(baseBundle(me.uid, me.pub), me.priv);
    signed.items[0].title = "Stolen Bike"; // tamper after signing
    expect(verifyBundle(signed)).toBe(false);
  });

  it("rejects a bundle signed by a different key", () => {
    const me = generateIdentity();
    const imposter = generateIdentity();
    // imposter signs but claims my id + pub
    const forged = signBundle(baseBundle(me.uid, me.pub), imposter.priv);
    expect(verifyBundle(forged)).toBe(false);
  });

  it("rejects when the id does not match the public key", () => {
    const me = generateIdentity();
    const other = generateIdentity();
    // valid signature by `me`, but peer.id claims someone else
    const signed = signBundle(baseBundle(other.uid, me.pub), me.priv);
    expect(verifyBundle(signed)).toBe(false);
  });

  it("rejects unsigned bundles", () => {
    const me = generateIdentity();
    expect(verifyBundle(baseBundle(me.uid, me.pub))).toBe(false);
  });
});

describe("stableStringify", () => {
  it("is independent of key insertion order", () => {
    const a = stableStringify({ b: 1, a: [3, { y: 2, x: 1 }] });
    const b = stableStringify({ a: [3, { x: 1, y: 2 }], b: 1 });
    expect(a).toBe(b);
  });

  it("ignores the sig field", () => {
    expect(stableStringify({ x: 1, sig: "abc" })).toBe(stableStringify({ x: 1 }));
  });
});
