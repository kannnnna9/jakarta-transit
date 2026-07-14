# TASK — Fix leg U-turn (bus muter loop) di tab Tarif + BRT-only

**Status:** SPEC FINAL (diskusi CC 2026-07-14). Implementasi: **opencode** (Codex mati sementara).
**Versi target:** v1.14.0. **Tool koding:** opencode.
**Prasyarat baca:** `route.py` (`find_goal`, `_targets`, `_access_stops`, `sanitize_path`), `web/router.js` (`shortestGoal`, `accessStops`, `sanitizePath`, `findAlternative`), `docs/TASK-alternatif-leg-hantu.md` (fix leg-hantu nama-sama v1.12.1 — INI BEDA, lihat §2).

---

## 1. Gejala (repro nyata Reza)

Filter layanan **BRT-only** aktif. Tujuan: **Underpass Kuningan → Cawang**.

Tab **🚩 Tarif terendah** kasih (1 transfer, 15 halte):

```
TAKE  Underpass Kuningan  [L13E (... Express)]  (pindah peron)
   .. Tegal Mampang
   .. CSW 1
   .. Velbak
   .. Petukangan D'MASIV      <-- puncak, lalu BALIK
   .. Petukangan D'MASIV
   .. Velbak
   .. CSW 1
   .. Simpang Kuningan
TAKE  Simpang Kuningan  [9 (Pinang Ranti - Pluit)]  (pindah peron)
   .. Tegal Parang ... Cawang
```

Satu naik L13E **lewat CSW 1 / Velbak / Petukangan D'MASIV masing-masing 2×** — bus muter balik (U-turn) 8 halte cuma untuk geser 1 halte (Underpass Kuningan → Simpang Kuningan bersebelahan ~300 m).

**3 tab lain BRT-only BERSIH** (sudah benar, JANGAN diubah perilakunya):
- 🌟 Rekomendasi & 📏 Jarak: `13E → Tegal Mampang`, jalan kaki 136 m → `9A` → Cawang (7 halte, Rp7.000).
- 🔀 Alternatif: **jalan akses ~300 m ke Simpang Kuningan → `9A` langsung → Cawang** (0 transfer, 7 halte, Rp3.500). **Ini rute paling waras.**

Cuma **goal `fare`** yang menghasilkan leg U-turn.

---

## 2. Akar masalah

**Kenapa cuma `fare`:** goal `fare` mengejar Rupiah minimal. Transfer peron (`xtype="s"`) = tetap 1 tiket BRT (Rp3.500); jalan kaki keluar sistem (`xtype="w"`) = tap ulang = Rp7.000. Route 9 (yang lurus Simpang Kuningan → Cawang) **tidak berhenti di Underpass Kuningan**. Untuk masuk route 9 **tanpa** jalan kaki (biar tetap Rp3.500), router naik `L13E` dari Underpass — tapi `L13E` trayek **loop fisik** (dicatat sejak v1.1.1: koridor 13/L13E loop), jadi dari Underpass ia muter jauh ke Petukangan lalu balik ke Simpang Kuningan. Goal `simple`/`dist` rela bayar jalan 136 m (Rp7.000) jadi tak terjebak loop.

**Kenapa `sanitizePath` TIDAK menangkap:** `sanitizePath`/`sanitize_path` (v1.12.1) hanya membuang leg dengan **boarding_stop == alighting_stop bernama SAMA** (leg-hantu nol-gerak, geser peron). Di sini boarding (Underpass Kuningan) ≠ alighting (Simpang Kuningan) — nama BEDA. Ini **U-turn asli di tengah leg**, bukan leg-hantu. Butuh guard baru.

---

## 3. Keputusan (disepakati Reza)

Ambil **DUA fix** (opsi "Guard + Tarif boleh seed jalan-akses"):

- **Fix A — Guard no-revisit (WAJIB, akar masalah).** Router tolak lanjut naik (`ride`) kalau leg saat ini akan **melewati halte bernama sama 2×**. Bunuh semua U-turn loop di **semua goal**. Rute loop yang sah (maju lalu turun **sebelum** nama berulang) tetap aman.
- **Fix B — Access seed untuk goal `fare`.** Beri goal `fare` benih jalan-akses (radius `ACCESS_M=400`) seperti `findAlternative`, supaya tab Tarif menemukan **Underpass → jalan ~300 m → Simpang Kuningan → route 9 → Cawang = Rp3.500, 0 transfer** (benar-benar termurah + waras), bukan jatuh ke Rp7.000.

Setelah Fix A saja, tab Tarif akan jatuh ke rute jalan-136 m (Rp7.000) — benar tapi tak konsisten (tab "Tarif terendah" > tab "Alternatif"). Fix B menutup itu.

---

## 4. Fix A — Guard no-revisit (detail)

### 4a. Aturan
Dalam **satu leg** (sejak `take`/`board` terakhir sampai `take` berikutnya), sebuah leg TIDAK boleh menyinggahi dua halte dengan **nama identik** (`stop_name[a] == stop_name[b]`). Saat hendak `ride` ke `nxt`, jika `stop_name[nxt]` sudah muncul di leg berjalan → **skip** (jangan push ke antrian).

