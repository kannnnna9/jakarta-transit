# Jakarta Transit v1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GPS nearest-halte selection, substring search, and transfer-type labels (same-station / official / walk) to Jakarta Transit, without destabilizing the proven Dijkstra router.

**Architecture:** Three independent phases, each ships working software.
1. **Data** — `build-data.py` emits per-stop `lat`/`lon`, per-route `rtype` (route_desc), and an `xfer` map of *extra* transfer links (official `transfers.txt` + shared `parent_station` + proximity walk <150 m). Backward-compatible: existing `stops`/`routes`/`edges` unchanged, router ignores new keys until Phase 3.
2. **UI** — `app.js` sorts halte suggestions by GPS distance (haversine) when geolocation granted, and matches by substring. No router change.
3. **Router transfer types** — `route.py` + `router.js` consume `xfer` as extra transfer neighbors and tag each transfer step with its type; `app.js` renders the label. Cost model stays `(transfers, stops)` — type is metadata, not a cost dimension.

**Tech Stack:** Python 3 stdlib (csv/json/math), vanilla JS (no deps), `navigator.geolocation`, Dijkstra (existing).

**Key design decisions (locked):**
- Same-name transfers stay computed on-the-fly in the router (no storage) — parity with v1.0.
- `xfer` stores ONLY extra (non-same-name) links to keep `data.json` small.
- Transfer *cost* = +1 for every transfer regardless of type (unchanged). Walk distance is shown as a **label only**. `// ponytail: distance-weighted walk penalty is a tuning knob — add only when real routes prove it's needed.`
- Proximity uses a lat/lon grid bucket, not full O(n²). `// ponytail: grid bucket over 8243 stops, not 68M pairs.`
- Type codes in `xfer`: `"s"` = same-station (shared parent_station), `"o"` = official (transfers.txt), `"w"` = walk (proximity; distance in meters carried alongside).

---

## File Structure

| File | Responsibility | Phase |
|---|---|---|
| `build-data.py` | Emit `lat`,`lon`,`rtype`,`xfer` (modify) | 1 |
| `test_build.py` | Assert new fields present & valid (modify) | 1 |
| `web/app.js` | GPS sort + substring suggestions + transfer labels (modify) | 2, 3 |
| `web/index.html` | "Pakai lokasi saya" button + hint text (modify) | 2 |
| `route.py` | Consume `xfer`, tag transfer type in path (modify) | 3 |
| `web/router.js` | Mirror `route.py`: `xfer` neighbors + type tag (modify) | 3 |
| `test-router.js` | Parity: mini feed with `xfer`, type in path (modify) | 3 |

---

## data.json schema (after Phase 1)

Existing keys unchanged. New keys:

```json
{
  "stops":  ["18 Office Park", ...],
  "routes": ["8K (Batusari - Grogol)", ...],
  "edges":  { "0": { "0": [1] } },
  "lat":    [-6.299146, ...],          // parallel to stops; null if missing
  "lon":    [106.8321,  ...],
  "rtype":  ["Angkutan Umum Integrasi", ...],  // parallel to routes; route_desc
  "xfer":   { "12": [[45,"o",0],[46,"w",120]], ... }  // stopIdx -> [[nbrIdx, type, dist_m], ...]
}
```

`dist_m` is 0 for `"s"`/`"o"`, integer meters for `"w"`. `xfer` is directed and symmetric (both directions emitted).

---

## Phase 1 — Data enrichment

### Task 1.1: Emit `lat`/`lon` arrays

**Files:**
- Modify: `build-data.py`
- Test: `test_build.py`

- [ ] **Step 1: Write the failing test** — add to `test_build.py` `main()` after the routes assertion:

```python
    # 4. lat/lon parallel to stops, plausible Jakarta bounds
    assert len(data["lat"]) == len(data["stops"]), (len(data["lat"]), len(data["stops"]))
    assert len(data["lon"]) == len(data["stops"]), (len(data["lon"]), len(data["stops"]))
    lats = [v for v in data["lat"] if v is not None]
    lons = [v for v in data["lon"] if v is not None]
    assert lats and all(-7.5 < v < -5.5 for v in lats), "lat out of Jakarta range"
    assert lons and all(106.0 < v < 107.5 for v in lons), "lon out of Jakarta range"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 test_build.py`
Expected: FAIL — `KeyError: 'lat'`.

- [ ] **Step 3: Implement** — in `build-data.py` `main()`, extend the stops loop and output dict:

