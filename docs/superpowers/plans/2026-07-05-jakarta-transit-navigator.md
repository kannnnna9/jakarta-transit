# Jakarta Transit Navigator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bangun PWA offline navigasi rute Transjakarta (halte asal → tujuan, minim transfer) yang bisa dibungkus jadi APK via PWABuilder.

**Architecture:** `build-data.py` mengubah GTFS extracted → `web/data.json` (integer-indexed). `web/router.js` = router murni (Dijkstra, port dari `route.py`) yang jalan di browser & Node. `web/app.js` = DOM/render. Service worker bikin offline penuh (app-shell cache-first, `data.json` stale-while-revalidate). Deploy ke GitHub Pages → PWABuilder → APK/AAB.

**Tech Stack:** Python 3 (build data), vanilla JS (router + UI, no framework/library), service worker PWA, GitHub Pages, PWABuilder.

**Spec acuan:** `docs/superpowers/specs/2026-07-05-jakarta-transit-navigator-design.md`
**Router acuan (sumber kebenaran):** `route.py` fungsi `find()` — JANGAN ubah semantik saat port.

> **Portabilitas (PENTING):** repo bisa ada di folder MANA PUN — semua script self-locate
> (`route.py`, `build-data.py`, `gtfs-fetch.sh` derive path dari lokasi file sendiri, bukan
> hardcode `~/jakarta-transit`). Ganti tool/mesin cukup `git clone` → langsung jalan. Di
> perintah bawah, `~/jakarta-transit` cuma CONTOH lokasi; pakai lokasi repo-mu (mis.
> `~/DB-Lokal/Proyek/jakarta-transit`). Lihat memori [[feedback-portable-projects]].

---

### Task 0: Init repo & struktur

**Files:**
- Modify: `.gitignore` (sudah ada, isi `.env` + `data/`)
- Create: `web/`, `web/icons/`, `docs/` (sudah ada)

- [ ] **Step 1: Init git**

Run:
```bash
cd ~/jakarta-transit
git init
mkdir -p web/icons
```
Expected: `Initialized empty Git repository`.

- [ ] **Step 2: Pastikan `web/data.json` TIDAK ke-ignore**

Run: `git check-ignore web/data.json; echo "exit=$?"`
Expected: `exit=1` (artinya TIDAK di-ignore — bagus; `web/` harus ke-commit buat Pages). `data/` (GTFS mentah) tetap di-ignore.

- [ ] **Step 3: Commit awal**

```bash
git add .gitignore gtfs-fetch.sh route.py docs/
git commit -m "chore: init repo with fetch script, reference router, spec"
```

---

### Task 1: `build-data.py` — GTFS → `web/data.json`

**Files:**
- Create: `build-data.py`
- Create: `test_build.py`

- [ ] **Step 1: Tulis test dulu (gagal)**

