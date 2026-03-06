const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyStone,
  confidenceFromDelta,
  rebalanceByConfidence,
  mergeWhiteRescueStones,
} = require("../web/extraction-core.js");

test("classifyStone classifies black, white, and empty with strict thresholds", () => {
  assert.deepEqual(classifyStone(27, 26, 22), { color: "black", property: "AB" });
  assert.deepEqual(classifyStone(-23, 26, 22), { color: "white", property: "AW" });
  assert.deepEqual(classifyStone(26, 26, 22), { color: "empty", property: "" });
  assert.deepEqual(classifyStone(-22, 26, 22), { color: "empty", property: "" });
});

test("confidenceFromDelta clamps to [0,1] and scales by margin", () => {
  assert.equal(confidenceFromDelta(26, "black", 26, 22), 0);
  assert.equal(confidenceFromDelta(1000, "black", 26, 22), 1);
  assert.equal(confidenceFromDelta(-22, "white", 26, 22), 0);
  assert.equal(confidenceFromDelta(-1000, "white", 26, 22), 1);
  assert.equal(confidenceFromDelta(0, "empty", 26, 22), 0);
});

test("rebalanceByConfidence removes weakest dominant stones until imbalance drops", () => {
  const stones = [
    { color: "black", confidence: 0.1, id: "b1" },
    { color: "black", confidence: 0.2, id: "b2" },
    { color: "black", confidence: 0.9, id: "b3" },
    { color: "white", confidence: 0.8, id: "w1" },
  ];

  const out = rebalanceByConfidence(stones, 3, 0.35);
  assert.equal(out.removed, 1);
  assert.equal(out.dominant, "black");
  assert.equal(out.stones.length, 3);
  assert.equal(out.stones.find((s) => s.id === "b1"), undefined);
  assert.equal(out.finalImbalance < 0.35, true);
});

test("rebalanceByConfidence respects minTotal guard", () => {
  const stones = [
    { color: "black", confidence: 0.1 },
    { color: "black", confidence: 0.2 },
    { color: "white", confidence: 0.9 },
  ];

  const out = rebalanceByConfidence(stones, 4, 0.2);
  assert.equal(out.removed, 0);
  assert.equal(out.stones, stones);
});

test("mergeWhiteRescueStones merges rescue entries and overwrites duplicate points", () => {
  const base = [
    { imgRow: 1, imgCol: 1, color: "black", source: "base" },
    { imgRow: 2, imgCol: 2, color: "black", source: "base" },
  ];
  const rescue = [
    { imgRow: 2, imgCol: 2, color: "white", source: "white-rescue" },
    { imgRow: 3, imgCol: 3, color: "white", source: "white-rescue" },
  ];

  const merged = mergeWhiteRescueStones(base, rescue);
  assert.equal(merged.length, 3);
  assert.equal(merged.find((s) => s.imgRow === 2 && s.imgCol === 2).color, "white");
  assert.equal(merged.find((s) => s.imgRow === 3 && s.imgCol === 3).source, "white-rescue");
});

test("mergeWhiteRescueStones supports empty base stones", () => {
  const rescue = [{ imgRow: 10, imgCol: 10, color: "white" }];
  const merged = mergeWhiteRescueStones([], rescue);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0], rescue[0]);
});