```python
    stop_idx, stop_names, stop_lat, stop_lon = {}, [], [], []
    for r in rows("stops.txt"):
        stop_idx[r["stop_id"]] = len(stop_names)
        stop_names.append(r["stop_name"].strip())
        stop_lat.append(_num(r.get("stop_lat")))
        stop_lon.append(_num(r.get("stop_lon")))
```

Add helper near top (after imports):

```python
def _num(s):
    s = (s or "").strip()
    try:
        return float(s)
    except ValueError:
        return None
```

Add to the `data` dict: `"lat": stop_lat, "lon": stop_lon,`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 test_build.py`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add build-data.py test_build.py
git commit -m "feat(data): emit per-stop lat/lon in data.json"
```

### Task 1.2: Emit `rtype` (route_desc)

**Files:**
- Modify: `build-data.py`
- Test: `test_build.py`

- [ ] **Step 1: Write the failing test** — add to `test_build.py`:

```python
    # 5. rtype parallel to routes, non-empty strings
    assert len(data["rtype"]) == len(data["routes"]), (len(data["rtype"]), len(data["routes"]))
    assert any(v for v in data["rtype"]), "all rtype empty"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 test_build.py`
Expected: FAIL — `KeyError: 'rtype'`.

- [ ] **Step 3: Implement** — in the routes loop capture `route_desc`:

```python
    route_idx, route_labels, route_types = {}, [], []
    for r in rows("routes.txt"):
        short = r["route_short_name"].strip()
        long = r["route_long_name"].strip()
        route_idx[r["route_id"]] = len(route_labels)
        route_labels.append(f"{short} ({long})" if long else short)
        route_types.append((r.get("route_desc") or "").strip())
```

Add to `data` dict: `"rtype": route_types,`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 test_build.py`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add build-data.py test_build.py
git commit -m "feat(data): emit per-route type (route_desc) in data.json"
```

### Task 1.3: Emit `xfer` (official + parent + proximity)

**Files:**
- Modify: `build-data.py`
- Test: `test_build.py`

- [ ] **Step 1: Write the failing test** — add to `test_build.py`:

```python
    # 6. xfer: keys & neighbor indices in range, types valid, symmetric, self-excluded
    ns = len(data["stops"])
    xfer = data["xfer"]
    seen_pair = set()
    types = set()
    for si, links in xfer.items():
        assert 0 <= int(si) < ns, si
        for nb, ty, dist in links:
            assert 0 <= nb < ns, nb
            assert nb != int(si), ("self-transfer", si)
            assert ty in ("s", "o", "w"), ty
            assert isinstance(dist, int) and dist >= 0, dist
            types.add(ty)
            seen_pair.add((int(si), nb))
    # official transfers.txt has 7 undirected links -> present as "o" both directions
    assert "o" in types, "no official transfers emitted"
    # symmetry: every (a,b) has (b,a)
    for a, b in seen_pair:
        assert (b, a) in seen_pair, ("asymmetric", a, b)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 test_build.py`
Expected: FAIL — `KeyError: 'xfer'`.

- [ ] **Step 3: Implement** — add to `build-data.py`. Helper for haversine + a builder that unions the three sources. Same-NAME links are intentionally excluded (router computes them live).

```python
import math

WALK_M = 150  # ponytail: tunable proximity threshold (roadmap DECIDED 150 m)

def _haversine_m(lat1, lon1, lat2, lon2):
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))

def build_xfer(rows_fn, stop_idx, stop_names, stop_lat, stop_lon):
    # pairs[(a,b)] = (type, dist) with priority s > o > w (keep strongest label)
    prio = {"s": 3, "o": 2, "w": 1}
    pairs = {}
    def add(a, b, ty, dist):
        if a == b:
            return
        for x, y in ((a, b), (b, a)):
            old = pairs.get((x, y))
            if old is None or prio[ty] > prio[old[0]]:
                pairs[(x, y)] = (ty, dist)

    # 1. shared parent_station -> "s"
    parent_group = {}
    for r in rows_fn("stops.txt"):
        par = (r.get("parent_station") or "").strip()
        if par:
            parent_group.setdefault(par, []).append(stop_idx[r["stop_id"]])
    for members in parent_group.values():
        for i in range(len(members)):
            for j in range(i + 1, len(members)):
                add(members[i], members[j], "s", 0)

    # 2. official transfers.txt -> "o"
    for r in rows_fn("transfers.txt"):
        a, b = r.get("from_stop_id"), r.get("to_stop_id")
        if a in stop_idx and b in stop_idx:
            add(stop_idx[a], stop_idx[b], "o", 0)

    # 3. proximity walk <150 m -> "w"  (grid bucket, not O(n^2))
    # ponytail: cell ~0.0015 deg (~165 m); only compare same+adjacent cells.
    CELL = 0.0015
    grid = {}
    for i, (la, lo) in enumerate(zip(stop_lat, stop_lon)):
        if la is None or lo is None:
            continue
        grid.setdefault((round(la / CELL), round(lo / CELL)), []).append(i)
    for (cy, cx), bucket in grid.items():
        cand = []
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                cand += grid.get((cy + dy, cx + dx), [])
        for i in bucket:
            for j in cand:
                if j <= i:
                    continue
                d = _haversine_m(stop_lat[i], stop_lon[i], stop_lat[j], stop_lon[j])
                if d < WALK_M:
                    add(i, j, "w", int(round(d)))

    out = {}
    for (a, b), (ty, dist) in pairs.items():
        out.setdefault(str(a), []).append([b, ty, dist])
    for links in out.values():
        links.sort()
    return out
```