Create `test_build.py`:
```python
#!/usr/bin/env python3
"""Verifikasi output build-data.py cocok GTFS sumber."""
import csv, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
GTFS = os.path.join(HERE, "data/f-transjakarta~id/extracted")
OUT = os.path.join(HERE, "web/data.json")


def count_rows(name):
    with open(os.path.join(GTFS, name), newline="", encoding="utf-8") as f:
        return sum(1 for _ in csv.DictReader(f))


def main():
    subprocess.run([sys.executable, os.path.join(HERE, "build-data.py")], check=True)
    data = json.load(open(OUT, encoding="utf-8"))

    # 1. jumlah stops & routes cocok jumlah baris GTFS
    assert len(data["stops"]) == count_rows("stops.txt"), \
        (len(data["stops"]), count_rows("stops.txt"))
    assert len(data["routes"]) == count_rows("routes.txt"), \
        (len(data["routes"]), count_rows("routes.txt"))

    # 2. semua index di edges valid (dalam rentang)
    ns, nr = len(data["stops"]), len(data["routes"])
    for ri, adj in data["edges"].items():
        assert 0 <= int(ri) < nr, ri
        for si, nexts in adj.items():
            assert 0 <= int(si) < ns, si
            for nx in nexts:
                assert 0 <= nx < ns, nx

    # 3. halte acuan ada
    assert "Pancoran Arah Barat" in data["stops"], "Pancoran Arah Barat hilang"

    print("test_build ok:", len(data["stops"]), "stops,", len(data["routes"]), "routes")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Jalankan test — harus gagal**

Run: `cd ~/jakarta-transit && python3 test_build.py`
Expected: FAIL — `build-data.py` belum ada (`No such file` / subprocess error).

- [ ] **Step 3: Tulis `build-data.py`**

Create `build-data.py`:
```python
#!/usr/bin/env python3
"""Ubah GTFS extracted -> web/data.json (lihat spec Bagian 5).

Struktur output:
  stops:  [nama, ...]                       # index -> nama halte
  routes: ["short (long)", ...]             # index -> label koridor
  edges:  {"routeIdx": {"stopIdx": [nextStopIdx, ...]}}  # adjacency berarah
"""
import csv, json, os
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
GTFS = os.environ.get("GTFS_DIR", os.path.join(HERE, "data/f-transjakarta~id/extracted"))
OUT = os.environ.get("OUT", os.path.join(HERE, "web/data.json"))


def rows(name):
    with open(os.path.join(GTFS, name), newline="", encoding="utf-8") as f:
        yield from csv.DictReader(f)


