# Roadmap — Jakarta Transit

Fase bertahap (DECIDED 2026-07-06). v1.0 = plan siap koding
(`docs/superpowers/plans/2026-07-05-jakarta-transit-navigator.md`). v1.1/v1.2 di sini
sebagai desain; jadikan superpowers plan sendiri saat mau digarap.

---

## v1.0 — MVP (plan sudah ada, ship dulu)
Cari rute nama→nama, minim transfer, list halte dilewati, PWA offline, APK sideload.
Transfer = nama halte sama persis. Belum ada koordinat/GPS. **Bukti jalan dulu.**

---

## v1.1 — Koordinat + GPS pilih halte + transfer 3-jenis

### Data (`build-data.py` diperluas)
Sekarang buang koordinat & metadata. Tambah per stop:
- `lat`, `lon` (dari `stops.txt` stop_lat/stop_lon) — buat GPS & proximity.
- `parent` (parent_station), `platform` (platform_code) — buat transfer "halte sama".
- Per route: `type` (dari `route_desc`: BRT / Mikrotrans / Royaltrans / Transjabodetabek /
  Angkutan Umum Integrasi …) — buat bedain BRT vs non-BRT.
- `transfers`: link dari `transfers.txt` (7 pasang) + hasil proximity (lihat bawah).

### Model transfer (redesain inti — gabung 4 sumber)
Transfer bukan lagi "nama persis" doang. Bangun edge transfer dari:
1. **parent_station sama** → "Pindah peron {platform A}→{B}, stasiun sama". (nutup 607 stop BRT)
2. **transfers.txt** (7 link resmi, transfer_type=0) → transfer eksplisit.
3. **proximity haversine < 150 m** (DECIDED; tunable) → JPO/jalan kaki tak terdaftar.
4. **fallback nama sama** → buat ~7600 stop non-parent (Mikrotrans/feeder) yg share nama.

Tiap edge simpan `type` + jarak → label detail + bobot cost beda:
| type | label UI | cost relatif |
|---|---|---|
| same_station | "Pindah peron X→Y (stasiun sama)" | murah |
| walk / JPO | "Jalan kaki ~N m (JPO)" | lebih mahal (jarak) |
| to_non_brt | "Lanjut naik {Mikrotrans/Royaltrans/…}" | tandai non-BRT |

Router: cost tetap lexicographic dasar (transfer, halte), tapi transfer jalan-kaki
di-penalti (jarak/waktu) biar rute wajar. Jaga paritas semantik dg `route.py` — kalau
model berubah, update `route.py` + test paritas dulu (TDD).

### UI
- Pilih halte: `navigator.geolocation` → urutkan saran halte pakai haversine (terdekat
  atas). Grup peron via `parent` biar saran tak dobel. Ketik-nama tetap jalan.
- Hasil rute: tiap transit tampilkan label jenis (tabel atas) + jarak jalan kaki kalau ada.

---

## v1.1.1 — Weighted route cost (fix rute muter) — DECIDED 2026-07-06
Masalah: model biaya lexicographic (minim-transfer DULU) bikin rute 0-transfer yang muter
absurd (mis. Simpang Kuningan→CSW 1 = 0 transfer / 16 halte muter lewat Flyover) menang atas
1-transfer/2-halte yang jauh lebih waras. Loop itu NYATA di data (trip L13E-L07 fisik loop),
bukan bug data — akarnya model biaya + "balik arah" = pindah peron (`stop_id` beda, nama sama)
yang mestinya dihitung transfer.
Fix: biaya = `transfer × WEIGHT + halte`, `WEIGHT = 8` (tunable). Transfer dipilih hanya kalau
hemat >WEIGHT halte. Teruji: Simpang→CSW jadi 1tf/2halte; Pancoran→Ragunan & Cikoko→Blok M
TAK berubah (rute normal aman). W=0 buruk (transfer-happy), W sweet spot 4–12.
`// ponytail: WEIGHT knob dunia-nyata; kalibrasi kalau ada rute aneh lain.`

## v1.2.0 — Perjelas transit + jenis bus — SHIPPED 2026-07-06
Hasil rute dikelompokkan per-leg (Naik:/Turun: eksplisit), blok transfer menonjol dengan ikon per
jenis (jalan kaki / transfer resmi / pindah peron), badge jenis bus dari `route_desc` (8 kelas
layanan GTFS, bukan merek armada), dan halte dilewati bisa dibuka-tutup via `<details>`. Router &
data tak berubah. Detail: `CHANGELOG.md` [1.2.0].

## v1.3.0 — Nomor halte BRT sesuai peta integrasi resmi — SHIPPED 2026-07-06
Badge "koridor-urut" (mis. `1-20 Kota`) di depan nama halte tiap muncul di hasil rute, diturunkan
`build-data.py` dari urutan halte per koridor + verifikasi manual vs peta cetak (`SNUM_OVERRIDE`
buat beda GTFS/peta). Router & UI tak diubah. Detail: `CHANGELOG.md` [1.3.0].

## v1.5 — Beberapa opsi rute (Pareto) — SHIPPED 2026-07-07

v1.5.0 + v1.5.1 (hotfix) SHIPPED + LIVE (riwayat lengkap di [`CHANGELOG.md`](CHANGELOG.md)).

### Added (v1.5)
- **Multi-rute Pareto**: Router kini menemukan 2-3 rute alternatif Pareto-optimal. Setiap rute menampilkan
  tradeoff: **minim transfer** vs **minim halte** vs **seimbang**. User pilih sendiri via tab selector.
- **Dijkstra Pareto (label-setting)**: Algoritma menyimpan semua non-dominated labels per state (stop, route).
  Output list solusi terurut (transfers, stops). Paritas antara `route.py` + `web/router.js`.
- **UI tab selector**: Tombol-tombol pilihan rute dengan label deskriptif ("Minim transfer" / "Minim halte" / "Seimbang"), warna dot (🟢/🟡/⚪). Tab muncul hanya jika ≥2 opsi.
- **Weighted cost tetap**: Internal cost model tetap `transfer × WEIGHT + stops` untuk optimal exploration,
  tapi output Pareto menampilkan semua tradeoff yang non-dominated.

### Changed (v1.5)
- **router.js + route.py**: Implementasi Pareto algorithm. Router ambil Pareto solutions dari heap
  exploration, filter unique (transfers, stops), sort, limit. Paritas oracle terjaga (Pancoran→Ragunan: 0tf/18st + 1tf/10st).
- **web/app.js + index.html**: Render route selector jika >1 opsi. User switch tab untuk pilih rute.
  Summary berubah jadi "Pilihan X: Y transfer · Z halte".

### Notes
- Router & data TIDAK diubah — murni tambahan rendering/DOM. Semua tes lama hijau.
- `web/sw.js` cache di-bump `jt-v7` (app-shell: + route-selector, tab styles).
- Path seluruhnya relatif — tetap aman di subpath `/jakarta-transit/`.

---

## Tuning knobs (dunia nyata — jangan hard-freeze)
- Proximity transfer: **150 m** default. GPS/jarak halte Jakarta padat → coba 100–200 m.
- Radius "sampai halte" live nav: **50 m** (akurasi GPS HP ~10–30 m).
- Penalti cost jalan kaki: kalibrasi setelah lihat rute nyata (mis. 1 transfer walk ≈ N halte).
