# Open Questions — Jakarta Transit Navigator

> Keputusan yang BELUM final. Agent JANGAN mengarang jawaban — kalau ketemu item di
> sini saat implementasi, berhenti dan tanya. Item DECIDED = pakai apa adanya.
> Referensi rencana: `docs/superpowers/plans/2026-07-05-jakarta-transit-navigator.md`.

## Deploy
- [x] **Pages folder** — DECIDED 2026-07-05: `/web`. Repo dibiarkan apa adanya, `web/`
      jadi source Pages. (GitHub: Settings → Pages → branch `main`, folder `/web`.)
- [x] **Repo publik?** — DECIDED 2026-07-05: ya, publik. Butuh buat Pages gratis; data
      GTFS Transjakarta memang publik. `gh repo create jakarta-transit --public`.
- [x] **URL Pages** — DECIDED 2026-07-05: `https://kannnnna9.github.io/jakarta-transit/`
      (username `kannnnna9`, dari git config).

## Rilis / Store
- [x] **Target rilis v1.0** — DECIDED 2026-07-05: **APK sideload dulu**. PWABuilder →
      APK, install langsung di HP buat tes. AAB + signing key + assetlinks TWA DISIMPAN
      buat Play nanti (Task 5 Step 4 ditunda; belum bikin akun dev Google Play $25).
- [x] **Nama app** — DECIDED 2026-07-05: **"Jakarta Transit"** (ganti dari "Rute
      Transjakarta"). `short_name` = `"Transit"` (default pilihanku, muat di home screen;
      timpa kalau mau lain). Wajib sinkron: `web/manifest.json` (name+short_name),
      `web/index.html` (`<title>` + `<h1>`).

## Aset
- [x] **Ikon** — DECIDED 2026-07-05: placeholder 1 warna, glyph ikut nama (mis. "JT").
      `ponytail:` cukup buat install/PWABuilder. Ganti desain asli SEBELUM submit Play
      (belum urgent karena v1 = sideload). Pembuat/generator: tentukan saat mau rilis Play.

## Data
- [x] **Sumber feed** — DECIDED 2026-07-05: `f-transjakarta~id` via `gtfs-fetch.sh`
      (feed dipakai apa adanya).
- [x] **Frekuensi refresh** — DECIDED 2026-07-05: **otomatis mingguan** via GitHub Actions
      cron (Senin ~10 WIB), lihat plan Task 5b. Commit hanya kalau feed berubah (skip sha1).
      Butuh secret `TRANSITLAND_API_KEY` di repo. App narik `data.json` baru via SW SWR.
      Manual masih bisa (workflow_dispatch / prosedur "Catatan pemeliharaan").

## Known Issues (DECIDED: tunda, bukan blocker)
- [x] **Silent "tak ada rute" di all-modes lintas-kota jauh** — ditemukan 2026-07-12.
      `find_goal`/`shortestGoal` nyerah pas `seen` mentok `MAX_GOAL_STATES` (2jt) lalu
      balik `None` SEOLAH tak ada rute — padahal rute ADA. Bukti: Manggarai→Kalideres
      all-modes cap 2jt = None; cap 20jt = 3tf/17st/20.0km (identik hasil BRT-only).
      Sebab: mode longgar (≈200 route Mikrotrans dkk) meledakkan ruang state; grafik
      besar → cap habis sebelum sampai tujuan. **Kenapa ditunda:** cuma kena skenario
      ekstrem (semua-angkutan + antar-terminal jauh). Pemakaian nyata (BRT-only, dalam
      kota) TAK pernah kena — 0 laporan lapangan. **JANGAN nambal naikin cap** (bikin
      lambat → timeout di HP, malah nurunin cap efektif; opencode sempat turunin ke 500k
      di proto). Fix benar (kalau nanti perlu): pencarian goal-directed/A* (heuristik
      arah tujuan) biar ketemu dalam LEBIH SEDIKIT langkah. Trigger garap: ada user
      beneran kena, atau tab all-modes jadi default. Sampai itu: known-issue saja.
      NB: Model C mewarisi bug ini (pakai `find_goal` yang sama) — bukan regresi baru.

## Scope v1.0
- [x] **Scope router** — DECIDED 2026-07-05: minim-transfer lalu minim-halte, GTFS static,
      TANPA waktu tempuh / realtime. Oke buat v1. (Diskusi algoritma lanjut menyusul.)

## Bug router (ditemukan 2026-07-10, diskusi Reza) — DECIDED, spec siap
> Semua sudah diputuskan. Spec implementasi:
> `docs/superpowers/specs/2026-07-10-v1.10-router-rasa-manusia-design.md`. Codex garap langsung.
- [x] **"Jarak terpendek" muter kebanyakan transfer** — DECIDED: tambah denda tetap
      `X = 200 m` per transfer di `goal="dist"`. Transfer layak hanya kalau ngirit >200 m.
      Bukti data: transfer berguna ngirit ribuan m, sampah ngirit puluhan m (Pancoran→Kota
      6tf→0tf). X=100/200/500 hasil identik; 200 = tengah teraman, tunable.
- [x] **"Paling simpel" v2 (bobot transfer nyata)** — DECIDED: denda transfer = JARAK
      PERON NYATA dari koordinat lat/lon (peron ~6–20 m, jalan kaki ~136 m). Halte besar
      (CSW 13 m) otomatis lebih mahal tanpa data luas bangunan (GTFS tak punya).
      `cost = halte×STOP_M + Σ jarak_transfer_m`. Jaga: peron JANGAN nol mutlak (cegah bug
      muter), jumlah halte tetap bos. Prototype `proto_simple_v2.py` sudah benerin kasus
      Simpang Kuningan→CSW (peron, bukan nyebrang 🚶136m).
- [x] **`STOP_M` awal** — DECIDED: 40 (1 halte ≈ jalan 40 m). Sesuaikan setelah
      lihat rute nyata live kalau ada bukti; tunable, bukan blocker.