def main():
    stop_idx, stop_names = {}, []
    for r in rows("stops.txt"):
        stop_idx[r["stop_id"]] = len(stop_names)
        stop_names.append(r["stop_name"].strip())

    route_idx, route_labels = {}, []
    for r in rows("routes.txt"):
        short = r["route_short_name"].strip()
        long = r["route_long_name"].strip()
        route_idx[r["route_id"]] = len(route_labels)
        route_labels.append(f"{short} ({long})" if long else short)

    trip_route = {r["trip_id"]: r["route_id"] for r in rows("trips.txt")}

    trip_seq = defaultdict(list)
    for r in rows("stop_times.txt"):
        trip_seq[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"]))

    edges = defaultdict(lambda: defaultdict(set))  # routeIdx -> stopIdx -> {next}
    for tid, seq in trip_seq.items():
        rid = trip_route.get(tid)
        if rid is None:
            continue
        ridx = route_idx[rid]
        seq.sort()
        for (_, a), (_, b) in zip(seq, seq[1:]):
            edges[ridx][stop_idx[a]].add(stop_idx[b])

    edges_out = {
        str(ri): {str(si): sorted(nx) for si, nx in adj.items()}
        for ri, adj in edges.items()
    }
    data = {"stops": stop_names, "routes": route_labels, "edges": edges_out}

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    edge_nodes = sum(len(a) for a in edges_out.values())
    print(f"wrote {OUT}: {len(stop_names)} stops, {len(route_labels)} routes, "
          f"{edge_nodes} edge-nodes")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Jalankan test — harus lulus**

Run: `cd ~/jakarta-transit && python3 test_build.py`
Expected: PASS — `test_build ok: 8244 stops, 256 routes` (angka bisa beda kalau feed di-update; yang penting cocok GTFS).

- [ ] **Step 5: Commit**

```bash
git add build-data.py test_build.py web/data.json
git commit -m "feat: build-data.py generates web/data.json from GTFS"
```

---

### Task 2: `web/router.js` — router murni (port `route.py`)

**Files:**
- Create: `web/router.js`
- Create: `test-router.js` (Node)

- [ ] **Step 1: Tulis test dulu (gagal)**

Create `test-router.js`:
```javascript
"use strict";
// Test router murni: selftest feed mini + paritas data nyata vs route.py.
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const { buildIndex, findRoute } = require("./web/router.js");

// --- 1. Selftest feed mini (mirror route.py._selftest) ---
// A --R1--> B ; B(nama sama "B" di b2) --R2--> C
const mini = {
  stops: ["A", "B", "C", "B"],            // idx: a=0,b=1,c=2,b2=3 (b & b2 nama "B")
  routes: ["R1", "R2"],
  edges: { "0": { "0": [1] }, "1": { "3": [2] } }, // R1:0->1, R2:3->2
};
let r = findRoute(mini, "A", "C");
assert.deepStrictEqual([r.transfers, r.stops], [1, 2], "mini A->C");
r = findRoute(mini, "A", "B");
assert.deepStrictEqual([r.transfers, r.stops], [0, 1], "mini A->B");

// --- 2. Paritas data nyata: Pancoran Arah Barat -> Komplek Polri Ragunan ---
const dataPath = path.join(__dirname, "web", "data.json");
if (fs.existsSync(dataPath)) {
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const idx = buildIndex(data);
  const res = findRoute(data, "Pancoran Arah Barat", "Komplek Polri Ragunan", idx);
  assert.strictEqual(res.transfers, 0, "Pancoran->Ragunan harus 0 transfer");
  const boarded = res.path.find((p) => p.kind === "take");
  assert.ok(
    data.routes[boarded.route].startsWith("5N"),
    "harus naik koridor 5N, dapat: " + data.routes[boarded.route]
  );
  console.log("parity ok:", res.transfers, "transfer,", res.stops, "stop, koridor",
    data.routes[boarded.route]);
} else {
  console.log("(skip parity — web/data.json belum ada, jalankan build-data.py)");
}

console.log("test-router ok");
```

- [ ] **Step 2: Jalankan test — harus gagal**

Run: `cd ~/jakarta-transit && node test-router.js`
Expected: FAIL — `Cannot find module './web/router.js'`.

- [ ] **Step 3: Tulis `web/router.js`**

Create `web/router.js` (UMD: jalan di Node `require` DAN browser `window.Router`):
```javascript
"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Router = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // Min-heap urut (transfers, stops, seq). seq = counter unik biar heapq
  // tak pernah banding field non-comparable (mirror tiebreak route.py).
  class MinHeap {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    _less(x, y) {
      if (x.tr !== y.tr) return x.tr < y.tr;
      if (x.st !== y.st) return x.st < y.st;
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
      heap.push({ tr: 0, st: 0, seq: seq++, stop: s, route: null,
                  path: [{ kind: "board", stop: s, route: null }] });

    const best = new Map(); // `${stop},${route}` -> tr*1e7+st (skalar lexicographic)
    while (heap.size) {
      const cur = heap.pop();
      if (dests.has(cur.stop))
        return { transfers: cur.tr, stops: cur.st, path: cur.path };
      const key = cur.stop + "," + cur.route;
      const cost = cur.tr * 1e7 + cur.st;
      if (best.has(key) && best.get(key) <= cost) continue;
      best.set(key, cost);

      // ride: maju 1 stop di route sama (transfer +0, stop +1)
      if (cur.route !== null) {
        const nexts = edges[cur.route] && edges[cur.route][cur.stop];
        if (nexts) for (const nx of nexts)
          heap.push({ tr: cur.tr, st: cur.st + 1, seq: seq++, stop: nx,
                      route: cur.route,
                      path: cur.path.concat([{ kind: "ride", stop: nx, route: cur.route }]) });
      }
      // board/transfer: route lain di halte NAMA SAMA PERSIS (transfer +1, kecuali board pertama)
      for (const s2 of nameStops.get(stopName[cur.stop])) {
        for (const r2 of routesAt[s2]) {
          if (r2 === cur.route) continue;
          const ntr = cur.route === null ? cur.tr : cur.tr + 1;
          heap.push({ tr: ntr, st: cur.st, seq: seq++, stop: s2, route: r2,
                      path: cur.path.concat([{ kind: "take", stop: s2, route: r2 }]) });
        }
      }
    }
    return null;
  }

  return { MinHeap, buildIndex, findRoute };
});
```

- [ ] **Step 4: Jalankan test — harus lulus**

Run: `cd ~/jakarta-transit && node test-router.js`
Expected: PASS — `parity ok: 0 transfer, 18 stop, koridor 5N (Kampung Melayu - Ragunan)` lalu `test-router ok`.

- [ ] **Step 5: Paritas manual vs `route.py` (gate kebenaran port)**

Run: `cd ~/jakarta-transit && python3 route.py "Pancoran Arah Barat" "Komplek Polri Ragunan" | head -3`
Expected: `Route found: 0 transfer(s), 18 stop(s)` + board `5N`. Harus cocok output JS.

- [ ] **Step 6: Commit**

```bash
git add web/router.js test-router.js
git commit -m "feat: web/router.js pure Dijkstra router, parity with route.py"
```

---

### Task 3: UI — `web/index.html` + `web/app.js`

**Files:**
- Create: `web/index.html`
- Create: `web/app.js`

- [ ] **Step 1: Tulis `web/index.html`**

Create `web/index.html`:
```html
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#0b6bcb" />
  <title>Jakarta Transit</title>
  <link rel="manifest" href="manifest.json" />
  <style>
    :root { --bg:#f6f7f9; --card:#fff; --accent:#0b6bcb; --line:#e3e6ea; --muted:#667; }
    * { box-sizing:border-box; }
    body { margin:0; font:16px/1.5 system-ui,sans-serif; background:var(--bg); color:#111;
           padding:16px; max-width:640px; margin-inline:auto; }
    h1 { font-size:1.25rem; margin:.2rem 0 1rem; }
    label { display:block; font-size:.85rem; color:var(--muted); margin:.6rem 0 .2rem; }
    input, button { width:100%; padding:.7rem .8rem; font-size:1rem; border-radius:10px;
                    border:1px solid var(--line); background:var(--card); }
    button { margin-top:1rem; background:var(--accent); color:#fff; border:0; font-weight:600; }
    button:active { opacity:.85; }
    .err { color:#b00020; font-size:.9rem; margin-top:.6rem; min-height:1.2rem; }
    .summary { font-weight:700; margin:1.2rem 0 .4rem; }
    ol { list-style:none; padding:0; margin:0; }
    li { padding:.35rem 0; border-bottom:1px solid var(--line); }
    li.hop { color:var(--accent); font-weight:600; }
    li.end { font-weight:700; }
    li.stop { color:var(--muted); padding-left:1.2rem; font-size:.92rem; }
  </style>
</head>
<body>
  <h1>Jakarta Transit</h1>
  <label for="from">Naik dari halte</label>
  <input id="from" list="haltes" autocomplete="off" placeholder="cari halte…" />
  <label for="to">Turun di halte</label>
  <input id="to" list="haltes" autocomplete="off" placeholder="cari halte…" />
  <datalist id="haltes"></datalist>
  <button id="go">Cari rute</button>
  <div class="err" id="err"></div>
  <div class="summary" id="summary"></div>
  <ol id="result"></ol>

  <script src="router.js"></script>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Tulis `web/app.js` (DOM only, pakai `Router.findRoute`)**

Create `web/app.js`:
```javascript
"use strict";
// DOM/render. Router murni ada di Router (router.js). File ini TIDAK berisi logika rute.
(function () {
  const { buildIndex, findRoute } = window.Router;
  const $ = (id) => document.getElementById(id);
  let data = null, index = null, validNames = null;

  fetch("data.json")
    .then((r) => r.json())
    .then((d) => {
      data = d;
      index = buildIndex(d);
      validNames = new Set(d.stops);
      // datalist unik (banyak halte punya nama sama utk peron; tampilkan sekali)
      const dl = $("haltes");
      const frag = document.createDocumentFragment();
      for (const nm of [...validNames].sort((a, b) => a.localeCompare(b, "id"))) {
        const o = document.createElement("option");
        o.value = nm;
        frag.appendChild(o);
      }
      dl.appendChild(frag);
    })
    .catch(() => { $("err").textContent = "Gagal memuat data halte."; });

  function render(res) {
    const ol = $("result"); ol.innerHTML = "";
    if (!res) { $("summary").textContent = "Rute tidak ditemukan."; return; }
    $("summary").textContent =
      `${res.transfers} transfer · ${res.stops} halte`;
    for (const step of res.path) {
      const li = document.createElement("li");
      const name = data.stops[step.stop];
      if (step.kind === "board") { li.textContent = "🚩 " + name; }
      else if (step.kind === "take") {
        li.className = "hop";
        li.textContent = "🚌 " + data.routes[step.route];
        ol.appendChild(li);
        const sub = document.createElement("li");
        sub.className = "stop"; sub.textContent = name;
        ol.appendChild(sub);
        continue;
      } else { li.className = "stop"; li.textContent = name; }
      ol.appendChild(li);
    }
    const last = res.path[res.path.length - 1];
    const li = document.createElement("li");
    li.className = "end"; li.textContent = "🏁 " + data.stops[last.stop];
    ol.appendChild(li);
  }

  $("go").addEventListener("click", () => {
    $("err").textContent = ""; $("summary").textContent = ""; $("result").innerHTML = "";
    const from = $("from").value.trim(), to = $("to").value.trim();
    if (!validNames) { $("err").textContent = "Data belum siap, tunggu sebentar."; return; }
    if (!validNames.has(from)) { $("err").textContent = "Halte asal tidak ditemukan — pilih dari daftar."; return; }
    if (!validNames.has(to)) { $("err").textContent = "Halte tujuan tidak ditemukan — pilih dari daftar."; return; }
    if (from === to) { $("err").textContent = "Asal dan tujuan sama."; return; }
    try { render(findRoute(data, from, to, index)); }
    catch (e) { $("err").textContent = e.message; }
  });

  // daftar service worker (offline)
  if ("serviceWorker" in navigator)
    navigator.serviceWorker.register("sw.js").catch(() => {});
})();
```

- [ ] **Step 3: Tes manual di browser lokal**

Run: `cd ~/jakarta-transit/web && python3 -m http.server 8080`
Buka `http://localhost:8080` di browser HP. Ketik "Pancoran Arah Barat" → "Komplek Polri Ragunan" → **Cari rute**.
Expected: ringkasan `0 transfer · 18 halte`, langkah naik `5N (Kampung Melayu - Ragunan)`, diakhiri `🏁 Komplek Polri Ragunan`. Coba juga input ngasal → muncul error "pilih dari daftar". Ctrl+C stop server.

- [ ] **Step 4: Commit**

```bash
git add web/index.html web/app.js
git commit -m "feat: text-list UI with exact-halte autocomplete + validation"
```

---

### Task 4: PWA offline — `manifest.json`, `sw.js`, ikon

**Files:**
- Create: `web/manifest.json`
- Create: `web/sw.js`
- Create: `web/icons/icon-512.png`, `web/icons/icon-192.png`

- [ ] **Step 1: Tulis `web/manifest.json`**

Create `web/manifest.json`:
```json
{
  "name": "Jakarta Transit",
  "short_name": "Transit",
  "description": "Navigasi rute Transjakarta, ringan & offline.",
  "start_url": "./index.html",
  "scope": "./",
  "display": "standalone",
  "background_color": "#f6f7f9",
  "theme_color": "#0b6bcb",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 2: Tulis `web/sw.js`**

Create `web/sw.js`:
```javascript
"use strict";
// App-shell = cache-first (offline). data.json = stale-while-revalidate
// (update data nyampe otomatis saat online, tanpa rebuild APK). Lihat spec Bagian 14.
const CACHE = "jt-v1"; // bump HANYA kalau app-shell (html/js/css) berubah
const SHELL = ["./", "./index.html", "./router.js", "./app.js", "./manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.endsWith("data.json")) {
    // stale-while-revalidate
    e.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(e.request).then((cached) => {
          const net = fetch(e.request).then((res) => {
            if (res && res.ok) cache.put(e.request, res.clone());
            return res;
          }).catch(() => cached);
          return cached || net;
        })
      )
    );
    return;
  }
  // app-shell: cache-first
  e.respondWith(caches.match(e.request).then((c) => c || fetch(e.request)));
});
```

- [ ] **Step 3: Bikin ikon (placeholder, ganti nanti)**

`// ponytail: ikon polos 1 warna, cukup buat install/PWABuilder; ganti desain saat mau rilis Play`
Run (pakai ImageMagick kalau ada):
```bash
cd ~/jakarta-transit/web/icons
if command -v convert >/dev/null; then
  convert -size 512x512 xc:'#0b6bcb' -gravity center -pointsize 220 -fill white \
    -annotate 0 'TJ' icon-512.png
  convert icon-512.png -resize 192x192 icon-192.png
else
  echo "ImageMagick tidak ada — buat manual: PNG 512x512 & 192x192, taruh di web/icons/"
fi
ls -la
```
Expected: `icon-512.png` & `icon-192.png` ada. (Kalau tak ada ImageMagick: bikin manual / pakai generator ikon PWABuilder nanti.)