Call it in `main()` before building `data`, passing the `rows` closure:

```python
    xfer = build_xfer(rows, stop_idx, stop_names, stop_lat, stop_lon)
```

Add to `data` dict: `"xfer": xfer,`. Update the final `print` to include `len(xfer)` xfer-nodes.

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 test_build.py`
Expected: PASS. Also eyeball build output line for a plausible xfer-node count.

- [ ] **Step 5: Commit**

```bash
git add build-data.py test_build.py
git commit -m "feat(data): emit xfer links (official + parent + proximity walk)"
```

---

## Phase 2 — GPS nearest-halte + substring search (UI)

Router untouched. Uses `lat`/`lon` from Phase 1.

### Task 2.1: Substring suggestions

**Files:**
- Modify: `web/app.js`

Current UI uses a native `<datalist>` which already does substring-ish matching in most browsers, BUT the go-button validation requires EXACT name (`validNames.has(from)`). Substring "search" here means: keep exact validation, but make the datalist ranking/coverage better and (Task 2.2) sortable by distance. No test framework in browser; validate via a small pure helper unit-tested in Node.

- [ ] **Step 1: Write the failing test** — create `test-suggest.js` at repo root:

```javascript
"use strict";
const assert = require("assert");
const { suggest } = require("./web/suggest.js");

const stops = ["Pancoran Arah Barat", "Pancoran Arah Timur", "Ragunan", "Blok M"];
// substring, case-insensitive
let r = suggest(stops, null, "pancoran", 10).map((x) => x.name);
assert.deepStrictEqual(r, ["Pancoran Arah Barat", "Pancoran Arah Timur"], "substring");
// empty query -> alphabetical, capped
r = suggest(stops, null, "", 2).map((x) => x.name);
assert.strictEqual(r.length, 2, "cap");
console.log("test-suggest ok");
```

- [ ] **Step 2: Run to verify it fails**

Run: `node test-suggest.js`
Expected: FAIL — cannot find `./web/suggest.js`.

- [ ] **Step 3: Implement** — create `web/suggest.js` (UMD like router.js so both browser + Node load it):

```javascript
"use strict";
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
  // stops: [name]; coords: {lat:[],lon:[]} or null; q: query; limit: cap.
  // If `here` {lat,lon} given, sort matches by distance; else alphabetical.
  function suggest(stops, coords, q, limit, here) {
    const ql = (q || "").trim().toLowerCase();
    const seen = new Set();
    let items = [];
    stops.forEach((name, i) => {
      if (ql && !name.toLowerCase().includes(ql)) return;
      if (seen.has(name)) return;       // dedup peron nama sama
      seen.add(name);
      let dist = null;
      if (here && coords && coords.lat[i] != null)
        dist = haversineM(here.lat, here.lon, coords.lat[i], coords.lon[i]);
      items.push({ name, dist });
    });
    if (here) items.sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity));
    else items.sort((a, b) => a.name.localeCompare(b.name, "id"));
    return items.slice(0, limit);
  }
  return { suggest, haversineM };
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `node test-suggest.js`
Expected: PASS — `test-suggest ok`.

- [ ] **Step 5: Commit**

```bash
git add web/suggest.js test-suggest.js
git commit -m "feat(search): substring/distance suggest helper (pure, unit-tested)"
```

### Task 2.2: Wire GPS + suggest into app.js and index.html

**Files:**
- Modify: `web/app.js`, `web/index.html`

