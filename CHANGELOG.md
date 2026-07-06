# Changelog

Semua perubahan penting dicatat di sini. Format: [Keep a Changelog](https://keepachangelog.com/id/1.1.0/),
versi mengikuti [SemVer](https://semver.org/lang/id/).

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
