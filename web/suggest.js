"use strict";
// Pure halte-suggestion helper (no DOM). Loaded in browser (window.Suggest)
// and in Node (require) for tests. Owns ordering + dedup + distance ranking;
// the native <datalist> still does live substring filtering as the user types.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Suggest = factory();
})(typeof self !== "undefined" ? self : this, function () {
  function haversineM(la1, lo1, la2, lo2) {
    const R = 6371000, rad = Math.PI / 180;
    const dp = (la2 - la1) * rad, dl = (lo2 - lo1) * rad;
    const a = Math.sin(dp / 2) ** 2 +
      Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // stops: [name]; coords: {lat:[],lon:[]} or null; q: query; limit: cap;
  // here: {lat,lon} optional. With `here`, matches sort by distance (nearest
  // first); otherwise alphabetical. Names are deduped (peron share a name).
  // For a deduped name, the nearest peron's distance is used.
  function suggest(stops, coords, q, limit, here) {
    const ql = (q || "").trim().toLowerCase();
    const byName = new Map(); // name -> best dist (or null)
    stops.forEach((name, i) => {
      if (ql && !name.toLowerCase().includes(ql)) return;
      let dist = null;
      if (here && coords && coords.lat[i] != null && coords.lon[i] != null)
        dist = haversineM(here.lat, here.lon, coords.lat[i], coords.lon[i]);
      if (!byName.has(name)) byName.set(name, dist);
      else if (dist != null) {
        const prev = byName.get(name);
        if (prev == null || dist < prev) byName.set(name, dist);
      }
    });
    let items = [...byName].map(([name, dist]) => ({ name, dist }));
    if (here) items.sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity));
    else items.sort((a, b) => a.name.localeCompare(b.name, "id"));
    return items.slice(0, limit);
  }

  return { suggest, haversineM };
});
