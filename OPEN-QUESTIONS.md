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

## Scope v1.0
- [x] **Scope router** — DECIDED 2026-07-05: minim-transfer lalu minim-halte, GTFS static,
      TANPA waktu tempuh / realtime. Oke buat v1. (Diskusi algoritma lanjut menyusul.)
