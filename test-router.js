"use strict";
// Test router murni: selftest feed mini + paritas data nyata vs route.py.
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const { buildIndex, findRoute } = require("./web/router.js");

// --- 1. Selftest feed mini (mirror route.py._selftest) ---
// A --R1--> B ; B(nama sama "B" di b2) --R2--> C
const mini = {
  stops: ["A", "B", "C", "B"],            // idx: a=0,b=1,c=2,b2=3 (b & b2 nama "B")
  routes: ["R1", "R2"],
  edges: { "0": { "0": [1] }, "1": { "3": [2] } }, // R1:0->1, R2:3->2
};
let r = findRoute(mini, "A", "C");
assert.deepStrictEqual([r.transfers, r.stops], [1, 2], "mini A->C");
r = findRoute(mini, "A", "B");
assert.deepStrictEqual([r.transfers, r.stops], [0, 1], "mini A->B");

// --- 2. Paritas data nyata: Pancoran Arah Barat -> Komplek Polri Ragunan ---
const dataPath = path.join(__dirname, "web", "data.json");
if (fs.existsSync(dataPath)) {
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const idx = buildIndex(data);
  const res = findRoute(data, "Pancoran Arah Barat", "Komplek Polri Ragunan", idx);
  assert.strictEqual(res.transfers, 0, "Pancoran->Ragunan harus 0 transfer");
  const boarded = res.path.find((p) => p.kind === "take");
  assert.ok(
    data.routes[boarded.route].startsWith("5N"),
    "harus naik koridor 5N, dapat: " + data.routes[boarded.route]
  );
  console.log("parity ok:", res.transfers, "transfer,", res.stops, "stop, koridor",
    data.routes[boarded.route]);
} else {
  console.log("(skip parity — web/data.json belum ada, jalankan build-data.py)");
}

console.log("test-router ok");
