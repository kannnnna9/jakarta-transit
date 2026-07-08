# Jakarta Transit v1.6 Plan

> **For agentic workers:** REQUIRED SUB-KILL: Use superpowers:writing-plans atau subagent-driven-development untuk implementasi task-by-task. Steps pakai checkbox (`- [ ]`).

> **Prasyarat:** v1.5.1 SHIPPED + LIVE (multi-rute Pareto fix, tab deskriptif).

**Goal:** Refinement router model + UX improvement (TRANSFER 3-JENIS, TUNING KNOBS).

**Why v1.6 not urgently needed:** v1.5 sudah usable (Pareto routing live). v1.6 fokus implementasi transfer 3-jenis + tuning knob dengan manual derivation (belum ada data real usage).

**Why now:** Transfer 3-jenis spec sudah ada di v1.1. Tuning knob bisa dilakukan dengan manual inspection, tidak butuh user data.

---

## v1.6A — Implementasi Transfer 3-Jenis (DATA+UI)

### Tujuan
Melaksanakan transfer 3-jenis dari v1.1 spec:
1. **same_station**: "Pindah peron X→Y (stasiun sama)"
2. **walk / JPO**: "Jalan kaki ~N m (JPO)"
3. **to_non_brt**: "Lanjut naik {Mikrotrans/Royaltrans/…}"

### Status saat ini
- Data JSON sudah punya `route_type` (8 kelas layanan v1.3.0).
- Transfer model: bedah trip movement + proximity haversine + fallback nama sama.
- **Tidak ada metadata tipe transfer** (walk/same_station/non_brt).

### Arah Solusi
1. **Tambah field di build-data.py**: tambahkan `transfers` object berisi `type` dan `distance` untuk tiap transfer edge.
2. **Determining tipe**: inspection manual + heuristics (Condition knowledge about Transjakarta routes).
3. **Update UI** di `web/app.js`: transfer block menampilkan ikon tipe.
4. **Update router**: mendapatkan transfer type & distance dari edge.

### Data Changes di build-data.py
```json
{
  "transfers": {
    "stopIdx": {
      "nextStopIdx": {
        "routeIdx": {
          "type": "same_station",  // atau "walk", "to_non_brt"
          "distance": 150  // m (dari haversine)
        }
      }
    }
  }
}
```

### UI Changes di web/app.js
```javascript
function transferBlock(prev, leg) {
  const to = nm(leg.board);
  let text;
  if (leg.xtype === "w") text = "🚶 Jalan kaki ~" + leg.distance + " m ke " + to;
  else if (leg.xtype === "o") text = "🔗 Pindah peron di " + to;
  else text = "↔️ Pindah ke " + to + " (" + data.rtype[leg.route] + ")";
  return li("xfer", "── " + text + " ───");
}
```

### Implementation Steps
- [ ] Update `build-data.py` untuk extract + categorize transfer edges (same_station/walk/to_non_brt).
- [ ] Add test ke `test_build.py` untuk validasi transfers object sudah ada.
- [ ] Rerun `build-data.py` → regenerate `web/data.json`.
- [ ] Update `web/router.js` untuk mendapatkan transfer info dari edge.
- [ ] Update `web/app.js` transferBlock untuk menampilkan tipe.
- [ ] Jalankan test: `node test-router.js` → PASS.

---

## v1.6B — Tuning Knobs dengan Manual Derivation

> Tuning parameters dengan manual derivation (tidak butuh user data karena belum ada).

### Tujuan
Tuning 3 knob supaya cocok dengan bullet nyata di Jakarta.

### Tuning Daftar

| Knob | Saat ini | Kalibrasi awal | Metode |
|------|----------|----------------|--------|
| **WEIGHT** | 8 | 6–12 (experiment) | Coba beberapa nilai, substituting di `route.py` + `web/router.js`, tes rute sample manual, pilih mana yang "rasa oke" |
| **Proximity transfer** | 150m | 100–200m | GPS HP JDK (10–30m). Halte BRT padat → coba 100m lebih ketat |
| **Radius live nav** | 50m | 40–70m | Snap ke halte untuk user di posisi actual (testing manual) |

### Implementation

#### WEIGHT (experiment)
Value optimal akan diuji dengan beberapa rute sample:
- Test route 1: 0-transfer muter lewat banyak halte (L13E-L07 looping) → harus tetap diolahan dengan benar
- Test route 2: 1-transfer pendek → harus dianggap lebih efisien jika transfer hemat >WEIGHT halte

**Kalibrasi flow:**
1. Coba WEIGHT X = 4 (transfer-happy)
2. Coba WEIGHT X = 8 (default, referensi v1.1.1)
3. Coba WEIGHT X = 12 (halte-happy)
4. Pilih yang paling cocok mental model user Transjakarta.

