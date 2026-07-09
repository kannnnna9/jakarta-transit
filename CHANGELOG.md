# Changelog

Semua perubahan penting dicatat di sini. Format: [Keep a Changelog](https://keepachangelog.com/id/1.1.0/),
versi mengikuti [SemVer](https://semver.org/lang/id/).

## [1.7.0] - 2026-07-09

Estimasi waktu tempuh + tarif di ringkasan rute. Router Pareto tetap berbasis transfer + halte; waktu dan tarif hanya dihitung untuk ditampilkan.

### Added

- **Estimasi waktu tempuh**: `build-data.py` menambahkan `etime` per edge dari median delta `arrival_time` GTFS, dengan fallback jarak haversine ÷ kecepatan default.
- **Estimasi tarif**: `build-data.py` menambahkan `fare` per route dari `fare_rules.txt` + `fare_attributes.txt`.
- **Helper biaya rute**: `web/cost.js` menghitung `{ secs, fare }` dari path router, termasuk aturan BRT sekali bayar, transfer `s`/`o` gratis dalam sistem, `w` reset sesi, Mikrotrans gratis, dan PP/PP2/PP3 per-naik.
- **Ringkasan UI**: baris hasil rute kini tampil `transfer · halte · ~N mnt · RpX/Gratis`.

### Changed

- **route.py**: oracle ikut memuat `etime` + `fare`, menghitung biaya rute dengan rumus sama seperti `web/cost.js`, dan mencetak waktu/tarif di output CLI.
- **web/sw.js**: cache app-shell di-bump `jt-v8` → `jt-v9` dan `cost.js` masuk precache.

### Notes

- Router inti dan Pareto 2D tidak berubah.
- Waktu adalah ride-only: tanpa waktu tunggu dan tanpa menit jalan kaki.
- Semua tes hijau (`test_build.py`, `test-router.js`, `test-legs.js`, `test-suggest.js`, `test-livenav.js`, route.py selftest).

## [1.6.0] - 2026-07-08

Transfer 3-jenis UI: jarak jalan kaki ditampilkan, label per-jenis dirapikan, distance diteruskan dari data.json ke path → legs → UI.

### Added

- **Jarak jalan kaki di UI**: Transfer tipe "w" (walk) kini menampilkan perkiraan jarak
  ("🚶 Jalan kaki ~72 m ke Karet"). Jarak berasal dari data `xfer` (haversine < 150 m).
- **Distance flow end-to-end**: `xfer[N] = [[stopIdx, type, dist_m], ...]` →
  `router.js` pass `xdist` ke `path[].xdist` → `legs.js` `leg.xdist` → `transferBlock()` UI.
  Paritas: `route.py` juga pass `xdist` (5-tuple path: `("take", stop, route, xtype, xdist)`).

### Fixed

- **web/app.js**: `transferBlock()` dirapikan — tipe "s" eksplisit ("↔️ Pindah peron di…"),
  tipe "o" ("🔗 Pindah di halte terhubung…"), tipe "w" ("🚶 Jalan kaki ~N m ke…"),
  fallback "↔️ Lanjut naik…" (non-BRT / unknown).
- **web/legs.js**: `pathToLegs()` kini pass `xdist` dari path ke leg (sebelumnya drop).
- **web/router.js**: `targets` array kini bawa `xdist` dari `xfer` edge (sebelumnya drop).
- **route.py**: Path tuple naik dari 4 → 5 elemen (`xtype` + `xdist`). Selftest ikut disesuaikan.

### Notes

- Data (`build-data.py`) TIDAK berubah — field `xfer` sudah punya `dist` sejak v1.1.
  v1.6 cuma mem-_surface_ distance yang sudah ada ke UI.
- Semua tes hijau (`test_build.py`, `test-router.js`, route.py selftest, legs xdist check).
- SW cache di-bump `jt-v7` → `jt-v8` (app-shell: router.js, legs.js, app.js).

## [1.5.1] - 2026-07-07

Hotfix Pareto router — fixed dominated-label pruning yang terlalu agresif sehingga rute 0-transfer tak ditemukan.

### Fixed

- **web/router.js**: Dominance pruning sekarang hanya dilakukan saat eksplorasi (bukan sebelum destination check). Jalur ke destination dikumpulkan dulu, lalu difilter Pareto di akhir. Memperbaiki bug di mana rute langsung (0-transfer) tidak muncul karena label di-prune sebelum mencapai tujuan.
- **web/app.js**: Tab selector pakai label deskriptif ("Minim transfer" / "Minim halte" / "Seimbang") alih-alih format "tf/st".

## [1.5.0] - 2026-07-07

Multi-rute Pareto: 2–3 rute alternatif (minim transfer / minim halte / seimbang) dengan UI tab selector.

### Added

- **Multi-rute Pareto**: Router kini menemukan semua rute Pareto-optimal dari halte asal ke tujuan.
  Setiap rute menampilkan tradeoff antara jumlah transfer vs jumlah halte. User pilih sendiri via
  tab selector (🟢 rute pertama / 🟡 rute kedua / ⚪ rute ketiga).
- **Dijkstra Pareto (label-setting)**: Algoritma menyimpan semua non-dominated labels per state
  `(stop, route)`, lalu filter & sort berdasarkan `(transfers, stops)`. Paritas antara `route.py`
  + `web/router.js`.
- **UI tab selector**: Tombol-tombol pilihan rute di atas hasil rute (muncul jika >1 opsi). User
  switch tab untuk lihat rute alternatif tanpa reload/pencarian ulang.
- **Weighted cost tetap**: Internal cost model tetap `transfer × WEIGHT + stops` untuk optimal
  exploration, tapi output Pareto menampilkan semua tradeoff yang non-dominated.

### Changed

- **route.py**: `find()` mengembalikan list Pareto-optimal routes`. Tambah `_dominates()`
  helper untuk filter non-dominated pairs. Selftest test Pareto multi-route (0-transfer long vs 1-transfer short).
- **web/router.js**: Port Pareto algorithm dari route.py. `findRoute()` return list,
  `routeOptions` di `app.js` store all routes. Route selector UI (tab buttons).
- **web/app.js**: Update `render()` handle single route (single object) atau multi-route (array).
  Tambah `routeSelector()`, `switchRoute()` functions. Summary berubah jadi "Pilihan X: Y transfer · Z halte".
- **web/index.html**: CSS `.route-selector`, `.route-tabs`, `.active` untuk tab buttons. Tambah hover/active styles.

### Fixed

- **Paritas router**: route.py + router.js konsisten menemukan Pareto routes yang sama. Test paritas:
  Pancoran→Ragunan: 0tf/18st + 1tf/10st; Simpang→CSW: 0tf/16st + 1tf/2st.

### Notes

- Router & data TIDAK diubah — murni tambahan rendering/DOM. Semua tes lama hijau
  (`test_build.py`, `test-router.js`, `test-legs.js`, `test-suggest.js`, `test-livenav.js`, route.py selftest).
- SW cache di-bump `jt-v7` (app-shell: route selector, tab styles).
- Semua path relatif — tetap aman di subpath `/jakarta-transit/`.

[1.7.0]: https://github.com/kannnnna9/jakarta-transit/releases/tag/v1.7.0
[1.6.0]: https://github.com/kannnnna9/jakarta-transit/releases/tag/v1.6.0
[1.5.1]: https://github.com/kannnnna9/jakarta-transit/releases/tag/v1.5.1
[1.5.0]: https://github.com/kannnnna9/jakarta-transit/releases/tag/v1.5.0

## [1.4.0] - 2026-07-07

Navigasi live: highlight halte aktif di daftar rute (tanpa peta).

### Added

- **Navigasi live** (`🧭 Mulai navigasi`, muncul setelah rute tampil): `watchPosition` GPS →
  tiap fix, posisi di-snap ke halte terdekat **di jalur rute** (radius 50 m, knob `RADIUS_M`),
  halte aktif di-highlight di daftar + auto-scroll; halte di dalam "N halte dilewati"
  (`<details>`) otomatis dibuka. Snap **maju-only** — GPS goyang tak memundurkan posisi
  (modul murni baru `web/livenav.js` `snap()`, reuse `Suggest.haversineM`, ada tes
  `test-livenav.js`). Status teks `Posisi: <halte> (n/N)`; sampai halte terakhir → navigasi
  berhenti sendiri dengan "🏁 Sampai". Tanpa peta/tiles — tetap ringan & offline.
- Tombol toggle `⏹ Berhenti navigasi`; error GPS (izin ditolak / sinyal lemah) ditangani.
  Cari rute baru otomatis menghentikan navigasi.

### Notes

- Router (`route.py` + `web/router.js`) dan data TIDAK diubah — murni tambahan render/DOM
  (`app.js`, `index.html` CSS `.here`) + modul murni `livenav.js`. Semua tes lama hijau.
- SW cache di-bump `jt-v6` (app-shell: + `livenav.js`).

[1.4.0]: https://github.com/kannnnna9/jakarta-transit/releases/tag/v1.4.0

## [1.3.0] - 2026-07-06

Nomor halte BRT sesuai peta integrasi resmi.

### Added

- **Nomor halte BRT sesuai peta integrasi resmi** (ed. 2026-06): badge "koridor-urut" (contoh `1-20 Kota`, `9-13 Widya Chandra Telkomsel`) tampil sebelum nama halte di hasil rute (asal, Naik/Turun, halte dilewati, tujuan). Halte bersama lintas koridor dapat multi-nomor (contoh Kota = 1-20 + 12-6). Nomor TIDAK ada di GTFS — diturunkan `build-data.py` dari urutan halte trip terpanjang tiap koridor 1–14 (arah origin resmi peta), halte khusus-arah-balik dapat nomor lanjutan; ±45 label diverifikasi manual terhadap `integrasi.jpg` + tabel `SNUM_OVERRIDE` kecil untuk beda GTFS vs peta (gabungan "ASEAN Kejaksaan Agung" 1-2, area Kota koridor 1, leg balik koridor 2, ujung koridor 3 Pasar Baru). Field baru `snum` di data.json (799 halte). Catatan jujur: nomor halte yang tak terverifikasi manual bisa geser ±1 kalau GTFS beda dgn peta cetak.
- Warning build kalau origin koridor hilang di GTFS masa depan (deteksi drift).

### Changed

- SW cache di-bump `jt-v5`.

### Test

- `test_build.py` section 7 (11 stasiun acuan + guard varian malam koridor 1 Petojo/Pasar Santa), semua tes lama tetap hijau.

[1.3.0]: https://github.com/kannnnna9/jakarta-transit/releases/tag/v1.3.0

## [1.2.0] - 2026-07-06

Perjelas tampilan transit + jenis bus.

### Added

- **Tampilan rute per-leg (per naik-bus):** hasil rute kini dikelompokkan jadi "leg". Tiap leg tampil header trayek + halte "Naik:" dan "Turun:" yang eksplisit — dulu deretan halte datar bikin titik transit tenggelam. Modul baru `web/legs.js` (`pathToLegs`, murni, ada tes `test-legs.js`).
- **Blok transfer menonjol** antar-leg dengan ikon beda per jenis: 🚶 "Jalan kaki ke <halte>" (xtype w), 🔗 "Pindah di halte terhubung" (transfer resmi, xtype o), ↔️ "Pindah peron di <halte>" (halte sama, xtype s). Sebelumnya jenis transfer cuma label kecil " · transfer resmi" yang gampang kelewat.
- **Badge jenis bus** di tiap leg dari kelas layanan GTFS (`route_desc`): BRT, Angkutan Umum Integrasi (non-BRT), Mikrotrans, Transjabodetabek, Royaltrans, Rusun, Shuttle, Bus Wisata. BRT diberi warna aksen (tulang punggung). Catatan jujur: data TIDAK bisa bedakan merek armada Minitrans vs Metrotrans (itu bukan di GTFS), jadi yang ditampilkan adalah 8 kelas layanan, bukan merek bus.
- **Halte yang dilewati bisa dibuka-tutup** via native `<details>` ("N halte dilewati") — default ringkas, klik untuk lihat detail. Nol JavaScript tambahan.

### Notes

- Router (`route.py` + `web/router.js`) dan data TIDAK diubah — murni perubahan render (`web/app.js`) + CSS (`web/index.html`). Semua tes lama tetap hijau (test-router, test-suggest, route.py selftest).
- SW cache di-bump `jt-v4` (app-shell berubah: `legs.js` baru + `app.js`/`index.html`).

[1.2.0]: https://github.com/kannnnna9/jakarta-transit/releases/tag/v1.2.0

## [1.1.1] - 2026-07-06

Perbaiki rute muter absurd (model biaya weighted).

### Fixed

- **Rute muter dihindari:** model biaya router diganti dari lexicographic (minim-transfer DULU) jadi **weighted** `transfer × 8 + halte`. Sebelumnya rute 0-transfer yang muter (mis. Simpang Kuningan → CSW 1 = 0 transfer tapi **16 halte muter** lewat Flyover Kuningan pada trayek loop L13E) menang atas rute 1-transfer/2-halte yang jauh lebih waras. Sekarang transfer "berharga" ~8 halte, jadi rute pendek-tapi-transfer dipilih. `route.py` + `web/router.js` disamakan (paritas oracle).
- **route.py deterministik:** iterasi `set` diurutkan supaya output CLI stabil antar-run (weighted bikin kasus seri lebih sering).

### Notes

- Rute normal tak berubah — teruji: Pancoran Arah Barat → Komplek Polri Ragunan tetap 0 transfer/18 halte/koridor 5N; Cikoko → Blok M tetap 1 transfer/7 halte. Cuma kasus rute-muter yang diperbaiki.
- `WEIGHT = 8` adalah tuning knob (sweet spot 4–12; W=0 buruk/transfer-happy). Kalibrasi bila ada rute aneh lain.
- SW cache `jt-v3` (app-shell `router.js` berubah).
- Roadmap baru: **beberapa opsi rute (Pareto)** biar user pilih tradeoff sendiri (`docs/ROADMAP.md`).

[1.1.1]: https://github.com/kannnnna9/jakarta-transit/releases/tag/v1.1.1

## [1.1.0] - 2026-07-06

Halte terdekat via GPS, pencarian substring, dan transfer bertipe (stasiun-sama / resmi / jalan kaki).

### Added

- **Halte terdekat (GPS):** tombol 📍 mengurutkan saran halte berdasarkan jarak (haversine) dari lokasi pengguna. Izin/timeout GPS ditangani supaya UI tak macet.
- **Pencarian substring + dedup:** helper murni `web/suggest.js` (teruji di Node) — cocokkan nama halte sebagian, nama duplikat (peron) tampil sekali.
- **Transfer 3-jenis:** router kini pakai link transfer tambahan dari 3 sumber — `parent_station` sama (stasiun sama), `transfers.txt` resmi (skip tipe 3), dan kedekatan jalan kaki < 150 m (haversine, grid bucket). Tiap transfer diberi label jenis di hasil rute.
- **Label non-BRT:** trayek non-BRT (Mikrotrans/Royaltrans/Angkutan Umum Integrasi/dll) ditandai dari `route_desc`.
- **Data diperkaya:** `web/data.json` kini membawa `lat`/`lon` per halte, `rtype` per trayek, dan peta `xfer` (7406 node / 20652 link berarah).

### Changed

- Router `route.py` + `web/router.js` menyimpan jenis transfer (`xtype`) di tiap langkah; model biaya tetap `(transfer, halte)` — jenis transfer hanya label, bukan dimensi biaya (penalti jarak jalan kaki ditunda, lihat `docs/ROADMAP.md`).
- `route.py` membangun `xfer` yang sama persis dengan `build-data.py` → paritas oracle terjaga (7406 node identik).

### Notes

- Paritas router terverifikasi: Pancoran Arah Barat → Komplek Polri Ragunan tetap 0 transfer / 18 halte / koridor 5N.
- Navigasi live (highlight-list, watchPosition) ditunda ke v1.2.

[1.1.0]: https://github.com/kannnnna9/jakarta-transit/releases/tag/v1.1.0

## [1.0.0] - 2026-07-06

Rilis pertama — MVP jalan penuh (PWA offline, deploy GitHub Pages).

### Added

- Router Dijkstra murni (`web/router.js`): minim-transfer lalu minim-halte, paritas dengan router referensi `route.py`.
- Generator data (`build-data.py`): GTFS Transjakarta → `web/data.json` (8243 halte, 256 rute).
- UI teks (`web/index.html` + `app.js`): pilih halte asal/tujuan via autocomplete datalist native, EXACT-match nama halte.
- PWA offline: `manifest.json` + service worker (`sw.js`) — app-shell cache-first, `data.json` stale-while-revalidate.
- Fetch GTFS (`gtfs-fetch.sh`): tarik + cache feed Transitland, skip download kalau sha1 sama.
- Deploy GitHub Pages via GitHub Actions (`.github/workflows/pages.yml`).
- Auto-refresh data mingguan via GitHub Actions cron (`.github/workflows/refresh-data.yml`).

### Notes

- Scope v1.0: GTFS static, TANPA waktu tempuh / realtime.
- Search substring & pilih halte terdekat (GPS) ditunda ke v1.1 (lihat `docs/ROADMAP.md`).

[1.0.0]: https://github.com/kannnnna9/jakarta-transit/releases/tag/v1.0.0
