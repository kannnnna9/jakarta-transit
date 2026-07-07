# AGENTS.md

Panduan buat AI agent (Claude Code / opencode / Codex / dll) yg lanjutin proyek ini.
Repo = sumber kebenaran. Semua konteks ada di sini, bukan di memory tool tertentu.

## Baca urut sebelum kerja

1. [`README.md`](README.md) — apa proyeknya, struktur, cara jalanin.
2. [`OPEN-QUESTIONS.md`](OPEN-QUESTIONS.md) — keputusan yg SUDAH dikunci. Jangan bikin ulang. Item `DECIDED` = pakai apa adanya.
3. [`docs/superpowers/specs/`](docs/superpowers/specs/) — spec desain (sumber kebenaran perilaku).
4. [`docs/superpowers/plans/`](docs/superpowers/plans/) — plan implementasi TDD (Task 0–6).
5. [`docs/ROADMAP.md`](docs/ROADMAP.md) — rencana berikutnya (v1.4 live-nav DECIDED, v1.5 multi-rute Pareto ide).
6. [`CHANGELOG.md`](CHANGELOG.md) — apa yg udah rilis.

## Aturan

- **Versioning SemVer.** Tiap rilis: update `CHANGELOG.md` + tag. Rilis dihitung dari yg sudah LIVE di Pages.
- **Router = paritas `route.py`.** Ubah `web/router.js`? Jaga hasil tetap sama `route.py`; jalankan `node test-router.js`.
- **TDD.** Fitur/bugfix baru: tulis tes dulu (`test_build.py` / `test-router.js` / `test-legs.js` / `test-suggest.js`), baru implementasi.
- **Path web wajib relatif** (app jalan di subpath `/jakarta-transit/`). Jangan pakai `/absolute`.
- **Jangan commit** `.env` / `data/` (GTFS cache) — udah di `.gitignore`.

## Gotcha lingkungan (Termux)

- Gak ada PIL/ImageMagick/rasterizer SVG → aset gambar pakai pure-stdlib (`make-icons.py`).
- `rtk` proxy bisa rusakin `grep` ("-G: error while loading shared libraries") — pakai filter Python buat baca log kalau kena.

## Status sekarang

**v1.3.0 SHIPPED + LIVE** di Pages (riwayat lengkap: `CHANGELOG.md`). Sudah masuk: GPS/koordinat + transfer 3-jenis (v1.1), weighted route cost W=8 (v1.1.1), tampilan per-leg + badge jenis bus (v1.2.0), nomor halte BRT "koridor-urut" sesuai peta integrasi + `SNUM_OVERRIDE` (v1.3.0).

Sisa manual: regenerate APK di PWABuilder (situs eksternal, dikerjakan Reza) — ikon masih placeholder "JT", ganti logo asli sebelum submit Play.

Fitur berikutnya (lihat `docs/ROADMAP.md`):
- **v1.4 — Navigasi live** (DECIDED): `watchPosition`, highlight halte aktif di daftar, snap maju-only, radius ~50 m, tanpa peta.
- **v1.5 — Multi-rute Pareto** (ide, diminta Reza): 2–3 alternatif rute (minim transfer / minim halte / seimbang). Rancang jadi plan sendiri saat digarap.