#### Proximity transfer
Jarak antar-halte BRT padat ±50–100m. Kalibrasi 100–200m agar:
- Terlalu sempit → salah prediksi transfer ke halte berdekatan
- Terlalu lebar → mispredict halte yang sebenarnya sama

**Percobaan manual:** test both 150m & 100m di 5 sample query, pilih mana hasil lebih natural.

#### Radius live nav
GPS akurasi HP ±10–30m di jalanan JKT. 50m cukup untuk snap ke halte "terdekat" (Dijkstra distance, bukan Euclidean).

**Kalibrasi:** test 40m vs 60m vs 50m, pilih yang memberikan terasa paling akurat untuk kondisi GPS noisy.

---

## v1.6C — Grafik Preferensi User (PENDING)

> Opsional feature, wait untuk user data >50 query untuk menaksir preferences secara data-driven.

### Rencana (jika needed)
Jika kelak user data kumpul, visualisasi scatter plot:
- X = transfer count
- Y = halte count
- Sample user data + emoji 👍/👎 untuk visual preference

---

## Prioritas v1.6

**v1.6 ini bukan fitur baru, tapi refinemen.**

| Task | Priority | Fokus |
|------|----------|-------|
| **v1.6A** | PRIORITY 0 | Implementasi **Transfer 3-jenis** (data change + UI) |
| **v1.6B PART 1** | PRIORITY 1 | Kalibrasi WEIGHT (manual) via 3 teruh alat sample |
| **v1.6B PART 2** | PRIORITY 2 | Tuning Proximity + Radius (manual calibrasi) |
| **v1.6C** | PRIORITY 3 | Grafik preferensi user (opsional, wait data) |

Hal ini bisa dieksekusikan secara sequential:
1. v1.6A → implementasi transfer 3-jenis
2. Setelah data.json regen → v1.6B tuning knobs (2 sisi 150m/ppu)
3. Commit → push → tag v1.6.0

---

## Shipping Process

### Step 1: Data Changes (build-data.py)
- [ ] Tambah field `transfers` object (stopIdx → nextStopIdx → routeIdx → {type, distance})
- [ ] Categorize tiap transfer edge (same_station/walk/to_non_brt) secara manual inspection + knowledge
- [ ] Add test ke `test_build.py` untuk validasi transfers object ada
- [ ] langsung run `python3 build-data.py` → regenerate `web/data.json`

### Step 2: Router Changes (route.py + web/router.js)
- [ ] Update `route.py` untuk mendapatkan transfer type & distance dari edge
- [ ] Update `web/router.js` sebagaimananya routing untuk tersingkat
- [ ] Kalibrasi WEIGHT jika diperlukan (experiment part of v1.6B)
- [ ] RUN ALL TESTS: `node test-router.js` harus PASS

### Step 3: UI Changes (web/app.js + index.html)
- [ ] Update `transferBlock()` untuk menampilkan tipe (IKON + teks)
- [ ] Bump SW cache: `jt-v7` → `jt-v8` saat app-shell berubah
- [ ] Tambah tooltips/keterangan transfer type jika perlu

### Step 4: Documentation
- [ ] Update `CHANGELOG.md` — v1.6 (Added/Changed/Fixed entries)
- [ ] Update `README.md` — v1.6 status/summary
- [ ] Update `AGENTS.md` — v1.6 shipped, status block
- [ ] Update `docs/ROADMAP.md` — v1.6 entry (Added/Changed/Fixed)
- [ ] Commit + push + tag (`v1.6.0`)

### Step 5: Verification Live
- [ ] Verifikasi `web/data.json` refresh (commit kedatangan)
- [ ] Verifikasi Pages auto-deploy via GitHub Actions
- [ ] Coba minimal 10 sample queries untuk sampling WEIGHT/knob feedback (klik kiri/kanan Pareto tabs)

---

## Reference Files

- **Spec acuan**: `docs/superpowers/specs/2026-07-05-jakarta-transit-navigator-design.md` (Bagian 5: Transfer model + keterangan).
- **MVP Plan**: `docs/superpowers/plans/2026-07-05-jakarta-transit-navigator.md`.
- **Roadmap**: `docs/ROADMAP.md` (line 98: Tuning knobs).

---

## Notes

- v1.6 adalah refinemen, bukan feature invention. Fokus transfer 3-jenis + manual tuning knobs.
- PATH TIDAK IMPORTANT: semua script self-locate, seperti v1.5.1.
- Data auto-refresh mingguan Tetap analog setelah build-data.py.

## Apropos "Waktu Misal" Rencana (Routing manual)

Untuk manual inspection rute sample: gunakan path route yang maling works:
- Simpang Kuningan → CSW 1 loop dan loop纪实 (contoh rute 0-transfer long di v1.1)
- Blok M → Cikoko (contoh rute 1-transfer pendek)
- Pancoran → Ragunan (contoh real match di v1.5)

Gunakan kondisi ini tehal tunggu kita uji Kalibrasi WEIGHT.