- [ ] **Step 1: Add script tag + button** — in `web/index.html`, load `suggest.js` BEFORE `app.js`, and add a "📍 Urutkan dari lokasi saya" button near the inputs (exact IDs used by app.js below): `<button id="geo" type="button">📍 Halte terdekat</button>` and a `<small id="geostat"></small>` status line. Load order: `<script src="router.js"></script><script src="suggest.js"></script><script src="app.js"></script>`.

- [ ] **Step 2: Wire in app.js** — after `data` loads, keep the existing datalist population but rebuild it via `Suggest.suggest` so it dedups; add geolocation handler that re-ranks the datalist by distance:

```javascript
  const { suggest } = window.Suggest;
  let here = null;  // {lat,lon} when user shares location

  function fillDatalist() {
    const dl = $("haltes"); dl.innerHTML = "";
    const coords = { lat: data.lat, lon: data.lon };
    const frag = document.createDocumentFragment();
    for (const it of suggest(data.stops, coords, "", 9999, here)) {
      const o = document.createElement("option"); o.value = it.name;
      frag.appendChild(o);
    }
    dl.appendChild(frag);
  }
```

Replace the inline datalist-building block in the `fetch(...).then` with a call to `fillDatalist()`. Add the geo button handler:

```javascript
  $("geo").addEventListener("click", () => {
    if (!navigator.geolocation) { $("geostat").textContent = "GPS tak didukung."; return; }
    $("geostat").textContent = "Mencari lokasi…";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        fillDatalist();
        $("geostat").textContent = "Saran halte diurut dari lokasi Anda.";
      },
      () => { $("geostat").textContent = "Gagal ambil lokasi (izin ditolak?)."; }
    );
  });
```

`// ponytail: native <datalist> filters by substring as the user types; suggest() only owns ordering + dedup + distance. No custom dropdown widget.`

- [ ] **Step 3: Manual smoke** — serve and verify:

Run: `python3 -m http.server -d web 8000`
Expected: page loads, datalist has halte names deduped; clicking 📍 prompts for location; route search still works (regression).

- [ ] **Step 4: Regression** — router untouched, confirm tests still green:

Run: `node test-router.js && node test-suggest.js`
Expected: both ok.

- [ ] **Step 5: Commit**

```bash
git add web/app.js web/index.html
git commit -m "feat(ui): GPS nearest-halte ranking for suggestions"
```

---

## Phase 3 — Transfer-type routing + labels

Router now reads `xfer` for EXTRA transfer neighbors (same-name still on-the-fly) and tags each transfer step with its type; app.js renders the label. Cost model unchanged.

### Task 3.1: route.py — xfer neighbors + type tag

**Files:**
- Modify: `route.py`

- [ ] **Step 1: Write the failing test** — extend `route.py._selftest()` to include an `xfer` walk link and assert the type surfaces. Add after existing asserts:

```python
    # xfer: A and D are within walking distance (different names) -> walk transfer
    stop_name2 = {"a": "A", "b": "B", "c": "C", "b2": "B", "d": "D"}
    name_stops2 = defaultdict(list)
    for s, n in stop_name2.items():
        name_stops2[n].append(s)
    ride2 = defaultdict(lambda: defaultdict(set))
    ride2["R1"]["a"].add("d")     # R1: A->D
    ride2["R3"]["b"].add("c")     # R3: B->C
    routes_at2 = defaultdict(set)
    routes_at2["a"].add("R1"); routes_at2["d"].add("R1")
    routes_at2["b"].add("R3"); routes_at2["c"].add("R3")
    xfer2 = {"d": [("b", "w", 120)], "b": [("d", "w", 120)]}   # walk D<->B 120 m
    data2 = (stop_name2, name_stops2, {"R1": "R1", "R3": "R3"}, ride2, routes_at2, xfer2)
    res = find("A", "C", data2)
    assert res is not None, "A->C via walk not found"
    tr, st, path = res
    assert tr == 1, ("transfers", tr)
    kinds = [(k, ty) for (k, s, r, ty) in path if k == "take"]
    assert kinds and kinds[-1][1] == "w", ("walk type missing", kinds)
    print("xfer selftest ok")
```

NOTE: this changes `data` to a 6-tuple and `path` tuples to 4 elements `(kind, stop, route, xtype)`. Update accordingly in Steps 3.

- [ ] **Step 2: Run to verify it fails**

Run: `python3 -c "import route; route._selftest()"`
Expected: FAIL (tuple unpack / missing xfer handling).

