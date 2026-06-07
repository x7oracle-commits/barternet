import { describe, it, expect, beforeEach } from "vitest";
import {
  db, messageId, upsertPeer, getPeers, saveProfile,
  ensureIdentity, pruneStalePeers,
  isBlocked, blockPeer, unblockPeer, getBlocked, removePeer,
  addBuzz, getRecentBuzzes,
} from "./db.js";

beforeEach(async () => {
  await Promise.all([
    db.peers.clear(), db.profile.clear(), db.messages.clear(),
    db.blocked.clear(), db.buzzes.clear(),
  ]);
});

describe("messageId", () => {
  it("is deterministic for the same inputs", () => {
    expect(messageId("a", "b", 100, "hi")).toBe(messageId("a", "b", 100, "hi"));
  });
  it("differs when any input changes", () => {
    const base = messageId("a", "b", 100, "hi");
    expect(messageId("a", "b", 100, "ho")).not.toBe(base);
    expect(messageId("a", "b", 101, "hi")).not.toBe(base);
    expect(messageId("a", "c", 100, "hi")).not.toBe(base);
  });
});

describe("pruneStalePeers", () => {
  it("removes peers older than the cutoff and keeps fresh ones", async () => {
    await upsertPeer({ id: "fresh", name: "F" });
    await db.peers.put({ id: "old", name: "O", lastSeen: Date.now() - 40 * 24 * 3600 * 1000 });
    const removed = await pruneStalePeers();
    expect(removed).toBe(1);
    const ids = (await getPeers()).map((p) => p.id);
    expect(ids).toContain("fresh");
    expect(ids).not.toContain("old");
  });
});

describe("ensureIdentity", () => {
  it("backfills keys for a legacy profile and persists them", async () => {
    await saveProfile({ uid: "legacy", name: "Old", createdAt: 1 }); // no priv/pub
    const migrated = await ensureIdentity();
    expect(migrated.priv).toBeTruthy();
    expect(migrated.pub).toBeTruthy();
    expect(migrated.uid).not.toBe("legacy"); // uid now derived from the new key
    const stored = await db.profile.get("me");
    expect(stored.priv).toBe(migrated.priv);
  });

  it("leaves an already-keyed profile untouched", async () => {
    await saveProfile({ uid: "x", pub: "P", priv: "K", name: "Has Keys" });
    const r = await ensureIdentity();
    expect(r.priv).toBe("K");
    expect(r.uid).toBe("x");
  });
});

describe("blocking", () => {
  it("blocks a peer and removes their presence", async () => {
    await upsertPeer({ id: "bob", name: "Bob" });
    expect(await isBlocked("bob")).toBe(false);
    await blockPeer("bob", "Bob");
    expect(await isBlocked("bob")).toBe(true);
    expect((await getPeers()).find((p) => p.id === "bob")).toBeUndefined(); // presence wiped
    expect((await getBlocked()).map((b) => b.id)).toContain("bob");
  });

  it("unblocks a peer", async () => {
    await blockPeer("bob", "Bob");
    await unblockPeer("bob");
    expect(await isBlocked("bob")).toBe(false);
  });

  it("removePeer deletes presence without blocking", async () => {
    await upsertPeer({ id: "ann", name: "Ann" });
    await removePeer("ann");
    expect((await getPeers()).find((p) => p.id === "ann")).toBeUndefined();
    expect(await isBlocked("ann")).toBe(false); // not blocked — can return later
  });
});

describe("buzz", () => {
  it("stores a buzz and returns it as recent", async () => {
    await addBuzz("bob");
    const recent = await getRecentBuzzes();
    expect(recent.map((z) => z.toPeerId)).toContain("bob");
  });

  it("excludes stale buzzes from the recent window", async () => {
    await db.buzzes.add({ toPeerId: "old", ts: Date.now() - 5 * 60_000 });
    await addBuzz("fresh");
    const recent = await getRecentBuzzes();
    const ids = recent.map((z) => z.toPeerId);
    expect(ids).toContain("fresh");
    expect(ids).not.toContain("old");
  });
});
