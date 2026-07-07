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

  // Pareto: filter non-dominated pairs
  function paretoFilter(pairs) {
    if (pairs.length === 0) return [];
    pairs.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    const result = [pairs[0]];
    for (let i = 1; i < pairs.length; i++) {
      const dominated = result.some(([ptr, pst]) => ptr <= pairs[i][0] && pst <= pairs[i][1] && (ptr < pairs[i][0] || pst < pairs[i][1]));
      if (!dominated) result.push(pairs[i]);
    }
    return result;
  }

  // Cari rute halte-asal -> halte-tujuan (NAMA PERSIS). Pareto optimal: min (transfer, stops).
  // Return list of {transfers, stops, path} sorted by (transfers, stops).
  function findRoute(data, originName, destName, index, paretoLimit = 3) {
    const { nameStops, routesAt } = index || buildIndex(data);
    const origins = nameStops.get(originName);
    const dests = new Set(nameStops.get(destName) || []);
    if (!origins) throw new Error("halte asal tidak ditemukan: " + originName);
    if (!dests.size) throw new Error("halte tujuan tidak ditemukan: " + destName);

    const edges = data.edges, stopName = data.stops;
    const heap = []; let seq = 0;
    
    function heapPush(x) {
      heap.push(x);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[i].tr < heap[p].tr || (heap[i].tr === heap[p].tr && heap[i].st < heap[p].st) ||
            (heap[i].tr === heap[p].tr && heap[i].st === heap[p].st && heap[i].seq < heap[p].seq)) {
          [heap[i], heap[p]] = [heap[p], heap[i]];
          i = p;
        } else break;
      }
    }
    function heapPop() {
      if (heap.length === 0) return null;
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0, n = heap.length;
        while (true) {
          let l = 2 * i + 1, r = 2 * i + 2, m = i;
          if (l < n && (heap[l].tr < heap[m].tr || (heap[l].tr === heap[m].tr && heap[l].st < heap[m].st) ||
                        (heap[l].tr === heap[m].tr && heap[l].st === heap[m].st && heap[l].seq < heap[m].seq))) m = l;
          if (r < n && (heap[r].tr < heap[m].tr || (heap[r].tr === heap[m].tr && heap[r].st < heap[m].st) ||
                        (heap[r].tr === heap[m].tr && heap[r].st === heap[m].st && heap[r].seq < heap[m].seq))) m = r;
          if (m === i) break;
          [heap[i], heap[m]] = [heap[m], heap[i]];
          i = m;
        }
      }
      return top;
    }
    
    for (const s of origins)
      heapPush({ tr: 0, st: 0, seq: seq++, stop: s, route: null,
                 path: [{ kind: "board", stop: s, route: null, xtype: null }] });

    const best = new Map();
    const solutions = [];
    const maxStates = 10000;
    
    while (heap.length && solutions.length < paretoLimit * 5) {
      const cur = heapPop();
      if (!cur) break;
      
      // Keep ALL paths to destination, filter Pareto later
      if (dests.has(cur.stop)) {
        solutions.push({ transfers: cur.tr, stops: cur.st, path: cur.path });
        if (solutions.length >= paretoLimit * 5) break;
        continue;
      }
      
      // Mark state as visited, allow multiple non-dominated labels
      const key = cur.stop + "," + cur.route;
      const existing = best.get(key);
      if (existing && existing.some(([etr, est]) => etr <= cur.tr && est <= cur.st)) {
        continue; // dominated
      }
      // Add new label
      if (existing) {
        existing.push([cur.tr, cur.st]);
      } else {
        best.set(key, [[cur.tr, cur.st]]);
      }
      
      if (cur.route !== null) {
        const nexts = edges[cur.route] && edges[cur.route][cur.stop];
        if (nexts) for (const nx of nexts) {
          heapPush({ tr: cur.tr, st: cur.st + 1, seq: seq++, stop: nx, route: cur.route,
                     path: cur.path.concat([{ kind: "ride", stop: nx, route: cur.route, xtype: null }]) });
        }
      }
      const targets = [];
      for (const s2 of nameStops.get(stopName[cur.stop])) targets.push([s2, "s"]);
      const xl = data.xfer && data.xfer[cur.stop];
      if (xl) for (const link of xl) targets.push([link[0], link[1]]);
      for (const [s2, xtype] of targets) {
        for (const r2 of routesAt[s2]) {
          if (r2 === cur.route) continue;
          heapPush({ tr: cur.route === null ? cur.tr : cur.tr + 1, st: cur.st, seq: seq++, stop: s2, route: r2, xtype,
                     path: cur.path.concat([{ kind: "take", stop: s2, route: r2, xtype }]) });
        }
      }
    }
    
    const seen = new Set();
    const pareto = [];
    solutions.sort((a, b) => (a.transfers - b.transfers) || (a.stops - b.stops));
    for (const sol of solutions) {
      const key = sol.transfers + "," + sol.stops;
      if (!seen.has(key)) {
        seen.add(key);
        pareto.push(sol);
      }
    }
    
    return pareto.slice(0, paretoLimit);
  }

  return { MinHeap, buildIndex, findRoute };
});