- [ ] **Step 4: Verifikasi offline**

Run: `cd ~/jakarta-transit/web && python3 -m http.server 8080`
Buka di browser, load sekali, lalu matikan server (Ctrl+C) & reload halaman.
Expected: app tetap jalan (dari cache SW), pencarian rute masih bisa. (Reload pertama setelah SW ke-install.)

- [ ] **Step 5: Commit**

```bash
git add web/manifest.json web/sw.js web/icons/
git commit -m "feat: PWA offline (manifest, service worker, icons)"
```

---

### Task 5: Deploy Pages + bungkus APK

**Files:** tidak ada kode — langkah rilis.

- [ ] **Step 1: Push ke GitHub + aktifkan Pages**

```bash
cd ~/jakarta-transit
gh repo create jakarta-transit --public --source=. --remote=origin --push
```
Lalu di GitHub: Settings → Pages → Source = branch `main`, folder `/web` (atau `/root` kalau repo di-set web sebagai root). Tunggu URL Pages live (mis. `https://<user>.github.io/jakarta-transit/`).

- [ ] **Step 2: Verifikasi PWA live**

Buka URL Pages di HP. Cek: bisa install ("Add to Home Screen" muncul), rute jalan, offline setelah load pertama.

- [ ] **Step 3: Generate APK/AAB via PWABuilder**

