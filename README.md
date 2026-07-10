# Jakarta Transit

Navigasi rute Transjakarta — **ringan, offline, tanpa peta**. PWA statis, deploy GitHub Pages.

**LIVE:** https://kannnnna9.github.io/jakarta-transit/

Pilih halte asal + tujuan (autocomplete nama halte), lalu pilih rute berdasarkan tarif terendah, paling simpel, jarak terpendek, atau Kejutan (beta). Data GTFS Transjakarta, router Dijkstra murni jalan di browser. Bisa di-install jadi app (PWA / APK via PWABuilder).

## Status

- **v1.10.0** — SHIPPED (lihat [`CHANGELOG.md`](CHANGELOG.md)). Router rasa manusia: simpel pakai jarak transfer nyata, jarak terpendek kena penalti transfer.
- Sisa: regenerate APK di PWABuilder saat mau (ikon sekarang placeholder "JT").
- Roadmap berikutnya (testing/tuning dunia nyata + opsi Kejutan ber-seed): [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Struktur

```
web/                app statis (yg di-deploy Pages)
  index.html app.js router.js   UI + router Dijkstra (paritas route.py)
  data.json                     hasil build dari GTFS (8243 halte, 256 rute)
  manifest.json sw.js icons/    PWA offline
build-data.py       GTFS extracted -> web/data.json
gtfs-fetch.sh       tarik + cache GTFS dari Transitland (butuh TRANSITLAND_API_KEY)
route.py            router referensi Python (sumber paritas router.js)
make-icons.py       generator ikon placeholder (pure-stdlib, zero-dep)
test_build.py       tes build-data
test-router.js      tes router (paritas route.py)
docs/               spec, plan (TDD), roadmap
OPEN-QUESTIONS.md   keputusan desain yg dikunci
```

## Jalanin lokal

```bash
# 1. refresh data (perlu sekali / kalau feed berubah)
export TRANSITLAND_API_KEY=xxx      # atau taruh di .env
bash gtfs-fetch.sh f-transjakarta~id
python3 build-data.py               # -> web/data.json

# 2. serve
python3 -m http.server -d web 8000  # buka http://localhost:8000

# tes
python3 test_build.py
node test-router.js
```

## Deploy

- **Pages** otomatis via GitHub Actions ([`.github/workflows/pages.yml`](.github/workflows/pages.yml)) tiap push ke `main`. Catatan: folder `/web` gak bisa jadi source Pages langsung (GitHub cuma izinkan `/` atau `/docs`), jadi di-publish sebagai artifact lewat workflow.
- **Data auto-refresh** mingguan ([`.github/workflows/refresh-data.yml`](.github/workflows/refresh-data.yml), Senin 03:17 UTC). Commit `web/data.json` hanya kalau feed berubah. Butuh repo secret `TRANSITLAND_API_KEY`.

## Catatan portabilitas

Semua script **self-locate** (path-independent) — repo jalan dari folder mana pun / hasil `git clone`, tanpa tool eksternal. Path di web semua **relatif** (aman di subpath Pages). Termux gak punya PIL/ImageMagick → ikon dibuat pure-stdlib.

Konteks lengkap buat lanjutin kerja (termasuk lintas tool AI): baca [`AGENTS.md`](AGENTS.md).
