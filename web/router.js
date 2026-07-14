"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Router = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // biaya 1 transfer = WEIGHT halte (mirror route.py WEIGHT). Transfer dipilih
  // hanya kalau hemat >WEIGHT halte -> hindari rute 0-transfer yang muter.
  const WEIGHT = 8;
  const STOP_M = 40;
  const TOL_RECOMMEND_M = 2000;
  const DIST_TRANSFER_M = 200;
  const ACCESS_M = 400;

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
  function routeAllowed(data, route, allowed) {
    return !allowed || allowed.has((data.rtype && data.rtype[route]) || "");
  }

  function edgeDist(data, route, from, to) {
    const byRoute = data.dist && data.dist[route];
    const byStop = byRoute && byRoute[from];
    return (byStop && byStop[to]) || 1;
  }

  function haversineM(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function stopWalkM(data, a, b) {
    if (a === b) return 0;
    if (!data.lat || !data.lon) return 1;
    const la1 = data.lat[a], lo1 = data.lon[a], la2 = data.lat[b], lo2 = data.lon[b];
    if ([la1, lo1, la2, lo2].some((x) => x == null)) return 1;
    return Math.max(1, Math.round(haversineM(la1, lo1, la2, lo2)));
  }

  function xferM(data, from, to, xtype, xdist) {
    if (xtype === "w") return xdist || stopWalkM(data, from, to);
    if (xtype === "s" || xtype === "o") return xdist || stopWalkM(data, from, to);
    return xdist || 0;
  }

  function transferTargets(data, nameStops, stop) {
    const out = [];
    for (const s2 of nameStops.get(data.stops[stop]) || []) out.push([s2, "s", stopWalkM(data, stop, s2)]);
    const xl = data.xfer && data.xfer[stop];
    if (xl) for (const link of xl) out.push([link[0], link[1], xferM(data, stop, link[0], link[1], link[2] || 0)]);
    out.sort((a, b) => (a[0] - b[0]) || String(a[1]).localeCompare(String(b[1])) || ((a[2] || 0) - (b[2] || 0)));
    return out;
  }

  function routeListAt(routesAt, stop, data, allowed) {
    return Array.from(routesAt[stop] || []).filter((r) => routeAllowed(data, r, allowed)).sort((a, b) => a - b);
  }

  function accessStops(data, originName, radius, nameStops) {
    const origins = Array.from(nameStops.get(originName) || []).sort((a, b) => a - b);
    const out = new Map();
    const hasCoords = !!(data.lat && data.lon);
    for (const origin of origins) {
      out.set(origin, 0);
      if (!hasCoords) continue; // tanpa lat/lon: jangan "teleport" (stopWalkM fallback=1)
      for (let stop = 0; stop < data.stops.length; stop++) {
        if (stop === origin) continue;
        const dist = stopWalkM(data, origin, stop);
        if (dist <= radius && (!out.has(stop) || dist < out.get(stop))) out.set(stop, dist);
      }
    }
    return out;
  }

  function pathSignature(path) {
    return path.filter((p) => p.kind === "take" && p.route != null).map((p) => p.route).join(",");
  }

  // true kalau menambah nxt ke leg berjalan membuat nama halte berulang (bus muter balik)
  function legRevisits(data, path, nxt) {
    const target = data.stops[nxt];
    for (let k = path.length - 1; k >= 0; k--) {
      const p = path[k];
      if (data.stops[p.stop] === target) return true;
      if (p.kind === "take" || p.kind === "board") break;
    }
    return false;
  }

  // Buang "leg-hantu": naik lalu turun di stasiun bernama SAMA (nol pindah stasiun,
  // cuma geser peron). Transfer masuk-stasiun (xtype/xdist) diwariskan ke take
  // berikutnya supaya jalan kaki tak hilang. Berlaku untuk semua tab (jaring pengaman).
  function sanitizePath(data, path) {
    if (!path || !path.length) return path;
    const out = [];
    let pendingXfer = null;
    let i = 0;
    while (i < path.length) {
      const step = path[i];
      if (step.kind === "take") {
        let j = i + 1;
        while (j < path.length && path[j].kind === "ride") j++;
        const alightStop = j - 1 > i ? path[j - 1].stop : step.stop;
        const ghost = data.stops[step.stop] === data.stops[alightStop];
        if (ghost) {
          if (!pendingXfer) pendingXfer = { xtype: step.xtype, xdist: step.xdist };
          i = j;
          continue;
        }
        const take = Object.assign({}, step);
        if (pendingXfer) {
          take.xtype = pendingXfer.xtype;
          take.xdist = pendingXfer.xdist;
          pendingXfer = null;
        }
        out.push(take);
        for (let k = i + 1; k < j; k++) out.push(path[k]);
        i = j;
        continue;
      }
      out.push(step);
      i++;
    }
    return out;
  }

  function pathTransfers(path) {
    return Math.max(0, path.filter((p) => p.kind === "take").length - 1);
  }

  function pathStops(path) {
    return path.filter((p) => p.kind === "ride").length;
  }

  function sanitizeRoute(data, res) {
    if (!res || !res.path) return res;
    const path = sanitizePath(data, res.path);
    return Object.assign({}, res, { path, transfers: pathTransfers(path), stops: pathStops(path) });
  }

  function findRoute(data, originName, destName, index, paretoLimit = 3, allowedRtypes) {
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
                 ridden: false,
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
          if (legRevisits(data, cur.path, nx)) continue;
          heapPush({ tr: cur.tr, st: cur.st + 1, seq: seq++, stop: nx, route: cur.route,
                     ridden: true,
                     path: cur.path.concat([{ kind: "ride", stop: nx, route: cur.route, xtype: null }]) });
        }
      }
      if (cur.route !== null && !cur.ridden) continue;
      for (const [s2, xtype, xdist] of transferTargets(data, nameStops, cur.stop)) {
        if (cur.route === null && xtype !== "s" && !dests.has(s2)) continue;
        const ntr = cur.route === null ? cur.tr : cur.tr + 1;
        const xstep = { kind: "xfer", stop: s2, route: null, xtype, xdist };
        if (dests.has(s2) && s2 !== cur.stop) {
          solutions.push({ transfers: ntr, stops: cur.st, path: cur.path.concat([xstep]) });
          continue;
        }
        for (const r2 of routeListAt(routesAt, s2, data, allowedRtypes)) {
          if (r2 === cur.route && s2 === cur.stop) continue;
          heapPush({ tr: ntr, st: cur.st, seq: seq++, stop: s2, route: r2, xtype, xdist,
                     ridden: false,
                     path: cur.path.concat([{ kind: "take", stop: s2, route: r2, xtype, xdist }]) });
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

  const BRT = new Set(["FP", "FP2"]);
  const PREMIUM = new Set(["PP", "PP2", "PP3"]);
  const MAX_GOAL_TRANSFERS = 6; // ponytail: guard transfer 0-detik; naikkan kalau rute nyata butuh >6 transfer.
  const MAX_GOAL_STATES = 2000000; // ponytail: distance goal on real data can exceed 500k states.

  function cmpLabel(a, b) {
    return (a.cost - b.cost) || (a.walkM - b.walkM) || (a.tr - b.tr) || (a.st - b.st) || (a.seq - b.seq);
  }

  // Goal fare: Rupiah dulu, lalu transfer/halte (waras), walkM terakhir.
  // walkM tetap di dominasi label supaya seed akses 400 m tak "teleport gratis".
  function cmpFareLabel(a, b) {
    return (a.cost - b.cost) || (a.tr - b.tr) || (a.st - b.st) || (a.walkM - b.walkM) || (a.seq - b.seq);
  }

  function fareInfo(data, route) {
    return (data.fare && data.fare[route]) || [0, "?"];
  }

  function edgeSecs(data, route, from, to) {
    const byRoute = data.etime && data.etime[route];
    const byStop = byRoute && byRoute[from];
    return (byStop && byStop[to]) || 0;
  }

  function routeSecs(data, path) {
    let secs = 0, prevStop = null, curRoute = null, boarded = false;
    for (const step of path) {
      if (step.kind === "take") {
        if (boarded) secs += 240;
        boarded = true;
        curRoute = step.route;
        prevStop = step.stop;
      } else if (step.kind === "ride") {
        const route = step.route == null ? curRoute : step.route;
        if (route != null && prevStop != null) secs += edgeSecs(data, route, prevStop, step.stop);
        curRoute = route;
        prevStop = step.stop;
      } else if (step.kind === "board") {
        prevStop = step.stop;
      } else if (step.kind === "xfer") {
        if (curRoute != null) secs += 240;
        if (step.xtype === "w") secs += Math.round((step.xdist || 0) / 1.4);
        prevStop = step.stop;
      } else if (step.kind === "access") {
        secs += Math.round((step.xdist || 0) / 1.4);
        prevStop = step.stop;
      }
    }
    return secs;
  }

  function fareAfterTake(data, route, xtype, brtPaid) {
    let paid = brtPaid, add = 0;
    if (xtype === "w") paid = false;
    const [price, klass] = fareInfo(data, route);
    if (BRT.has(klass)) {
      if (!paid) { add = price; paid = true; }
    } else if (PREMIUM.has(klass)) {
      add = price;
    }
    return [add, paid];
  }

  function heapPush(heap, x, cmp = cmpLabel) {
    heap.push(x);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (cmp(heap[i], heap[p]) < 0) { [heap[i], heap[p]] = [heap[p], heap[i]]; i = p; }
      else break;
    }
  }

  function heapPop(heap, cmp = cmpLabel) {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      while (true) {
        let l = 2 * i + 1, r = 2 * i + 2, m = i;
        if (l < heap.length && cmp(heap[l], heap[m]) < 0) m = l;
        if (r < heap.length && cmp(heap[r], heap[m]) < 0) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  }

  function dominated(labels, cur) {
    return labels.some((x) => x[0] <= cur.cost && x[1] <= cur.walkM && x[2] <= cur.tr && x[3] <= cur.st);
  }

  function shortestGoal(data, originName, destName, index, goal, allowedRtypes) {
    const { nameStops, routesAt } = index || buildIndex(data);
    const origins = nameStops.get(originName);
    const dests = new Set(nameStops.get(destName) || []);
    if (!origins) throw new Error("halte asal tidak ditemukan: " + originName);
    if (!dests.size) throw new Error("halte tujuan tidak ditemukan: " + destName);

    const heap = [];
    const best = new Map();
    const cmp = goal === "fare" ? cmpFareLabel : cmpLabel;
    let seq = 0, seen = 0;
    if (goal === "fare") {
      const originIds = Array.from(origins).sort((a, b) => a - b);
      const access = accessStops(data, originName, ACCESS_M, nameStops);
      if (!access.size) for (const s of originIds) access.set(s, 0);
      function accessOrigin(stop, walkM) {
        const matches = originIds.filter((s) => stopWalkM(data, s, stop) === walkM);
        return (matches.length ? matches : originIds).sort((a, b) => a - b)[0];
      }
      for (const [s, walkM] of Array.from(access.entries()).sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]))) {
        const start = accessOrigin(s, walkM);
        const path = [{ kind: "board", stop: start, route: null, xtype: null }];
        if (s !== start) path.push({ kind: "access", stop: s, route: null, xtype: "w", xdist: walkM });
        heapPush(heap, {
          cost: 0, walkM, tr: 0, st: 0, seq: seq++, stop: s, route: null, brtPaid: false, ridden: false,
          path,
        }, cmp);
      }
    } else {
      for (const s of origins) {
        heapPush(heap, {
          cost: 0, walkM: 0, tr: 0, st: 0, seq: seq++, stop: s, route: null, brtPaid: false, ridden: false,
          path: [{ kind: "board", stop: s, route: null, xtype: null }],
        }, cmp);
      }
    }

    while (heap.length && seen++ < MAX_GOAL_STATES) {
      const cur = heapPop(heap, cmp);
      const key = cur.stop + "," + cur.route + (goal === "fare" ? "," + (cur.brtPaid ? 1 : 0) : "");
      const old = best.get(key) || [];
      if (dominated(old, cur)) continue;
      old.push([cur.cost, cur.walkM, cur.tr, cur.st]);
      best.set(key, old);

      if (dests.has(cur.stop)) return { transfers: cur.tr, stops: cur.st, path: cur.path, goalCost: cur.cost };

      if (cur.route !== null) {
        const nexts = data.edges[cur.route] && data.edges[cur.route][cur.stop];
        if (nexts) for (const nx of nexts) {
          if (legRevisits(data, cur.path, nx)) continue;
          const add = goal === "dist" ? edgeDist(data, cur.route, cur.stop, nx) : (goal === "simple" ? STOP_M : 0);
          heapPush(heap, {
            cost: cur.cost + add, walkM: cur.walkM, tr: cur.tr, st: cur.st + 1, seq: seq++,
            stop: nx, route: cur.route, brtPaid: cur.brtPaid, ridden: true,
            path: cur.path.concat([{ kind: "ride", stop: nx, route: cur.route, xtype: null }]),
          }, cmp);
        }
      }

      if (cur.route !== null && !cur.ridden) continue;
      for (const [s2, xtype, xdist] of transferTargets(data, nameStops, cur.stop)) {
        if (cur.route === null && xtype !== "s" && !dests.has(s2)) continue;
        const ntr = cur.route === null ? cur.tr : cur.tr + 1;
        const walkAdd = xtype === "w" ? (xdist || 0) : 0;
        const transferCost = cur.route === null ? 0 : DIST_TRANSFER_M;
        let xcost = 0;
        if (goal === "simple") xcost = xdist || 0;
        else if (goal === "dist") xcost = walkAdd + transferCost;
        const xstep = { kind: "xfer", stop: s2, route: null, xtype, xdist };
        if (dests.has(s2) && s2 !== cur.stop) {
          heapPush(heap, {
            cost: cur.cost + xcost, walkM: cur.walkM + walkAdd, tr: ntr, st: cur.st, seq: seq++,
            stop: s2, route: null, brtPaid: cur.brtPaid, ridden: false,
            path: cur.path.concat([xstep]),
          }, cmp);
          continue;
        }
        const routeList = routeListAt(routesAt, s2, data, allowedRtypes);
        for (const r2 of routeList) {
          if (r2 === cur.route && s2 === cur.stop) continue;
          let add = 0, brtPaid = cur.brtPaid;
          if (goal === "fare") [add, brtPaid] = fareAfterTake(data, r2, xtype, cur.brtPaid);
          else if (goal === "simple") add = cur.route === null ? 0 : (xdist || 0);
          else if (goal === "dist") add = walkAdd + transferCost;
          if (ntr > MAX_GOAL_TRANSFERS) continue;
          heapPush(heap, {
            cost: cur.cost + add, walkM: cur.walkM + walkAdd, tr: ntr, st: cur.st, seq: seq++,
            stop: s2, route: r2, brtPaid, ridden: false,
            path: cur.path.concat([{ kind: "take", stop: s2, route: r2, xtype, xdist }]),
          }, cmp);
        }
      }
    }
    return null;
  }

  function recommendRoute(data, originName, destName, index, allowedRtypes) {
    const dmin = shortestGoal(data, originName, destName, index, "dist", allowedRtypes);
    if (!dmin) return null;
    // BUG1 fix: cap = jarak murni path D_min (bukan goalCost yg termasuk denda DIST_TRANSFER_M).
    const distMins = dmin.path.reduce((tot, step, i) => {
      if (step.kind === "ride") return tot + edgeDist(data, step.route, dmin.path[i - 1].stop, step.stop);
      if (step.kind === "xfer" && step.xtype === "w") return tot + (step.xdist || 0);
      return tot;
    }, 0);
    const cap = distMins + TOL_RECOMMEND_M;

    const { nameStops, routesAt } = index || buildIndex(data);
    const origins = nameStops.get(originName);
    const dests = new Set(nameStops.get(destName) || []);

    function recCmp(a, b) {
      return (a.tr - b.tr) || (a.fare - b.fare) || (a.cost - b.cost) || (a.seq - b.seq);
    }
    function recPush(h, x) {
      h.push(x); let i = h.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (recCmp(h[i], h[p]) < 0) { [h[i], h[p]] = [h[p], h[i]]; i = p; } else break; }
    }
    function recPop(h) {
      const top = h[0], last = h.pop();
      if (h.length) {
        h[0] = last; let i = 0;
        for (;;) {
          let l = 2 * i + 1, r = 2 * i + 2, m = i;
          if (l < h.length && recCmp(h[l], h[m]) < 0) m = l;
          if (r < h.length && recCmp(h[r], h[m]) < 0) m = r;
          if (m === i) break;
          [h[i], h[m]] = [h[m], h[i]]; i = m;
        }
      }
      return top;
    }

    const heap = [];
    const best = new Map();
    let seq = 0, seen = 0;
    for (const s of origins) {
      recPush(heap, { tr: 0, fare: 0, cost: 0, seq: seq++, stop: s, route: null, brtPaid: false, ridden: false,
        path: [{ kind: "board", stop: s, route: null, xtype: null }] });
    }

    while (heap.length && seen++ < MAX_GOAL_STATES) {
      const cur = recPop(heap);
      if (cur.cost > cap) continue;
      const key = cur.stop + "," + cur.route;
      const old = best.get(key) || [];
      if (old.some((x) => x[0] <= cur.fare && x[1] <= cur.cost)) continue;
      old.push([cur.fare, cur.cost]);
      best.set(key, old);

      if (dests.has(cur.stop)) {
        const stops = cur.path.filter((p) => p.kind === "ride").length;
        return { transfers: cur.tr, stops, path: cur.path, goalCost: cur.cost };
      }

      if (cur.route !== null) {
        const nexts = data.edges[cur.route] && data.edges[cur.route][cur.stop];
        if (nexts) for (const nx of nexts) {
          if (legRevisits(data, cur.path, nx)) continue;
          const nd = cur.cost + edgeDist(data, cur.route, cur.stop, nx);
          if (nd > cap) continue;
          recPush(heap, { tr: cur.tr, fare: cur.fare, cost: nd, seq: seq++,
            stop: nx, route: cur.route, brtPaid: cur.brtPaid, ridden: true,
            path: cur.path.concat([{ kind: "ride", stop: nx, route: cur.route, xtype: null }]) });
        }
      }

      if (cur.route !== null && !cur.ridden) continue;
      for (const [s2, xtype, xdist] of transferTargets(data, nameStops, cur.stop)) {
        if (cur.route === null && xtype !== "s" && !dests.has(s2)) continue;
        const ntr = cur.route === null ? cur.tr : cur.tr + 1;
        if (ntr > MAX_GOAL_TRANSFERS) continue;
        const walkAdd = xtype === "w" ? (xdist || 0) : 0;
        const nd = cur.cost + walkAdd;
        if (nd > cap) continue;
        const xstep = { kind: "xfer", stop: s2, route: null, xtype, xdist };
        if (dests.has(s2) && s2 !== cur.stop) {
          recPush(heap, { tr: ntr, fare: cur.fare, cost: nd, seq: seq++,
            stop: s2, route: null, brtPaid: cur.brtPaid, ridden: false,
            path: cur.path.concat([xstep]) });
          continue;
        }
        const routeList = routeListAt(routesAt, s2, data, allowedRtypes);
        for (const r2 of routeList) {
          if (r2 === cur.route && s2 === cur.stop) continue;
          const [add, paid] = fareAfterTake(data, r2, xtype, cur.brtPaid);
          recPush(heap, { tr: ntr, fare: cur.fare + add, cost: nd, seq: seq++,
            stop: s2, route: r2, brtPaid: paid, ridden: false,
            path: cur.path.concat([{ kind: "take", stop: s2, route: r2, xtype, xdist }]) });
        }
      }
    }
    return null;
  }

  function findAlternative(data, originName, destName, index, goals, radius = ACCESS_M, allowedRtypes = new Set(["BRT"])) {
    const { nameStops, routesAt } = index || buildIndex(data);
    const originIds = Array.from(nameStops.get(originName) || []).sort((a, b) => a - b);
    const dests = new Set(nameStops.get(destName) || []);
    const access = accessStops(data, originName, radius, nameStops);
    if (!originIds.length || !dests.size || !access.size) return null;

    function accessOrigin(stop, walkM) {
      const matches = originIds.filter((s) => stopWalkM(data, s, stop) === walkM);
      return (matches.length ? matches : originIds).sort((a, b) => a - b)[0];
    }

    const heap = [];
    const best = new Map();
    const solutions = [];
    let seq = 0, seen = 0;
    for (const [s, walkM] of Array.from(access.entries()).sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]))) {
      const start = accessOrigin(s, walkM);
      const path = [{ kind: "board", stop: start, route: null, xtype: null }];
      if (s !== start) path.push({ kind: "access", stop: s, route: null, xtype: "w", xdist: walkM });
      heapPush(heap, { cost: walkM, walkM, tr: 0, st: 0, seq: seq++, stop: s, route: null, ridden: false, path });
    }

    while (heap.length && seen++ < MAX_GOAL_STATES && solutions.length < 50) {
      const cur = heapPop(heap);
      const key = cur.stop + "," + cur.route;
      const old = best.get(key) || [];
      if (dominated(old, cur)) continue;
      old.push([cur.cost, cur.walkM, cur.tr, cur.st]);
      best.set(key, old);

      if (dests.has(cur.stop)) {
        solutions.push({ transfers: cur.tr, stops: cur.st, walkM: cur.walkM, path: cur.path });
        continue;
      }

      if (cur.route !== null) {
        const nexts = data.edges[cur.route] && data.edges[cur.route][cur.stop];
        if (nexts) for (const nx of nexts) {
          if (legRevisits(data, cur.path, nx)) continue;
          heapPush(heap, {
            cost: cur.cost + STOP_M, walkM: cur.walkM, tr: cur.tr, st: cur.st + 1, seq: seq++,
            stop: nx, route: cur.route, ridden: true,
            path: cur.path.concat([{ kind: "ride", stop: nx, route: cur.route, xtype: null }]),
          });
        }
      }

      if (cur.route !== null && !cur.ridden) continue;
      for (const [s2, xtype, xdist] of transferTargets(data, nameStops, cur.stop)) {
        if (cur.route === null && xtype !== "s" && !dests.has(s2)) continue;
        const ntr = cur.route === null ? cur.tr : cur.tr + 1;
        const nwalk = cur.walkM + (xtype === "w" ? (xdist || 0) : 0);
        const ncost = cur.cost + (cur.route === null ? 0 : (xdist || 0));
        if (dests.has(s2) && s2 !== cur.stop) {
          heapPush(heap, {
            cost: ncost, walkM: nwalk, tr: ntr, st: cur.st, seq: seq++,
            stop: s2, route: null, ridden: false,
            path: cur.path.concat([{ kind: "xfer", stop: s2, route: null, xtype, xdist }]),
          });
          continue;
        }
        for (const r2 of routeListAt(routesAt, s2, data, allowedRtypes)) {
          if (r2 === cur.route && s2 === cur.stop) continue;
          if (ntr > MAX_GOAL_TRANSFERS) continue;
          heapPush(heap, {
            cost: ncost, walkM: nwalk, tr: ntr, st: cur.st, seq: seq++,
            stop: s2, route: r2, ridden: false,
            path: cur.path.concat([{ kind: "take", stop: s2, route: r2, xtype, xdist }]),
          });
        }
      }
    }

    if (!solutions.length) return null;
    // Sanitasi tiap kandidat DULU: leg-hantu (naik==turun stasiun sama) dibuang
    // agar diversifikasi tak pernah memilih path yang "beda" cuma karena hop kosong.
    const cleaned = solutions.map((s) => sanitizeRoute(data, s));
    // Dedup kandidat berdasarkan tanda-tangan setelah disanitasi.
    const seenSig = new Set();
    const uniq = [];
    for (const s of cleaned) {
      const sig = pathSignature(s.path);
      if (seenSig.has(sig)) continue;
      seenSig.add(sig);
      uniq.push(s);
    }
    const fewestStops = Math.min(...uniq.map((s) => s.stops));
    // Exclude hanya rekomendasi utama (fare & simple). `dist` boleh dipakai:
    // strategi jalur-beda yang bersih (mis. koridor 9) sering berimpit dengan dist,
    // dan itu jauh lebih baik daripada memfabrikasi leg supaya "beda".
    const goalSigs = new Set(["fare", "simple"].map((k) => goals[k] && pathSignature(sanitizePath(data, goals[k].path))).filter(Boolean));
    const sane = uniq
      .filter((s) => s.stops <= fewestStops * 1.5 && !goalSigs.has(pathSignature(s.path)))
      .map(({ transfers, stops, path }) => ({ transfers, stops, path }));
    sane.sort((a, b) =>
      (a.transfers - b.transfers) ||
      (routeSecs(data, a.path) - routeSecs(data, b.path)) ||
      (a.stops - b.stops) ||
      pathSignature(a.path).localeCompare(pathSignature(b.path))
    );
    return sane[0] || null;
  }

  function findGoalRoutes(data, originName, destName, index, allowedRtypes) {
    const goals = {
      fare: shortestGoal(data, originName, destName, index, "fare", allowedRtypes),
      simple: recommendRoute(data, originName, destName, index, allowedRtypes),
      dist: shortestGoal(data, originName, destName, index, "dist", allowedRtypes),
      pareto: findRoute(data, originName, destName, index, 3, allowedRtypes),
    };
    goals.alternative = findAlternative(data, originName, destName, index, goals);
    // Jaring pengaman umum: buang leg-hantu (naik==turun stasiun sama) di SEMUA tab.
    for (const k of ["fare", "simple", "dist", "alternative"]) {
      if (goals[k]) goals[k] = sanitizeRoute(data, goals[k]);
    }
    return goals;
  }

  return { MinHeap, buildIndex, findRoute, findGoalRoutes, sanitizePath };
});