- [ ] **Step 3: Implement** — modify `route.py`:

  1. `load()` returns `xfer` too. Build it? For the real feed, `route.py` should read `xfer` the same way as data.json is built — but `route.py` reads raw GTFS, not data.json. **Keep parity by making `route.py` load `xfer` from the same three sources.** Simplest: `route.py` imports the builder. To avoid duplication, factor the xfer sources are already in `build-data.py`; `route.py` is the *reference* and may stay name-only for the real feed, with `xfer` defaulting to `{}` when not supplied. The selftest passes `xfer` explicitly. `// ponytail: route.py is the semantic reference; real-feed xfer parity is covered by data.json + router.js. Keep route.py xfer optional ({}).`

  2. `find()` signature stays `find(origin, dest, data)` but unpacks 6-tuple with `xfer` defaulting when 5-tuple passed:

```python
def find(origin, dest, data):
    stop_name, name_stops, rname, ride, routes_at = data[:5]
    xfer = data[5] if len(data) > 5 else {}
    ...
    pq = [(0, 0, next(seq), s, None, [("board", s, None, None)]) for s in origins]
    ...
        # ride
        if route is not None:
            for nxt in ride[route].get(stop, ()):
                heapq.heappush(pq, (tr, st + 1, next(seq), nxt, route,
                                    path + [("ride", nxt, route, None)]))
        # transfer targets: same-name (type "s") + xfer links (typed)
        targets = [(s2, "s") for s2 in name_stops[stop_name[stop]]]
        for nb, ty, dist in xfer.get(stop, ()):
            targets.append((nb, ty))
        for s2, xtype in targets:
            for r2 in routes_at[s2]:
                if r2 == route:
                    continue
                ntr = tr if route is None else tr + 1
                heapq.heappush(pq, (ntr, st, next(seq), s2, r2,
                                    path + [("take", s2, r2, xtype)]))
```

  3. `render()` unpacks 4-tuples; print the type on `take`:

```python
    for kind, stop, route, xtype in path:
        nm = stop_name[stop]
        if kind == "board":
            print(f"START at {nm}")
        elif kind == "take":
            tag = {"s": "", "o": " [transfer resmi]", "w": " [jalan kaki]"}.get(xtype, "")
            print(f"  -> board  [{rname[route]}]{tag}  at {nm}")
        elif kind == "ride":
            print(f"       ...  {nm}")
```

Also update the existing 3-arg selftest tuples to 4-arg (`("board", s, None, None)` etc.) — the earlier asserts only read `tr, st` so they still pass.

- [ ] **Step 4: Run to verify it passes**

Run: `python3 -c "import route; route._selftest()"`
Expected: PASS — `selftest ok` then `xfer selftest ok`.

- [ ] **Step 5: Commit**

```bash
git add route.py
git commit -m "feat(router): typed transfers (same/official/walk) in route.py reference"
```

### Task 3.2: router.js — mirror xfer + type, parity test

**Files:**
- Modify: `web/router.js`, `test-router.js`

- [ ] **Step 1: Write the failing test** — extend `test-router.js` mini feed with `xfer` and assert type in path:

```javascript
// --- 3. xfer walk transfer + type tag ---
const miniX = {
  stops: ["A", "B", "C", "D"],   // a=0,b=1,c=2,d=3
  routes: ["R1", "R3"],
  edges: { "0": { "0": [3] }, "1": { "1": [2] } },  // R1:0->3, R3:1->2
  xfer: { "3": [[1, "w", 120]], "1": [[3, "w", 120]] }, // walk D<->B
};
let rx = findRoute(miniX, "A", "C");
assert.strictEqual(rx.transfers, 1, "miniX A->C 1 transfer");
const took = rx.path.filter((p) => p.kind === "take");
assert.strictEqual(took[took.length - 1].xtype, "w", "walk type in path");
console.log("xfer parity ok");
```

- [ ] **Step 2: Run to verify it fails**

Run: `node test-router.js`
Expected: FAIL — `xtype` undefined.

- [ ] **Step 3: Implement** — in `web/router.js`:

  1. `buildIndex` stays. Add xfer lookup in `findRoute`. Path steps gain `xtype`.
  2. `board` step: `path: [{ kind: "board", stop: s, route: null, xtype: null }]`.
  3. `ride` step: add `xtype: null`.
  4. Replace the transfer loop:

