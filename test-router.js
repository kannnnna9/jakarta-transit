 "use strict";
 // Test router murni: selftest feed mini + paritas data nyata vs route.py.
 const assert = require("assert");
 const path = require("path");
 const fs = require("fs");
 const { buildIndex, findRoute } = require("./web/router.js");
 const { routeCost, fmtFare } = require("./web/cost.js");

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
 assert.deepStrictEqual(routeCost(pathBrtSameStation, costData), { secs: 150, fare: 3500 });
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

 console.log("test-router ok");
