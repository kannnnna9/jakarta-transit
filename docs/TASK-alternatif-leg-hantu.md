# TASK: Fix leg-hantu di tab Alternatif (Jakarta Transit)

## Bug report (repro persis)

Origin `9-11 Simpang Kuningan` → Destination `13-4 CSW 1`, buka tab **Alternatif (🎲)**. Muncul leg:

```
🚌 13 (Ciledug - Tegal Mampang) BRT
   Naik:  13-1 Tegal Mampang
   Turun: 13-1 Tegal Mampang   ← naik == turun, halte SAMA
```

Leg ini nol-gerak (naik dan turun di stop id yang sama), lalu diikuti "↔️ Pindah peron di Tegal Mampang" yang juga palsu, baru naik L13E dari halte yang sama.

Output penuh yang salah:

```
🚩 9-11 Simpang Kuningan
🚌 9 (Pinang Ranti - Pluit) BRT
   Naik:  9-11 Simpang Kuningan
   Turun: 9-10 Tegal Parang Arah Timur
── 🚶 Jalan kaki ~134 m ke Tegal Mampang ──
🚌 13 (Ciledug - Tegal Mampang) BRT
   Naik:  13-1 Tegal Mampang
   Turun: 13-1 Tegal Mampang        ← LEG SAMPAH
── ↔️ Pindah peron di Tegal Mampang ──   ← PINDAH PERON PALSU
🚌 L13E (Puri Beta - Flyover Kuningan (Express)) BRT
   Naik:  13-1 Tegal Mampang
   Turun: 13-4 CSW 1
🏁 Sampai: 13-4 CSW 1
```

Rute benar: koridor 9 → jalan kaki ke Tegal Mampang → langsung L13E ke CSW 1. Leg koridor 13 harusnya TIDAK ADA.

## Hipotesis root cause (verifikasi dulu, jangan langsung asumsi benar)

Tab Alternatif dikonfigurasi harus BEDA dari rute pemenang 3 tab lain (💰🧘📏). Diduga logika "pemaksa beda" (mis. penalti koridor yang sudah dipakai pemenang, atau wajib min. 1 koridor berbeda) menyuntik leg koridor tambahan walau `boarding_stop == alighting_stop` — cuma biar hasilnya distinct. Trace apakah benar begitu.

## Langkah kerja (urut)

1. **Reproduce & trace** pair di atas. Cari di mana leg dengan naik==turun terbentuk, dan konfirmasi apakah pemicunya logika diversifikasi tab Alternatif.
2. **Fix root cause**, bukan cuma gejala:
   - Diversifikasi tab Alternatif harus beda di level **jalur yang benar-benar memindahkan penumpang** (koridor/segmen yang menggeser stop), BUKAN dengan menambah hop kosong.
   - Kalau tidak ada rute alternatif yang genuinely berbeda, jangan mengarang — fallback: tampilkan rute distinct terbaik berikutnya, atau pesan "tidak ada alternatif berarti". Jangan pernah memfabrikasi leg.
3. **Guard + sanitasi** (jaring pengaman umum): buang/collapse leg mana pun dengan `boarding_stop_id == alighting_stop_id` sebelum render, dan hilangkan "pindah peron" yang jadi yatim setelahnya. Terapkan ke SEMUA tab, bukan cuma Alternatif.
4. **Cek regresi silang**: pastikan fix tak bikin tab lain (💰🧘📏 / Rekomendasi) jadi salah. Konfirmasi leg-hantu ini memang eksklusif tab Alternatif atau muncul juga di tab lain — laporkan.
5. **Test**: tambah regression test parity py==js untuk pair `9-11 → 13-4`, plus assert invarian global "tidak boleh ada leg dengan naik==turun" di semua rute yang dihasilkan.
6. **Versioning**: sinkron CHANGELOG + naikkan APP_VERSION (SemVer, ini fix → patch). Kalau v1.12 belum LIVE di Pages, lipat ke versi yang sama; kalau sudah live, patch baru.
7. **Verify live**: setelah push, konfirmasi perbaikan tampil di GitHub Pages (rilis dihitung dari yang sudah live).

## Acceptance

- Pair `9-11 Simpang Kuningan → 13-4 CSW 1` di tab Alternatif: rute = koridor 9 → jalan kaki Tegal Mampang → L13E → CSW 1, tanpa leg koridor 13 dan tanpa pindah peron palsu.
- Tidak ada leg naik==turun di seluruh output (dijamin test).
- Tab lain tidak berubah/regresi.

## Catatan pemakaian skill

Izinkan opencode memakai skill/agent secara eksplisit jika perlu (debugging, tdd, review). Beri prompt jelas.