Buka `https://www.pwabuilder.com` → masukkan URL Pages → **Package For Stores** → Android.
- **APK** (sideload): install langsung di HP buat tes.
- **AAB** + `assetlinks.json`: simpan buat Google Play nanti. Taruh `assetlinks.json` yang dikasih PWABuilder ke `web/.well-known/assetlinks.json`, commit, push (biar TWA verified).

- [ ] **Step 4: Commit assetlinks (kalau sudah dapat)**

```bash
git add web/.well-known/assetlinks.json
git commit -m "chore: add TWA assetlinks for PWABuilder package"
git push
```

---

### Task 5b: Auto-refresh data mingguan (GitHub Actions)

**Files:**
- Create: `.github/workflows/refresh-data.yml`

**Prasyarat (manual, sekali):** Di GitHub repo → Settings → Secrets and variables →
Actions → New repository secret: `TRANSITLAND_API_KEY` = isi dari `.env` lokal.
(Tanpa ini `gtfs-fetch.sh` gagal di CI — key TIDAK ke-commit karena `.env` di-ignore.)

- [ ] **Step 1: Tulis `.github/workflows/refresh-data.yml`**

Catatan path: di CI `$HOME` bukan `~/jakarta-transit`, jadi override `GTFS_CACHE_DIR`,
`GTFS_DIR`, `OUT` ke `github.workspace`. Feed id = `f-transjakarta~id` (samakan dgn dir
yang dibaca `build-data.py`), BUKAN `f-transjakarta`.

