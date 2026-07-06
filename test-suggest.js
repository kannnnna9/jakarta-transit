"use strict";
// Test pure suggest helper: substring match, dedup, alphabetical + distance sort.
const assert = require("assert");
const { suggest, haversineM } = require("./web/suggest.js");

const stops = ["Pancoran Arah Barat", "Pancoran Arah Timur", "Ragunan", "Blok M", "Ragunan"];
const coords = {
  lat: [-6.242, -6.243, -6.312, -6.244, -6.312],
  lon: [106.84, 106.84, 106.82, 106.80, 106.82],
};

// substring, case-insensitive
let r = suggest(stops, null, "pancoran", 10).map((x) => x.name);
assert.deepStrictEqual(r, ["Pancoran Arah Barat", "Pancoran Arah Timur"], "substring");

// empty query -> alphabetical, deduped, capped
r = suggest(stops, null, "", 2).map((x) => x.name);
assert.strictEqual(r.length, 2, "cap");
r = suggest(stops, null, "ragunan", 10).map((x) => x.name);
assert.deepStrictEqual(r, ["Ragunan"], "dedup same name");

// distance sort when `here` given: nearest first
const here = { lat: -6.312, lon: 106.82 }; // right at Ragunan
r = suggest(stops, coords, "", 10, here).map((x) => x.name);
assert.strictEqual(r[0], "Ragunan", "nearest first");

// haversine sanity: ~0 for same point, positive otherwise
assert.ok(haversineM(-6.2, 106.8, -6.2, 106.8) < 1, "zero dist");
assert.ok(haversineM(-6.2, 106.8, -6.3, 106.8) > 10000, "10km+ dist");

console.log("test-suggest ok");