```javascript
      // transfer targets: same-name (type "s") + xfer links (typed)
      const targets = [];
      for (const s2 of nameStops.get(stopName[cur.stop])) targets.push([s2, "s"]);
      const xl = data.xfer && data.xfer[cur.stop];
      if (xl) for (const [nb, ty] of xl) targets.push([nb, ty]);
      for (const [s2, xtype] of targets) {
        for (const r2 of routesAt[s2]) {
          if (r2 === cur.route) continue;
          const ntr = cur.route === null ? cur.tr : cur.tr + 1;
          heap.push({ tr: ntr, st: cur.st, seq: seq++, stop: s2, route: r2, xtype,
            path: cur.path.concat([{ kind: "take", stop: s2, route: r2, xtype }]) });
        }
      }
```

  Note `data.xfer` is keyed by string stopIdx; `cur.stop` is a number — index with `data.xfer[cur.stop]` works (JS coerces). Confirm in test.

- [ ] **Step 4: Run to verify it passes**

Run: `node test-router.js`
Expected: PASS — mini asserts, `parity ok`, `xfer parity ok`. The real-feed parity assertion (Pancoran→Ragunan, 0 transfer, koridor 5N) MUST still pass — same-name path unchanged.

- [ ] **Step 5: Commit**

```bash
git add web/router.js test-router.js
git commit -m "feat(router): typed transfers in router.js, parity with route.py"
```

### Task 3.3: app.js — render transfer-type + non-BRT labels

**Files:**
- Modify: `web/app.js`

- [ ] **Step 1: Implement** — in `render()`, on the `take` step, append a type label and mark non-BRT routes using `data.rtype`:

```javascript
      else if (step.kind === "take") {
        li.className = "hop";
        const rt = (data.rtype && data.rtype[step.route]) || "";
        const nonBrt = rt && !/BRT|Koridor/i.test(rt) ? ` · ${rt}` : "";
        const xtag = { o: " · transfer resmi", w: " · jalan kaki" }[step.xtype] || "";
        li.textContent = "🚌 " + data.routes[step.route] + nonBrt + xtag;
        ol.appendChild(li);
        const sub = document.createElement("li");
        sub.className = "stop"; sub.textContent = name;
        ol.appendChild(sub);
        continue;
      }
```

`// ponytail: label only. route_desc taxonomy is messy; treat anything not matching BRT/Koridor as non-BRT and just show the raw desc.`

- [ ] **Step 2: Manual smoke**

Run: `python3 -m http.server -d web 8000`
Expected: a route needing a transfer shows the transfer type; Mikrotrans/feeder legs show their `route_desc`.

- [ ] **Step 3: Rebuild data + full regression**

Run: `python3 build-data.py && python3 test_build.py && node test-router.js && node test-suggest.js`
Expected: all green; real-feed parity intact.

- [ ] **Step 4: Commit**

```bash
git add web/app.js
git commit -m "feat(ui): show transfer type + non-BRT labels in results"
```

---

## Release (after all phases green)

- [ ] Update `CHANGELOG.md` — new `## [1.1.0] - 2026-07-06` section (Added: GPS nearest-halte, substring/distance suggest, typed transfers same/official/walk, non-BRT labels; Data: lat/lon/rtype/xfer in data.json).
- [ ] Bump any version constant if one exists (grep `1.0.0` in `web/`); `manifest.json` has no version field — skip.
- [ ] Commit `chore(release): v1.1.0`, tag `v1.1.0`, push, `gh release create v1.1.0`.
- [ ] Verify LIVE on Pages after Actions deploy (`node`-fetch the deployed data.json has `xfer` key).

`// ponytail: SemVer minor bump — new features, backward-compatible data.json. Rilis dihitung dari yang LIVE di Pages (feedback-verify-live-pages).`

---

## Self-Review notes
- **Spec coverage:** GPS nearest (2.2) ✓, substring search (2.1) ✓, transfer 3-jenis same/official/walk (1.3 + 3.1/3.2) ✓, BRT vs non-BRT label (3.3 via rtype) ✓, lat/lon/parent/platform/type in data (1.1/1.2/1.3) ✓. parent_station used for "s" links; platform_code not surfaced (not needed for routing — deferred, note only).
- **Deferred (flagged):** distance-weighted walk cost penalty (roadmap tuning knob) → kept flat +1; live-nav = v1.2.
- **Type consistency:** path tuples are 4-element `(kind, stop, route, xtype)` in route.py and `{kind,stop,route,xtype}` objects in router.js throughout. `xfer` value shape `[nbrIdx, type, dist]` consistent across build/route/router/tests.
