import { describe, it, expect } from "vitest";
import { buildMeshBundle, buildBleBundle, parseBundle } from "./bluetooth.js";
import { generateIdentity, signBundle, verifyBundle } from "./crypto.js";

const profile = (id) => ({
  uid: id.uid, pub: id.pub, name: "Ada", avatar: "🦊",
  location: { lat: 1, lng: 2, label: "Home" },
});

describe("buildMeshBundle", () => {
  it("embeds the public key and only available items", () => {
    const id = generateIdentity();
    const b = buildMeshBundle(
      profile(id),
      [{ title: "Bike", status: "available" }, { title: "Sold", status: "traded" }],
      [{ title: "Helmet" }],
      [],
    );
    expect(b.peer.pub).toBe(id.pub);
    expect(b.items.map((i) => i.title)).toEqual(["Bike"]);
    expect(b.wants).toEqual([{ title: "Helmet" }]);
  });

  it("throws without a profile", () => {
    expect(() => buildMeshBundle(null, [], [], [])).toThrow();
  });
});

describe("buildBleBundle", () => {
  it("strips images and surfaces outgoing offers + messages", () => {
    const id = generateIdentity();
    const trades = [{
      initiatedByMe: true, status: "offered",
      withPeerId: "bob", myItem: { id: "a", title: "Bike", category: "x" },
      theirItem: { id: "b", title: "Boat" },
    }];
    const msgs = [{ id: "m1", peerId: "bob", text: "hi", ts: 5 }];
    const b = buildBleBundle(
      profile(id),
      [{ title: "Bike", status: "available", image: "data:image/png;base64,AAA" }],
      [], [], trades, msgs,
    );
    expect(b.items[0].image).toBeUndefined();
    expect(b.offers).toHaveLength(1);
    expect(b.offers[0].toPeerId).toBe("bob");
    expect(b.messages[0].text).toBe("hi");
    expect(b.messages[0].fromId).toBe(id.uid);
  });
});

describe("end-to-end: build → sign → transport → parse → verify", () => {
  it("round-trips a signed file bundle", () => {
    const id = generateIdentity();
    const built = buildMeshBundle(profile(id), [{ title: "Bike", status: "available" }], [], []);
    const signed = signBundle(built, id.priv);
    const json = JSON.stringify(signed);          // saved to file / sent over wire
    const parsed = parseBundle(json);             // received & sanitized
    expect(parsed.peer.id).toBe(id.uid);
    expect(verifyBundle(parsed)).toBe(true);
  });

  it("a tampered file fails verification after parse", () => {
    const id = generateIdentity();
    const signed = signBundle(buildMeshBundle(profile(id), [{ title: "Bike", status: "available" }], [], []), id.priv);
    const tampered = JSON.parse(JSON.stringify(signed));
    tampered.items[0].title = "Free Money";
    expect(verifyBundle(parseBundle(JSON.stringify(tampered)))).toBe(false);
  });

  it("parseBundle rejects junk", () => {
    expect(() => parseBundle("not json")).toThrow();
    expect(() => parseBundle(JSON.stringify({ app: "Nope" }))).toThrow();
  });
});