### 4b. Implementasi (tanpa nambah field label)
Helper murni, scan `path` mundur dari ekor sampai ketemu langkah `take` atau `board` (batas leg), kumpulkan nama halte yang dikunjungi, cek duplikat:

**JS (`web/router.js`):**
```js
// true kalau menambah nxt ke leg berjalan membuat nama halte berulang (bus muter balik)
function legRevisits(data, path, nxt) {
  const target = data.stops[nxt];
  for (let k = path.length - 1; k >= 0; k--) {
    const p = path[k];
    if (data.stops[p.stop] === target) return true;
    if (p.kind === "take" || p.kind === "board") break; // batas leg
  }
  return false;
}
```
Di `shortestGoal`, dalam blok ride-extend (sekitar baris 425–435), sebelum `heapPush`:
```js
if (nexts) for (const nx of nexts) {
  if (legRevisits(data, cur.path, nx)) continue;   // <-- guard
  const add = ...
  heapPush(heap, { ... });
}
```

**Python (`route.py`), parity:**
```python
def _leg_revisits(stop_name, path, nxt):
    target = stop_name[nxt]
    for kind, stop, *_ in reversed(path):
        if stop_name[stop] == target:
            return True
        if kind in ("take", "board"):
            break
    return False
```
Di `find_goal`, dalam loop `for nxt in sorted(ride[route].get(stop, ())):` sebelum `heappush`:
```python
for nxt in sorted(ride[route].get(stop, ())):
    if _leg_revisits(stop_name, path, nxt):
        continue
    add = ...
    heapq.heappush(pq, (...))
```

### 4c. Berlaku ke SEMUA goal
Guard dipasang di jalur ride-extend `find_goal`/`shortestGoal` — otomatis kena `fare`/`simple`/`dist`. **`findRoute`/`find` (Pareto util lama) & `findAlternative` juga** harus dapat guard yang sama di jalur ride-extend masing-masing (cari pola `ride[route].get(stop)` / `data.edges[route][stop]`). Konsistensi: tak ada tab yang boleh U-turn.

> ponytail: guard = helper murni, nol field baru di label, O(panjang-leg) per ride (leg pendek). Jangan simpan `Set` di label.

---

## 5. Fix B — Access seed untuk goal `fare` (detail)

### 5a. Perilaku
Saat `goal == "fare"`, seed antrian awal BUKAN hanya halte origin persis, tapi juga semua halte dalam radius `ACCESS_M=400 m` dari origin (pakai `accessStops`/`_access_stops` yang sudah ada). Seed jalan-akses:
- **`cost` (Rupiah) = 0** — belum tap bus (jalan kaki di awal gratis).
- **`walkM` = jarak jalan** ke halte seed itu.
- langkah path awal = `board` di halte seed + rekam jalan aksesnya untuk render (lihat 5c).

`walkM` **wajib** ikut dimensi dominasi `_dominates_goal`/`dominated` (sudah: key tuple `(cost, walk_m, tr, st)`), jadi seed jauh yang tak berguna otomatis kalah — **tidak** ada "teleport gratis 400 m".

### 5b. Kenapa aman
- Origin persis tetap seed `walkM=0` → untuk rute normal (origin punya bus bagus), seed origin mendominasi/menyamai, hasil TAK berubah.
- Access seed hanya "menolong" saat origin persis tak punya rute murah waras (kasus Underpass).
- Preseden sudah ada: `findAlternative` memakai `accessStops` dengan pola identik.

### 5c. Render jalan akses
Tab Tarif harus menampilkan langkah "🚶 jalan ~N m ke <halte>" di awal (seperti tab Alternatif). Samakan cara `findAlternative` merender akses (cari `kind: "access"` atau langkah awal setara di legs.js/app.js) supaya konsisten. Kalau `findAlternative` pakai penanda langkah khusus, goal `fare` pakai penanda yang SAMA.

### 5d. Batasan lingkup
- Access seed **HANYA** untuk `fare`. `simple`/`dist` TIDAK diubah (sudah waras dengan jalan 136 m; YAGNI).
- Setelah fix, tab Tarif & Alternatif bisa **identik** di kasus ini (dua-duanya Underpass → jalan → Simpang Kuningan → 9 → Cawang, Rp3.500). Itu JUJUR (memang rute terbaik). Diversifikasi `findAlternative` yang meng-`exclude` signature fare akan otomatis cari kandidat lain untuk tab Alternatif; jika hasilnya kosong, tab Alternatif sembunyi (perilaku eksisting, biarkan).

---

## 6. Hasil yang diharapkan (BRT-only, Underpass Kuningan → Cawang)

