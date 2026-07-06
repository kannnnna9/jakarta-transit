# Jakarta Transit Navigator — Design Spec

Tanggal: 2026-07-05 · Status: desain disetujui, siap implementasi

## 1. Tujuan

App navigasi rute Transjakarta yang RINGAN & OFFLINE: input halte asal + tujuan → keluar rute (naik koridor apa, transfer di mana, daftar halte). TANPA jadwal keberangkatan, TANPA posisi bus realtime, TANPA peta (MVP). Target: bisa di-install di HP, ringan, gratis & open-source, berpotensi ke Google Play Store.

## 2. Yang SUDAH dikerjakan (state saat ini)

- `gtfs-fetch.sh` — ambil + cache feed GTFS dari Transitland, skip download kalau sha1 sama. Butuh `TRANSITLAND_API_KEY` di `.env` (sudah diisi, `.env` di-gitignore).
- GTFS Transjakarta sudah ke-download & extract: `data/f-transjakarta~id/extracted/` (8244 stops, 731 trips, 256 routes, 26955 stop_times, 5.1M zip).
- `route.py` — router REFERENSI (Python 3, offline, sudah jalan & lolos selftest). Ini ACUAN kebenaran buat port ke JS. Verifikasi nyata:

  ```bash
  python3 route.py "pancoran" "ragunan"
  ```

  → **0 transfer, 18 stop, langsung koridor 5N (Kampung Melayu–Ragunan)**. Ada `_selftest()` (feed mini, assert transfer=1/stop=2).

## 3. Keputusan arsitektur (jalur terpilih: "A")

PWA offline → dibungkus APK via PWABuilder.com (Trusted Web Activity). Alasan: reuse stack PWA Reza, offline penuh via service worker, nol toolchain berat di Termux, satu-satunya jalur mulus ke Play Store (AAB). Router Python tinggal di-port ~80 baris ke JS (logika Dijkstra identik).

Alternatif yang DITOLAK:
- WebView APK bundel lokal (butuh Android SDK/Gradle di Termux, jalur Play kurang mulus)
- Kivy/Buildozer (berat, lawan asas ringan)
- Flutter/native (stack baru)

## 4. Struktur file

```
jakarta-transit/
├─ gtfs-fetch.sh          # SUDAH ADA — ambil GTFS
├─ build-data.py          # BARU — GTFS extracted → web/data.json (sekali jalan tiap update feed)
├─ route.py               # SUDAH ADA — router acuan Python, buat verifikasi paritas
├─ docs/superpowers/specs/ # dokumen ini
└─ web/                   # PWA — ini yang jadi APK
   ├─ index.html          # UI: 2 input + tombol + hasil
   ├─ app.js              # router JS (port Dijkstra) + render DOM
   ├─ data.json           # output build-data.py (di-bundle)
   ├─ sw.js               # service worker: cache-first, offline penuh
   ├─ manifest.json       # nama, ikon, standalone
   └─ icons/
```

Alur: `build-data.py` (sekali) → `web/` PWA statik → push GitHub Pages → PWABuilder → APK/AAB.

## 5. Format data.json (integer-indexed biar kecil)

```json
{
  "stops":  ["Pancoran Arah Barat", "Tegal Mampang", "..."],
  "routes": ["5N (Kampung Melayu - Ragunan)", "..."],
  "edges":  { "12": { "40": [41, 88] } }
}
```

- `stops`: index → nama halte. `routes`: index → label `"short (long)"`.
- `edges`: routeIndex → stopIndex → array stopIndex berikutnya (adjacency berarah, dari pasangan stop berurutan tiap trip di `stop_times.txt`).
- Turunan DIHITUNG saat load (tidak disimpan): map `namaHalte → [stopIndex]` (buat grup transfer), dan `routes_at[stop]` (scan `edges` sekali).
- Perkiraan ukuran: ~26k edge → beberapa ratus KB mentah, ~100KB setelah gzip GitHub Pages.

## 6. Algoritma router (WAJIB identik di route.py & app.js)

Shortest-path Dijkstra, biaya = tuple `(jumlah_transfer, jumlah_stop)`, tiebreak counter unik (hindari banding field non-comparable di heap).

- **State** = `(stop, route)`. Awal boarding: route = null.
- **Ride**: dari `(stop, route)` maju ke stop berikutnya di route sama → transfer +0, stop +1.
- **Transfer/board**: di halte dengan NAMA SAMA PERSIS, pindah ke route lain → transfer +1 (kecuali boarding pertama dari null = +0), stop +0.
- **Asal/tujuan**: halte SPESIFIK yang dipilih user dari daftar (exact-name match). Multi-source HANYA mencakup peron ber-nama sama persis dari halte itu (mis. 2 arah). BUKAN substring lintas-halte. Substring cuma dipakai UI buat menyaring daftar autocomplete saat mengetik — titik final tetap nama persis. Grup transfer juga strict same-name.
- **Goal**: state pertama yang stop-nya masuk himpunan tujuan.
- Output: `{transfers, stops, path}`; `path` = urutan langkah `("board"|"take"|"ride", stopName, routeLabel)`.

Pseudocode ada di `route.py` fungsi `find()` — port langsung ke JS, jangan ubah semantik.

## 7. UI (MVP teks)

