import { describe, it, expect } from "vitest";
import { generateIdentity } from "./crypto.js";
import { buildRating, verifyRating, aggregateReputations } from "./ratings.js";

const me = () => generateIdentity(); // { uid, pub, priv }

describe("ratings", () => {
  it("builds and verifies a signed rating", () => {
    const a = me();
    const r = buildRating(a, generateIdentity().uid, 4, "trade1");
    expect(r.raterId).toBe(a.uid);
    expect(r.stars).toBe(4);
    expect(r.id).toBe(`${a.uid}:trade1`);
    expect(verifyRating(r)).toBe(true);
  });

  it("survives a JSON round-trip", () => {
    const a = me();
    const r = JSON.parse(JSON.stringify(buildRating(a, generateIdentity().uid, 5, "t")));
    expect(verifyRating(r)).toBe(true);
  });

  it("rejects tampered stars", () => {
    const r = buildRating(me(), generateIdentity().uid, 3, "t");
    r.stars = 5;
    expect(verifyRating(r)).toBe(false);
  });

  it("rejects a forged rater id (id not matching pub)", () => {
    const a = me();
    const b = me();
    const r = buildRating(a, generateIdentity().uid, 5, "t");
    r.raterId = b.uid; // claim to be someone else, but pub is still a's
    expect(verifyRating(r)).toBe(false);
  });

  it("refuses self-rating", () => {
    const a = me();
    expect(() => buildRating(a, a.uid, 5, "t")).toThrow();
  });

  it("clamps stars to 1..5", () => {
    const a = me();
    expect(buildRating(a, generateIdentity().uid, 9, "t").stars).toBe(5);
    expect(buildRating(a, generateIdentity().uid, 0, "t").stars).toBe(1);
  });

  it("aggregates reputations (avg + count)", () => {
    const reps = aggregateReputations([
      { ratedId: "x", stars: 4 },
      { ratedId: "x", stars: 2 },
      { ratedId: "y", stars: 5 },
    ]);
    expect(reps.x).toEqual({ avg: 3, count: 2 });
    expect(reps.y).toEqual({ avg: 5, count: 1 });
  });
});
