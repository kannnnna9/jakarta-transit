# Plan v1.4 — Navigasi live (highlight list, NO peta)

Desain dikunci di `docs/ROADMAP.md` v1.4 (DECIDED). Ringkas: `watchPosition` →
tiap fix cari halte terdekat **di jalur rute**, highlight halte aktif di daftar
hasil. Snap maju-only (GPS goyang jangan mundur), radius ambang ~50 m. Tanpa
peta/tiles — tetap ringan & offline.

## Arsitektur

- **`web/livenav.js`** (modul murni UMD, pola sama `legs.js`/`suggest.js`, teruji Node):
  - `snap(points, pos, cur, radiusM)` — `points` = `[{lat,lon}]` urutan halte
    rute; `pos` = fix GPS; `cur` = indeks aktif sekarang (-1 = belum mulai).
    Return indeks baru: titik terdekat `j >= max(cur,0)` dgn jarak ≤ `radiusM`;
    kalau tak ada dalam radius, `cur` tak berubah (jitter aman).
    Maju-only = tak pernah return < cur. Haversine reuse `Suggest.haversineM`.
- **`web/app.js`** (wiring DOM saja, router TAK disentuh):
  - `render()` kumpulkan `navPoints = [{idx, el}]` tiap `stopLi` berurut
    (start, naik, mid…, turun per leg; skip duplikat idx berurutan).
  - Tombol `🧭 Mulai navigasi` muncul setelah rute tampil. Toggle:
    `watchPosition` → snap → pindah class `.here`, buka `<details>` kalau halte
    aktif di dalamnya, `scrollIntoView`. Cari rute baru = nav berhenti.
  - Error/permission GPS ditangani (pola tombol 📍 yg sudah ada).
- **`web/index.html`**: CSS `.here` + tombol nav. **`web/sw.js`**: + `livenav.js`, bump `jt-v6`.

## TDD

`test-livenav.js` (Node, assert): maju ke titik terdekat dalam radius; fix di
luar radius = diam; maju-only (titik belakang lebih dekat tak dipilih); start
dari -1; pilih terdekat kalau >1 dalam radius. Tes lama tetap hijau
(`test-router.js`, `test-legs.js`, `test-suggest.js`, `test_build.py`).

## Rilis

v1.4.0 (minor). Sinkron CHANGELOG + ROADMAP (SHIPPED) + status README/AGENTS.md,
tag + GitHub Release, verifikasi LIVE di Pages.

Knob dunia nyata: `radiusM` default 50 (akurasi GPS HP ~10–30 m) — tunable.
