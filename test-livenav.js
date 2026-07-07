"use strict";
// Tes snap() livenav — murni Node, tanpa DOM. Jalankan: node test-livenav.js
const assert = require("assert");
const { snap } = require("./web/livenav.js");

// Jalur lurus utara-selatan, tiap titik ±111 m (0.001 derajat lat).
const pts = [0, 1, 2, 3, 4].map((i) => ({ lat: -6.2 + i * 0.001, lon: 106.8 }));
const at = (i, dLat = 0) => ({ lat: pts[i].lat + dLat, lon: pts[i].lon });

// 1. start dari -1: fix persis di titik 0 → 0
assert.strictEqual(snap(pts, at(0), -1, 50), 0);

// 2. fix di luar radius semua titik (di antara 0 dan 1, ~55m dari keduanya) → diam
assert.strictEqual(snap(pts, at(0, 0.0005), 0, 50), 0);

// 3. maju: fix di titik 2 dari cur=0 → 2 (boleh loncat)
assert.strictEqual(snap(pts, at(2), 0, 50), 2);

// 4. maju-only: cur=2, fix balik ke titik 1 (GPS goyang) → tetap 2
assert.strictEqual(snap(pts, at(1), 2, 50), 2);

// 5. >1 titik dalam radius → pilih terdekat (fix 10m dari titik 3, radius besar)
assert.strictEqual(snap(pts, at(3, 0.00009), 2, 200), 3);

// 6. belum mulai (-1) + fix jauh dari semua → tetap -1
assert.strictEqual(snap(pts, { lat: -7, lon: 107 }, -1, 50), -1);

// 7. titik tanpa koordinat (lat null) dilewati, tak bikin crash
const holey = [{ lat: null, lon: null }, pts[1]];
assert.strictEqual(snap(holey, at(1), -1, 50), 1);

console.log("test-livenav: semua tes lulus");
