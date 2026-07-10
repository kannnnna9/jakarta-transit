"use strict";
// Test pathToLegs: pecah res.path (dari router) jadi leg per naik-bus.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { pathToLegs } = require("./web/legs.js");

// --- 1. Feed mini: A --R1--> B --> C, transfer JALAN KAKI (w) ke R2 --> D ---
// path meniru output router: board(origin) + take(naik) + ride(maju).
const mini = [
  { kind: "board", stop: 0, route: null, xtype: null },
  { kind: "take", stop: 0, route: 0, xtype: "s" }, // naik R1 di A
  { kind: "ride", stop: 1, route: 0 },             // B (lewat)
  { kind: "ride", stop: 2, route: 0 },             // C (turun R1)
  { kind: "take", stop: 2, route: 1, xtype: "w" }, // transfer jalan kaki, naik R2
  { kind: "ride", stop: 3, route: 1 },             // D (tujuan)
];
const legs = pathToLegs(mini);
assert.strictEqual(legs.length, 2, "2 leg");
assert.deepStrictEqual([legs[0].board, legs[0].alight], [0, 2], "leg0 naik=A turun=C");
assert.deepStrictEqual(legs[0].mid, [1], "leg0 halte lewat = [B]");
assert.strictEqual(legs[1].xtype, "w", "leg1 transfer jalan kaki");
assert.deepStrictEqual([legs[1].board, legs[1].alight], [2, 3], "leg1 naik=C turun=D");
assert.strictEqual(legs[1].mid.length, 0, "leg1 tanpa halte lewat");

// --- 2. Leg tunggal (0 transfer): board + take + ride ---
const solo = [
  { kind: "board", stop: 0, route: null, xtype: null },
  { kind: "take", stop: 0, route: 0, xtype: "s" },
  { kind: "ride", stop: 1, route: 0 },
];
const l2 = pathToLegs(solo);
assert.strictEqual(l2.length, 1, "1 leg");
assert.deepStrictEqual([l2[0].board, l2[0].alight, l2[0].mid.length], [0, 1, 0], "solo naik/turun/lewat");

// --- 2b. Access walk sebelum bus: bukan leg, take pertama tetap jadi board ---
const accessSolo = [
  { kind: "board", stop: 0, route: null, xtype: null },
  { kind: "access", stop: 3, route: null, xtype: "w", xdist: 334 },
  { kind: "take", stop: 3, route: 0, xtype: "s", xdist: 0 },
  { kind: "ride", stop: 1, route: 0 },
];
const la = pathToLegs(accessSolo);
assert.strictEqual(la.length, 1, "access walk does not create a bus leg");
assert.deepStrictEqual([la[0].board, la[0].alight], [3, 1], "access route boards at nearby stop");

// --- 3. Paritas data nyata: Simpang Kuningan -> CSW 1 (rute weighted, multi-leg) ---
const dp = path.join(__dirname, "web", "data.json");
if (fs.existsSync(dp)) {
  const { buildIndex, findRoute } = require("./web/router.js");
  const data = JSON.parse(fs.readFileSync(dp, "utf8"));
  const opts = findRoute(data, "Simpang Kuningan", "CSW 1", buildIndex(data));
  const res = opts.find((r) => r.transfers > 0) || opts[0];
  const lg = pathToLegs(res.path);
  assert.ok(lg.length >= 2, "Simpang->CSW multi-leg, dapat " + lg.length);
  assert.strictEqual(data.stops[lg[0].board], "Simpang Kuningan", "leg0 naik = asal");
  assert.strictEqual(data.stops[lg[lg.length - 1].alight], "CSW 1", "leg terakhir turun = tujuan");
  // jumlah transfer = legs-1 harus cocok res.transfers
  assert.strictEqual(lg.length - 1, res.transfers, "jumlah leg-1 = res.transfers");
  console.log("legs parity ok:", lg.length, "leg,", res.transfers, "transfer");
} else {
  console.log("(skip parity — web/data.json belum ada)");
}

console.log("test-legs ok");
