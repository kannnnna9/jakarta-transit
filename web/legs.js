"use strict";
// Pure presentation helper (no DOM). Pecah res.path (dari router) jadi daftar
// "leg" — satu leg = satu naik-bus. Dipakai di browser (window.Legs) & Node (tes).
// Router tetap sumber kebenaran rute; ini cuma mengelompokkan untuk render.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Legs = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // path: [{kind:"board"|"take"|"ride", stop, route, xtype}]
  //  - "board": penanda asal (route null) — diabaikan; "take" pertama bawa stop sama.
  //  - "take" : naik route (leg baru). xtype = jenis transfer masuk leg ini (s/o/w).
  //  - "ride" : maju 1 halte di route sama.
  // Return: [{route, xtype, board, mid:[...halte lewat], alight}]
  function pathToLegs(path) {
    const raw = [];
    for (const s of path) {
      if (s.kind === "take") raw.push({ route: s.route, xtype: s.xtype, board: s.stop, rides: [] });
      else if (s.kind === "ride" && raw.length) raw[raw.length - 1].rides.push(s.stop);
      // "board" (asal) diabaikan — "take" pertama sudah pegang stop asal.
    }
    return raw.map(({ route, xtype, board, rides }) => ({
      route, xtype, board,
      alight: rides.length ? rides[rides.length - 1] : board,
      mid: rides.slice(0, -1), // halte antara naik & turun (eksklusif)
    }));
  }
  return { pathToLegs };
});
