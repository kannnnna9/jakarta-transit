 "use strict";
 // Test router murni: selftest feed mini + paritas data nyata vs route.py.
 const assert = require("assert");
 const path = require("path");
 const fs = require("fs");
 const { buildIndex, findRoute, findGoalRoutes } = require("./web/router.js");
 const { routeCost, fmtFare } = require("./web/cost.js");
 const { pathToLegs } = require("./web/legs.js");

 // --- 1. Selftest feed mini (single route) ---
 const mini = {
   stops: ["A", "B", "C", "B"],
   routes: ["R1", "R2"],
   edges: { "0": { "0": [1] }, "1": { "3": [2] } },
 };
 let routes = findRoute(mini, "A", "C");
 assert.strictEqual(routes.length, 1, "mini A->C must have 1 route");
 assert.deepStrictEqual([routes[0].transfers, routes[0].stops], [1, 2], "mini A->C metrics");
 routes = findRoute(mini, "A", "B");
 assert.strictEqual(routes.length, 1, "mini A->B must have 1 route");
 assert.deepStrictEqual([routes[0].transfers, routes[0].stops], [0, 1], "mini A->B metrics");

  // --- 1b. Pareto multi-route test: simple case with only 2 options
  function buildTestIndex(data) {
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
  // R1: A(0)->X0(1)->X1(2)->C(3)  (0 transfer, 3 stops)
  // R2: A(0)->B(4)->C(3)           (1 transfer, 2 stops)
  const paretoMini = {
    stops: ["A", "X0", "X1", "C", "B"],
    routes: ["R1", "R2", "R3"],
    edges: {
      "0": { "0": [1], "1": [2], "2": [3] },
      "1": { "0": [4] },
      "2": { "4": [3] },
    },
  };
  const paretoIdx = buildTestIndex(paretoMini);
  routes = findRoute(paretoMini, "A", "C", paretoIdx, 3);
  console.log("routes:", routes.length, routes.map(r => r.transfers + "-" + r.stops));
  assert.strictEqual(routes.length, 2, "paretoMini A->C must have 2 Pareto routes");
  const metrics = new Set(routes.map(r => r.transfers + "-" + r.stops));
  assert.ok(metrics.has("0-3"), "must have 0-transfer/3-stop route");
  assert.ok(metrics.has("1-2"), "must have 1-transfer/2-stop route");

 // --- 2. Paritas data nyata: Pancoran Arah Barat -> Komplek Polri Ragunan ---
 const dataPath = path.join(__dirname, "web", "data.json");
 if (fs.existsSync(dataPath)) {
   const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
   const idx = buildIndex(data);
   const routesReal = findRoute(data, "Pancoran Arah Barat", "Komplek Polri Ragunan", idx, 3);
   assert.ok(routesReal.length >= 1, "must find at least 1 route");
   // First route should be 0 transfer (minim transfer)
   assert.strictEqual(routesReal[0].transfers, 0, "first route should be 0 transfer");
   const boarded = routesReal[0].path.find((p) => p.kind === "take");
   assert.ok(
     data.routes[boarded.route].startsWith("5N"),
     "first route harus naik koridor 5N, dapat: " + data.routes[boarded.route]
   );
   console.log("parity ok:", routesReal[0].transfers, "transfer,", routesReal[0].stops, "stop, koridor",
     data.routes[boarded.route]);
    console.log("found", routesReal.length, "Pareto-optimal route(s)");

    // weighted cost: rute muter L13E (0 transfer / 16 halte) HARUS ada tapi kalah dari
    // opsi pendek (1 transfer / ~2 halte) dari sisi Pareto. Guard regresi bug rute-muter.
    const rw = findRoute(data, "Simpang Kuningan", "CSW 1", idx, 3);
    const shortRoute = rw.find(r => r.stops <= 6);
    assert.ok(shortRoute, "Simpang Kuningan->CSW 1 harus ada rute pendek, dapat: " +
      rw.map(r => r.transfers + "tf/" + r.stops + "st").join(", "));
    console.log("weighted ok:", shortRoute.transfers, "transfer,", shortRoute.stops, "stop (shortest)");

    const goalsReal = findGoalRoutes(data, "Simpang Kuningan", "CSW 1", idx);
    assert.ok(goalsReal.simple.transfers <= goalsReal.dist.transfers + 1,
      "recommend transfers should be <= dist transfers + 1");

    // BUG 2 regression: Simpang Kuningan→CSW must choose peron transfer (Rp3.500), not walk (Rp7.000)
    const recFare = routeCost(goalsReal.simple.path, data).fare;
    assert.strictEqual(recFare, 3500,
      "recommend Simpang Kuningan->CSW must be Rp3.500 via peron, got Rp" + recFare);
    console.log("fare fix ok: Simpang Kuningan->CSW = Rp" + recFare.toLocaleString("id-ID"));

    const pkDist = findGoalRoutes(data, "Pancoran Arah Barat", "Kota Kasablanka", idx).dist;
    assert.ok(pkDist, "dist Pancoran->Kota must find a route");
    assert.ok(pkDist.transfers <= 2, "dist Pancoran->Kota must avoid 6-transfer route, got " + pkDist.transfers);

    const altGoals = findGoalRoutes(data, "Simpang Kuningan", "Ragunan", idx);
    assert.ok(altGoals.alternative, "Simpang Kuningan->Ragunan must expose deterministic Alternatif");
    assert.strictEqual(altGoals.alternative.transfers, 0, "Alternatif must be one-seat via Underpass");
    const altAccess = altGoals.alternative.path.find(p => p.kind === "access");
    assert.ok(altAccess, "Alternatif must start with access walk");
    assert.strictEqual(data.stops[altAccess.stop], "Underpass Kuningan", "access target must be Underpass Kuningan");
    assert.ok(altAccess.xdist >= 250 && altAccess.xdist <= 350, "access walk should be about 297m, got " + altAccess.xdist);
    const altTake = altGoals.alternative.path.find(p => p.kind === "take");
    assert.ok(data.routes[altTake.route].startsWith("6 "), "Alternatif must board route 6, got " + data.routes[altTake.route]);
    for (const key of ["fare", "simple", "dist"]) {
      assert.notStrictEqual(altGoals[key].transfers, 0, key + " legacy goal must stay origin-locked at 1 transfer");
      assert.notDeepStrictEqual(
        altGoals.alternative.path.map(p => p.kind + ":" + p.stop + ":" + p.route),
        altGoals[key].path.map(p => p.kind + ":" + p.stop + ":" + p.route),
        "Alternatif must not duplicate " + key
      );
    }

    // --- 2b. Model C (recommendRoute) parity + property tests ---
    function rideM(path) {
      let tot = 0;
      for (let i = 1; i < path.length; i++) {
        if (path[i].kind === "ride") {
          const byRoute = data.dist && data.dist[path[i].route];
          const byStop = byRoute && byRoute[path[i - 1].stop];
          tot += (byStop && byStop[path[i].stop]) || 1;
        }
      }
      return tot;
    }
    const recPairs = [
      ["Simpang Kuningan", "CSW 1"],
      ["Pancoran Arah Barat", "Kota Kasablanka"],
      ["Harmoni", "Komplek Polri Ragunan"],
    ];
    for (const [o, d] of recPairs) {
      const goals = findGoalRoutes(data, o, d, idx);
      const rec = goals.simple;
      const dmin = goals.dist;
      assert.ok(rec, `recommend ${o}->${d} must find a route`);
      assert.ok(dmin, `dist ${o}->${d} must find a route`);
      // Property: recommend transfers <= dist transfers (min-transfer within cap)
      assert.ok(rec.transfers <= dmin.transfers + 1,
        `recommend ${o}->${d}: transfers ${rec.transfers} should be <= dist ${dmin.transfers} + 1`);
      // Property: distance <= D_min + TOL
      const recDist = rideM(rec.path);
      const dminDist = rideM(dmin.path);
      assert.ok(recDist <= dminDist + 2000 + 1,
        `recommend ${o}->${d}: dist ${recDist}m should be <= D_min ${dminDist}m + 2000m`);
      console.log(`recommend ${o}->${d}: ${rec.transfers}tf/${rec.stops}st/${recDist}m (D_min=${dminDist}m)`);
    }
  } else {
   console.log("(skip parity — web/data.json belum ada, jalankan build-data.py)");
 }

 // --- 3. xfer walk transfer + type tag ---
 const miniX = {
   stops: ["A", "B", "C", "D"],
   routes: ["R1", "R3"],
   edges: { "0": { "0": [3] }, "1": { "1": [2] } },
   xfer: { "3": [[1, "w", 120]], "1": [[3, "w", 120]] },
 };
 let rx = findRoute(miniX, "A", "C", null, 3);
 assert.strictEqual(rx.length, 1, "miniX must have 1 route");
 assert.strictEqual(rx[0].transfers, 1, "miniX A->C 1 transfer");
 const took = rx[0].path.filter((p) => p.kind === "take");
 assert.strictEqual(took[took.length - 1].xtype, "w", "walk type in path");
 // same-name transfer still tagged "s"
 const miniS = {
   stops: ["A", "B", "C", "B"],
   routes: ["R1", "R2"],
   edges: { "0": { "0": [1] }, "1": { "3": [2] } },
 };
 let rs = findRoute(miniS, "A", "C", null, 3);
 assert.strictEqual(rs.length, 1, "miniS must have 1 route");
 assert.strictEqual(rs[0].path.filter((p) => p.kind === "take").pop().xtype, "s", "same-name type s");
 console.log("xfer parity ok");

 // --- 4. route time + fare display cost ---
 const costData = {
   etime: {
     "0": { "0": { "1": 90 }, "2": { "3": 120 } },
     "1": { "1": { "2": 60 } },
     "2": { "3": { "4": 30 } },
   },
   fare: [[3500, "FP"], [3500, "FP2"], [0, "GR"], [20000, "PP"]],
 };
 const pathBrtSameStation = [
   { kind: "board", stop: 0 },
   { kind: "take", stop: 0, route: 0 },
   { kind: "ride", stop: 1, route: 0 },
   { kind: "take", stop: 1, route: 1, xtype: "s" },
   { kind: "ride", stop: 2, route: 1 },
 ];
 assert.deepStrictEqual(routeCost(pathBrtSameStation, costData), { secs: 390, fare: 3500 });
 const pathBrtWalkBrt = [
   { kind: "board", stop: 0 },
   { kind: "take", stop: 0, route: 0 },
   { kind: "ride", stop: 1, route: 0 },
   { kind: "take", stop: 2, route: 0, xtype: "w" },
   { kind: "ride", stop: 3, route: 0 },
 ];
 assert.strictEqual(routeCost(pathBrtWalkBrt, costData).fare, 7000, "walk resets BRT fare session");
 const pathBrtWalkGrBrt = [
   { kind: "board", stop: 0 },
   { kind: "take", stop: 0, route: 0 },
   { kind: "ride", stop: 1, route: 0 },
   { kind: "take", stop: 3, route: 2, xtype: "w" },
   { kind: "ride", stop: 4, route: 2 },
   { kind: "take", stop: 1, route: 1, xtype: "s" },
   { kind: "ride", stop: 2, route: 1 },
 ];
 assert.strictEqual(routeCost(pathBrtWalkGrBrt, costData).fare, 7000, "walk before GR still resets later BRT");
 const pathGr = [
   { kind: "board", stop: 3 },
   { kind: "take", stop: 3, route: 2 },
   { kind: "ride", stop: 4, route: 2 },
 ];
 assert.strictEqual(routeCost(pathGr, costData).fare, 0, "GR is free");
 const pathPp = [
   { kind: "board", stop: 3 },
   { kind: "take", stop: 3, route: 3 },
   { kind: "ride", stop: 4, route: 3 },
 ];
 assert.strictEqual(routeCost(pathPp, costData).fare, 20000, "PP charges flat per boarding");
 assert.strictEqual(fmtFare(0), "Gratis");
 assert.strictEqual(fmtFare(3500), "Rp3.500");
 console.log("cost ok");

 // --- 5. v1.9 goal routes: cheapest/simple/shortest-distance + filters ---
 assert.strictEqual(typeof findGoalRoutes, "function", "router must export findGoalRoutes");
 const goalMini = {
   stops: ["A", "D", "C", "E", "E"],
   routes: ["PP", "BRT", "BRT2", "BRT3"],
   edges: {
     "0": { "0": [2] },             // fastest but expensive
     "1": { "0": [1], "1": [2] },   // cheapest tie winner: fewer transfers
     "2": { "0": [3] },
     "3": { "4": [2] },
   },
   etime: {
     "0": { "0": { "2": 60 } },
     "1": { "0": { "1": 150 }, "1": { "2": 150 } },
     "2": { "0": { "3": 50 } },
     "3": { "4": { "2": 50 } },
   },
   fare: [[20000, "PP"], [3500, "FP"], [3500, "FP"], [3500, "FP2"]],
   rtype: ["Royaltrans", "BRT", "BRT", "BRT"],
   dist: {
     "0": { "0": { "2": 1000 } },
     "1": { "0": { "1": 200 }, "1": { "2": 200 } },
     "2": { "0": { "3": 50 } },
     "3": { "4": { "2": 50 } },
   },
 };
 const goals = findGoalRoutes(goalMini, "A", "C", buildTestIndex(goalMini));
 assert.strictEqual(goals.fare.path.find(p => p.kind === "take").route, 1, "cheapest avoids PP and tie-breaks to fewer transfers");
 assert.strictEqual(routeCost(goals.fare.path, goalMini).fare, 3500, "cheapest fare is BRT flat fare");
  assert.strictEqual(goals.simple.path.find(p => p.kind === "take").route, 1, "recommend picks min-transfer then min-fare (BRT R1) within D_min+TOL");
 assert.strictEqual(goals.dist.path.find(p => p.kind === "take").route, 2, "distance chooses shortest meters");
 assert.ok(!("time" in goals), "v1.9 removes time goal");
 assert.ok(!("walk" in goals), "v1.9 removes walk goal");

 const originLockMini = {
   stops: ["A", "D", "B", "C", "X", "Y"],
   routes: ["R1", "R2", "R3"],
   edges: {
     "0": { "0": [1] },
     "1": { "2": [3] },
     "2": { "0": [4], "4": [5], "5": [3] },
   },
   xfer: { "1": [[2, "w", 200]], "2": [[1, "w", 200]] },
   etime: {},
   fare: [[3500, "FP"], [3500, "FP"], [3500, "FP"]],
   rtype: ["BRT", "BRT", "BRT"],
   dist: { "0": { "0": { "1": 100 } }, "1": { "2": { "3": 100 } }, "2": { "0": { "4": 500 }, "4": { "5": 500 }, "5": { "3": 500 } } },
 };
 const locked = findGoalRoutes(originLockMini, "A", "C", buildTestIndex(originLockMini));
 for (const key of ["fare", "simple", "dist"]) {
   assert.strictEqual(locked[key].path.find(p => p.kind === "take").stop, 0, key + " must board at selected origin name");
 }

 const walkOnlyMini = {
   stops: ["A", "B"],
   routes: [],
   edges: {},
   xfer: { "0": [[1, "w", 80]], "1": [[0, "w", 80]] },
   etime: {},
   fare: [],
   rtype: [],
   dist: {},
 };
 const walkOnly = findGoalRoutes(walkOnlyMini, "A", "B", buildTestIndex(walkOnlyMini)).dist;
 assert.ok(walkOnly, "walk-only route to adjacent destination is allowed");
 assert.strictEqual(pathToLegs(walkOnly.path).length, 0, "walk-only route has no bus leg");

 const humanSimpleMini = {
   stops: ["A", "B", "C", "B", "D"],
   routes: ["ToB", "Peron", "Walk"],
   edges: { "0": { "0": [1] }, "1": { "3": [2] }, "2": { "0": [4] } },
   xfer: { "4": [[2, "w", 136]], "2": [[4, "w", 136]] },
   lat: [0, 0, 0, 0, 0],
   lon: [0, 0, 0.001223, 0.000117, 0],
   etime: {},
   fare: [[3500, "FP"], [3500, "FP"], [3500, "FP"]],
   rtype: ["BRT", "BRT", "BRT"],
   dist: { "0": { "0": { "1": 100 } }, "1": { "3": { "2": 100 } }, "2": { "0": { "4": 100 } } },
 };
 const humanSimple = findGoalRoutes(humanSimpleMini, "A", "C", buildTestIndex(humanSimpleMini)).simple;
 assert.ok(humanSimple, "human simple mini route exists");
 assert.ok(
   humanSimple.path.some(p => p.kind === "take" && p.xtype === "s" && p.route === 1),
   "simple must prefer real same-platform distance over 136m walk"
 );

 const tieMini = {
   stops: ["A", "B", "C", "D"],
   routes: ["R1", "R2"],
   edges: { "0": { "0": [1], "1": [2] }, "1": { "0": [3], "3": [2] } },
   etime: {
     "0": { "0": { "1": 10 }, "1": { "2": 10 } },
     "1": { "0": { "3": 10 }, "3": { "2": 10 } },
   },
   fare: [[3500, "FP"], [3500, "FP"]],
   rtype: ["BRT", "Mikrotrans"],
   dist: { "0": { "0": { "1": 100 }, "1": { "2": 100 } }, "1": { "0": { "3": 100 }, "3": { "2": 100 } } },
 };
 assert.deepStrictEqual(
   findGoalRoutes(tieMini, "A", "C", buildTestIndex(tieMini)).dist.path.map(p => p.stop),
   [0, 0, 1, 2],
   "final tie-break is lexicographic stop_id path"
 );
 const brtOnly = findGoalRoutes(tieMini, "A", "C", buildTestIndex(tieMini), new Set(["BRT"]));
 assert.ok(brtOnly.fare.path.every(p => p.route == null || tieMini.rtype[p.route] === "BRT"), "BRT-only filter excludes non-BRT legs");
 const noRoute = findGoalRoutes(tieMini, "A", "C", buildTestIndex(tieMini), new Set(["Royaltrans"]));
 assert.strictEqual(noRoute.fare, null, "filter with no matching service returns no route");

 const altMini = {
   stops: ["A", "D", "C", "B", "X", "Y", "Z"],
   routes: ["Goal1", "Goal2", "AltBrt", "Micro"],
   edges: {
     "0": { "0": [1] },
     "1": { "1": [2] },
     "2": { "3": [2] },
     "3": { "3": [4], "4": [5], "5": [6], "6": [2] },
   },
   xfer: { "1": [[1, "s", 0]] },
   lat: [0, 0, 0, 0, 1, 1, 1],
   lon: [0, 0.01, 0.011, 0.003, 1, 1, 1],
   etime: {
     "0": { "0": { "1": 60 } },
     "1": { "1": { "2": 60 } },
     "2": { "3": { "2": 300 } },
     "3": { "3": { "4": 1 }, "4": { "5": 1 }, "5": { "6": 1 }, "6": { "2": 1 } },
   },
   fare: [[3500, "FP"], [3500, "FP"], [3500, "FP"], [0, "GR"]],
   rtype: ["BRT", "BRT", "BRT", "Mikrotrans"],
   dist: {},
 };
 const alt = findGoalRoutes(altMini, "A", "C", buildTestIndex(altMini)).alternative;
 assert.ok(alt, "alternative mini route exists");
 assert.deepStrictEqual([alt.transfers, alt.stops], [0, 1], "alternative mini chooses nearby one-seat BRT");
 assert.deepStrictEqual(
   alt.path.map(p => [p.kind, p.stop, p.route, p.xtype, p.xdist]),
   [["board", 0, null, null, undefined], ["access", 3, null, "w", 334], ["take", 3, 2, "s", 0], ["ride", 2, 2, null, undefined]],
   "alternative path includes access step to nearby stop"
 );
 assert.ok(alt.path.every(p => p.route == null || altMini.rtype[p.route] === "BRT"), "alternative is BRT-only by default");

 const appJs = fs.readFileSync(path.join(__dirname, "web", "app.js"), "utf8");
 const indexHtml = fs.readFileSync(path.join(__dirname, "web", "index.html"), "utf8");
 const swJs = fs.readFileSync(path.join(__dirname, "web", "sw.js"), "utf8");
 assert.ok(appJs.includes('APP_VERSION = "1.11.1"'), "app.js must define APP_VERSION 1.11.1");
 for (const label of ["Tarif terendah", "Paling simpel", "Jarak terpendek", "Alternatif"]) {
   assert.ok(appJs.includes(label), "app.js must render " + label);
 }
 assert.ok(!appJs.includes("Math.random"), "v1.11 removes random surprise route selection");
 assert.ok(!appJs.includes("Kejutan (beta)"), "v1.11 removes Kejutan label");
 assert.ok(!appJs.includes("Waktu tercepat"), "v1.9 removes Waktu tercepat label");
 assert.ok(!appJs.includes("Minim jalan-kaki"), "v1.9 removes Minim jalan-kaki label");
 assert.ok(indexHtml.includes('id="service-filter"'), "index.html must expose service filter");
 assert.ok(indexHtml.includes('id="app-version"'), "index.html must expose version badge");
 assert.ok(swJs.includes("jt-v14"), "service worker cache must bump to jt-v14");
 console.log("v1.11 goals ok");

 console.log("test-router ok");
