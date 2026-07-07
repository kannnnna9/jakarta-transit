"use strict";
// Pure live-nav helper (no DOM/geolocation). Snap posisi GPS ke titik jalur
// rute, maju-only. Dipakai browser (window.LiveNav) & Node (tes).
(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./suggest.js"));
  else root.LiveNav = factory(root.Suggest);
})(typeof self !== "undefined" ? self : this, function (Suggest) {
  const { haversineM } = Suggest;

  // points: [{lat,lon}] urutan halte rute; pos: {lat,lon} fix GPS;
  // cur: indeks aktif (-1 = belum mulai); radiusM: ambang "sampai halte".
  // Return indeks terdekat j >= max(cur,0) dgn jarak <= radiusM, else cur.
  // Maju-only: GPS goyang tak pernah mundurkan indeks.
  // ponytail: scan seluruh sisa jalur — rute self-loop bisa salah loncat; batasi lookahead kalau kejadian.
  function snap(points, pos, cur, radiusM) {
    let best = cur, bestD = Infinity;
    for (let j = Math.max(cur, 0); j < points.length; j++) {
      const p = points[j];
      if (p.lat == null || p.lon == null) continue;
      const d = haversineM(pos.lat, pos.lon, p.lat, p.lon);
      if (d <= radiusM && d < bestD) { best = j; bestD = d; }
    }
    return best;
  }

  return { snap };
});