Create `.github/workflows/refresh-data.yml`:
```yaml
name: refresh-data
on:
  schedule:
    - cron: "17 3 * * 1"    # tiap Senin 03:17 UTC (~10:17 WIB)
  workflow_dispatch: {}       # tombol "Run workflow" manual

permissions:
  contents: write

env:
  GTFS_CACHE_DIR: ${{ github.workspace }}/data
  GTFS_DIR: ${{ github.workspace }}/data/f-transjakarta~id/extracted
  OUT: ${{ github.workspace }}/web/data.json
  TRANSITLAND_API_KEY: ${{ secrets.TRANSITLAND_API_KEY }}

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.x" }
      - uses: actions/setup-node@v4
        with: { node-version: "20" }

      - name: Fetch GTFS + rebuild data.json
        run: |
          ./gtfs-fetch.sh f-transjakarta~id
          python3 build-data.py

      - name: Tes (gate — jangan push kalau merah)
        run: |
          python3 test_build.py
          node test-router.js

      - name: Commit hanya kalau data.json berubah
        run: |
          if git diff --quiet -- web/data.json; then
            echo "data.json tak berubah — skip commit"
          else
            git config user.name  "github-actions[bot]"
            git config user.email "github-actions[bot]@users.noreply.github.com"
            git add web/data.json
            git commit -m "chore: auto-refresh GTFS data"
            git push
          fi
```