| Tab | Sebelum | Sesudah |
|-----|---------|---------|
| 🚩 Tarif | L13E muter Petukangan → 9 (1tf/15st/Rp3.500) | Underpass → jalan ~300 m → Simpang Kuningan → **9** → Cawang (0tf/7st/**Rp3.500**) |
| 🌟 Rekomendasi | 13E → jalan 136 m → 9A (1tf/7st) | **tak berubah** |
| 📏 Jarak | sama Rekomendasi | **tak berubah** |
| 🔀 Alternatif | jalan → 9A langsung (0tf/7st) | tetap waras (kandidat lain kalau signature-nya bentrok fare) |

**Universal:** tidak ada tab/goal manapun yang menghasilkan leg dengan nama halte berulang (U-turn).

---

## 7. Kasus uji (WAJIB, parity Python == JS)

Tambah ke `test-router.js` + `test-route-alt.py` (real-feed, skip kalau GTFS/data.json absen):

1. **Guard U-turn (regresi utama):** BRT-only `Underpass Kuningan → Cawang`, goal `fare` → path TIDAK punya nama halte berulang dalam satu leg. Assert: untuk tiap leg, `len(names) == len(set(names))`.
2. **Fix B tarif waras:** kasus (1) → tab `fare` = 0 transfer, Rp3.500, ada langkah jalan-akses di awal, turun di Cawang.
3. **Loop sah tetap jalan (anti-regresi Fix A):** cari pasangan yang tujuannya DI tengah trayek loop (mis. `Underpass Kuningan → Petukangan D'MASIV` BRT-only) → harus tetap dapat rute (turun sebelum nama berulang), TIDAK dibunuh guard.
6. **Koridor bolak-balik tak rusak (anti-regresi Fix A — PENTING):** 81/256 trayek (35 BRT) punya halte bernama sama di node-set-nya (koridor 2, 4K, 10, 13, 13B, dst — arah pergi/pulang kadang berbagi nama polos). Guard HANYA boleh menyala kalua leg yang **benar-benar dinaiki** berulang nama, BUKAN karena node-set trayek. Uji: sebelum-vs-sesudah, **route ulang banyak pair** (mis. semua contoh regresi lama di test + beberapa lintas koridor 2/4K/10/13) dan **diff hasilnya** — kalau ada pair yang tadinya dapat rute jadi `None`/lebih buruk, itu false-positive guard → LAPOR sebelum lanjut.
4. **Rute normal tak berubah (anti-regresi Fix B):** minimal 3 pair lama yang origin-nya punya bus langsung (mis. `Pancoran Arah Barat → Komplek Polri Ragunan`) → hasil `fare` IDENTIK sebelum-sesudah (byte-path sama).
5. **Parity:** ke-4 pair di atas → `route.py` == `router.js` (transfer, halte, urutan route).

Update assertion versi di `test-router.js` (§8).

---

## 8. Versi, cache, dokumen

- `web/app.js`: `APP_VERSION` **1.13.0 → 1.14.0**, `CACHE_NAME` **jt-v18 → jt-v19**.
- `web/sw.js`: default cache **jt-v18 → jt-v19**.
- `test-router.js`: assert `APP_VERSION = "1.14.0"`, `jt-v19` (app.js + sw.js), + assert network-first tetap ada.
- `CHANGELOG.md`: entri `[1.14.0]` — Fixed: leg U-turn (bus muter loop) di tab Tarif + BRT-only via guard no-revisit; Changed: goal fare dapat access seed 400 m.
- `README.md` Status + `AGENTS.md` penanda versi SHIPPED.
- **Verifikasi live Pages** sesudah push (curl APP_VERSION + cek BRT-only Underpass→Cawang tab Tarif waras). Lihat kebiasaan verify-live.

## 9. Catatan / risiko

- **Asumsi guard (SUDAH DICEK sebagian):** nama halte identik dalam satu trip normal = tanda balik-arah/loop; halte dua-arah biasanya dibedakan suffix ("Arah Timur/Barat"). **TAPI verifikasi data menunjukkan 81/256 trayek (35 BRT) punya nama halte berulang di node-set** (arah pergi/pulang kadang berbagi nama polos, mis. 4K "Cawang×2"). Guard aman KARENA hanya melihat leg yang **benar-benar dinaiki** (path berjalan), bukan node-set trayek — sebuah ride maju satu arah tak menyinggahi nama yang sama dua kali kecuali fisik muter. Namun WAJIB jalankan test §7.6 (diff route-ulang massal) untuk memastikan tak ada false-positive; kalau ada trayek yang edges-nya memodelkan dua arah sebagai satu graf sehingga ride maju sah melewati nama berulang, guard bisa keliru → pertimbangkan perhalus (mis. hanya blok jika nama berulang DAN stop-id berbeda arah yang sama), lapor dulu.
- **Performa:** access seed nambah ~N halte seed (radius 400 m) ke heap awal goal `fare` (`MAX_GOAL_STATES=2jt`). `findAlternative` sudah pakai pola ini tanpa masalah; tapi pantau kalau goal `fare` jadi lambat di HP untuk pair lintas-kota. Kalau berat, batasi seed ke halte yang punya route ber-`allowed` (buang seed tak berguna lebih awal).
- Guard & access seed **tak menyentuh** `build-data.py`/`data.json` — nol perubahan data.
