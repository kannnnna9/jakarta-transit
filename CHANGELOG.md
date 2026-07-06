# Changelog

Semua perubahan penting dicatat di sini. Format: [Keep a Changelog](https://keepachangelog.com/id/1.1.0/),
versi mengikuti [SemVer](https://semver.org/lang/id/).

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