- [ ] **Step 2: Commit workflow**

```bash
git add .github/workflows/refresh-data.yml
git commit -m "ci: weekly auto-refresh of web/data.json from GTFS"
git push
```

- [ ] **Step 3: Verifikasi manual sekali**

Di GitHub → tab Actions → workflow `refresh-data` → **Run workflow** (workflow_dispatch).
Expected: hijau. Kalau feed sama sha1 → log `data.json tak berubah — skip commit`.
Kalau beda → commit `chore: auto-refresh GTFS data` muncul + Pages redeploy.

> `// ponytail: cron cukup buat jadwal; skip sha1 sudah di gtfs-fetch.sh, gak perlu logika ekstra.`
> **Caveat:** GitHub auto-disable scheduled cron kalau repo 60 hari tanpa aktivitas.
> Kalau feed statis lama & cron mati: buka Actions → Enable, atau push apa pun. Jangan
> tambah keep-alive commit kosong kecuali kejadian beneran (YAGNI).

---

### Task 6: CHANGELOG + versi (konvensi rilis)

**Files:**
- Create: `CHANGELOG.md`

- [ ] **Step 1: Tulis `CHANGELOG.md`**

Create `CHANGELOG.md`:
```markdown
# Changelog

Semua rilis mengikuti SemVer. Versi juga tercermin di `web/sw.js` (`CACHE`).

## [1.0.0] — 2026-07-05
### Added
- Navigasi rute Transjakarta offline: halte asal → tujuan, minim transfer.
- Router Dijkstra (`web/router.js`) paritas dengan `route.py`.
- PWA offline (service worker, manifest) siap dibungkus APK via PWABuilder.
- Pipeline data `build-data.py` (GTFS → `web/data.json`).
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add CHANGELOG v1.0.0"
git push
```

---

## Catatan pemeliharaan (rujuk spec Bagian 14)
Update data GTFS **tidak** perlu rebuild APK:
```bash
cd ~/jakarta-transit
./gtfs-fetch.sh f-transjakarta   # skip kalau sha1 sama
python3 build-data.py            # regen web/data.json
python3 test_build.py && node test-router.js   # pastikan masih hijau
git add web/data.json && git commit -m "chore: update GTFS data" && git push
```
App terpasang narik `data.json` baru saat online (service worker SWR).