- 2 input asal/tujuan + `<datalist>` autocomplete (native, no library) dari `data.json`. User HARUS memilih halte spesifik dari daftar; substring ngetik cuma menyaring pilihan.
- Validasi: kalau teks input tidak cocok nama halte mana pun, tampilkan "halte tidak ditemukan — pilih dari daftar" (jangan tebak).
- Tombol "Cari rute" → panggil fungsi murni `findRoute(data, namaAsal, namaTujuan)` dengan NAMA HALTE PERSIS (TIDAK sentuh DOM) → render daftar langkah + ringkasan "N transfer · M halte".
- Mobile-first, CSS minimal.
- Pemisahan tegas: router murni (bisa dites headless di Node) vs render DOM.

## 8. PWA offline

- `manifest.json`: nama app, `display: standalone`, ikon (buat prompt install + Play).
- `sw.js`: **app-shell** (html/js/css) = cache-first, precache saat install → offline penuh. Bump versi cache (`CACHE = 'jt-v1'`) HANYA saat shell berubah.
- `data.json` = **stale-while-revalidate**: sajikan dari cache (instan/offline) TAPI fetch versi baru di background saat online → update data otomatis nyampe ke app terpasang tanpa bump cache & tanpa rebuild APK. Lihat Bagian 14.

## 9. Packaging → APK

1. Push isi `web/` ke GitHub Pages (HTTPS).
2. PWABuilder.com → masukkan URL PWA → generate AAB (Play) + APK (sideload) ter-sign.
3. Sideload sekarang: pasang APK. Play Store nanti: upload AAB + asset-links (disediakan PWABuilder).

## 10. Testing

- `build-data.py`: assert jumlah stops/routes cocok GTFS; sampel edge Pancoran ada.
- Router JS: port `_selftest` (feed mini, assert transfer=1, stop=2) jalan via `node`.
- **Paritas WAJIB**: kasih NAMA HALTE PERSIS yang sama ke `route.py` & `findRoute` → hasil identik (transfer, stop, koridor). Gate kebenaran port. (Smoke test Pancoran→Ragunan koridor 5N sebagai contoh.)
- Tanpa framework: assert polos + `node test.js`.

## 11. Ruang lingkup DITUNDA (JANGAN bangun di MVP)

Peta & garis rute; koordinat lat/lon + "halte terdekat" (butuh `shapes.txt`); jadwal/realtime; `transfers.txt` eksplisit (14 pasang platform beda-nama — same-name sudah nutup mayoritas hub, tambah kalau ada hub meleset); multi-feed (JakLingko/Mikrotrans).

## 12. Aturan & konvensi proyek

- **Ringan di atas segalanya** — asas utama. Native > library. Offline-first.
- **Immutability**: jangan mutasi objek, bikin baru.
- **File kecil & fokus** (target 200–400 baris, maks 800). Router murni terpisah dari DOM.
- **Versioning** (kebiasaan Reza): tiap rilis, update `CHANGELOG` + naikkan versi (SemVer: patch/minor/major). Verifikasi build LIVE sebelum dihitung rilis.
- **Data update**: lihat Bagian 14 (tidak perlu rebuild APK).
- **Secrets**: `TRANSITLAND_API_KEY` hanya di `.env` (gitignore). Jangan commit.

## 13. Handoff antar-tool (buat AI yang melanjutkan)

Repo self-contained. Untuk lanjut cold:

1. Baca `route.py` — itu spesifikasi router yang hidup & benar.
2. Port `find()` ke `web/app.js` sebagai `findRoute(data, asal, tujuan)`, verifikasi paritas Pancoran→Ragunan.
3. Tulis `build-data.py` (baca `data/f-transjakarta~id/extracted/*.txt`, keluarkan `web/data.json` sesuai Bagian 5).
4. Bangun `web/` (UI + PWA), tes offline, deploy Pages, PWABuilder.

Perintah verifikasi acuan:

```bash
cd ~/jakarta-transit && python3 route.py "pancoran" "ragunan"
```

## 14. Pemeliharaan & update data (penting)

**Kunci: APK TIDAK di-build ulang saat data GTFS berubah.** Jalur A (TWA) memuat konten live dari GitHub Pages. Data = file `data.json` di Pages. App terpasang menariknya via service worker (stale-while-revalidate), jadi:

| Yang berubah | Aksi | Rebuild APK? |
|---|---|---|
| Data GTFS (halte/rute) | update `data.json` di Pages | **Tidak** — auto nyampe saat user online |
| App shell (UI/logic `app.js`/`index.html`) | bump `CACHE` di `sw.js`, push Pages | Tidak wajib (opsional, kalau mau paksa versi) |
| Ikon/nama/manifest | rebuild via PWABuilder | Ya |

**Update data — MANUAL (cukup 3 langkah):**
```bash
cd ~/jakarta-transit
./gtfs-fetch.sh f-transjakarta      # skip kalau sha1 sama (tak ada perubahan)
python3 build-data.py               # regen web/data.json
git add web/data.json && git commit -m "chore: update GTFS data" && git push
```
GitHub Pages redeploy sendiri; app terpasang narik data baru saat online berikutnya. Frekuensi: feed Transjakarta jarang berubah (hitungan bulan), jadi manual pun ringan.

**Update data — OTOMATIS (opsional, nol sentuhan):** GitHub Actions cron (mis. mingguan):
1. Simpan `TRANSITLAND_API_KEY` sebagai GitHub repo secret.
2. Workflow: checkout → `./gtfs-fetch.sh f-transjakarta` → `python3 build-data.py` → commit `web/data.json` **hanya jika berubah** → push. Pages redeploy otomatis.
3. Karena `gtfs-fetch.sh` skip saat sha1 sama, commit cuma terjadi kalau feed beneran berubah.

Rekomendasi: mulai MANUAL (YAGNI), tambah Actions kalau update terasa merepotkan.
