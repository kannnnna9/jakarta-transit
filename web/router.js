"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Router = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // biaya 1 transfer = WEIGHT halte (mirror route.py WEIGHT). Transfer dipilih
  // hanya kalau hemat >WEIGHT halte -> hindari rute 0-transfer yang muter.
  const WEIGHT = 8;

  // Min-heap urut (cost, seq). cost = transfers*WEIGHT + stops. seq = counter
  // unik biar heapq tak pernah banding field non-comparable (tiebreak route.py).
  class MinHeap {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    _less(x, y) {
      if (x.cost !== y.cost) return x.cost < y.cost;
      return x.seq < y.seq;
    }
    push(x) {
      const a = this.a; a.push(x); let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (this._less(a[i], a[p])) { [a[i], a[p]] = [a[p], a[i]]; i = p; }
        else break;
      }
    }
    pop() {
      const a = this.a, top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last; let i = 0; const n = a.length;
        while (true) {
          let l = 2 * i + 1, r = 2 * i + 2, m = i;
          if (l < n && this._less(a[l], a[m])) m = l;
          if (r < n && this._less(a[r], a[m])) m = r;
          if (m === i) break;
          [a[i], a[m]] = [a[m], a[i]]; i = m;
        }
      }
      return top;
    }
  }

  // Precompute (sekali per data): nama->[stopIdx], routes_at[stopIdx]=Set(routeIdx)
  function buildIndex(data) {
    const nameStops = new Map();
    data.stops.forEach((nm, i) => {
      let arr = nameStops.get(nm);
      if (!arr) nameStops.set(nm, (arr = []));
      arr.push(i);
    });
    const routesAt = data.stops.map(() => new Set());
    for (const ri in data.edges) {
      const r = Number(ri), adj = data.edges[ri];
      for (const si in adj) {
        const s = Number(si);
        routesAt[s].add(r);
        for (const nx of adj[si]) routesAt[nx].add(r);
      }
    }
    return { nameStops, routesAt };
  }

  // Cari rute halte-asal -> halte-tujuan (NAMA PERSIS). Biaya (transfer, stop).
  // Return {transfers, stops, path} atau null. path: {kind:"board"|"take"|"ride", stop, route}
  function findRoute(data, originName, destName, index) {
    const { nameStops, routesAt } = index || buildIndex(data);
    const origins = nameStops.get(originName);
    const dests = new Set(nameStops.get(destName) || []);
    if (!origins) throw new Error("halte asal tidak ditemukan: " + originName);
    if (!dests.size) throw new Error("halte tujuan tidak ditemukan: " + destName);

    const edges = data.edges, stopName = data.stops;
    const heap = new MinHeap(); let seq = 0;
    for (const s of origins)
      heap.push({ cost: 0, tr: 0, st: 0, seq: seq++, stop: s, route: null,
                  path: [{ kind: "board", stop: s, route: null, xtype: null }] });

    const best = new Map(); // `${stop},${route}` -> cost (tr*WEIGHT+st)
    while (heap.size) {
      const cur = heap.pop();
      if (dests.has(cur.stop))
        return { transfers: cur.tr, stops: cur.st, path: cur.path };
      const key = cur.stop + "," + cur.route;
      if (best.has(key) && best.get(key) <= cur.cost) continue;
      best.set(key, cur.cost);

      // ride: maju 1 stop di route sama (transfer +0, stop +1)
      if (cur.route !== null) {
        const nexts = edges[cur.route] && edges[cur.route][cur.stop];
        if (nexts) for (const nx of nexts) {
          const nst = cur.st + 1;
          heap.push({ cost: cur.tr * WEIGHT + nst, tr: cur.tr, st: nst, seq: seq++,
                      stop: nx, route: cur.route,
                      path: cur.path.concat([{ kind: "ride", stop: nx, route: cur.route, xtype: null }]) });
        }
      }
      // board/transfer: halte NAMA SAMA (type "s") + link xfer bertipe (o/w/s).
      // Cost +WEIGHT per transfer apa pun jenisnya; jenis cuma label (mirror route.py).
      const targets = [];
      for (const s2 of nameStops.get(stopName[cur.stop])) targets.push([s2, "s"]);
      const xl = data.xfer && data.xfer[cur.stop];
      if (xl) for (const link of xl) targets.push([link[0], link[1]]);
      for (const [s2, xtype] of targets) {
        for (const r2 of routesAt[s2]) {
          if (r2 === cur.route) continue;
          const ntr = cur.route === null ? cur.tr : cur.tr + 1;
          heap.push({ cost: ntr * WEIGHT + cur.st, tr: ntr, st: cur.st, seq: seq++,
                      stop: s2, route: r2, xtype,
                      path: cur.path.concat([{ kind: "take", stop: s2, route: r2, xtype }]) });
        }
      }
    }
    return null;
  }

  return { MinHeap, buildIndex, findRoute };
});
