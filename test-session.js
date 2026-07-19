"use strict";
// Tes session.js — murni Node, tanpa DOM/localStorage. Jalankan: node test-session.js
const assert = require("assert");
const { saveSession, loadSession, clearNav, clearSession, NAV_RESUME_MS, KEY } = require("./web/session.js");

// Store stub in-memory (kontrak: getItem/setItem/removeItem seperti localStorage).
function memStore(initJson) {
  const m = new Map(initJson != null ? [[KEY, initJson]] : []);
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _m: m,
  };
}
// Store yang selalu melempar (localStorage penuh / mode privat ketat).
function boomStore() {
  const boom = () => { throw new Error("storage mati"); };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

const NAMES = new Set(["Simpang Kuningan", "Cawang", "Ragunan"]);
const T0 = 1700000000000; // epoch ms sembarang tapi tetap (tes deterministik)

// 1. roundtrip: save lalu load balik utuh, resumeNav aktif (fix baru saja)
{
  const st = memStore();
  assert.strictEqual(saveSession(st, { from: "Simpang Kuningan", to: "Cawang", tab: "fare", nav: { cur: 4, lastFixAt: T0 } }, T0), true);
  const s = loadSession(st, T0 + 1000, NAMES);
  assert.deepStrictEqual(s, { from: "Simpang Kuningan", to: "Cawang", tab: "fare", resumeNav: true, cur: 4 });
}

// 2. kedaluwarsa 2 jam: tepat di bawah ambang = resume; tepat di ambang = tidak
{
  const mk = () => { const st = memStore(); saveSession(st, { from: "Simpang Kuningan", to: "Cawang", tab: "simple", nav: { cur: 2, lastFixAt: T0 } }, T0); return st; };
  const just = loadSession(mk(), T0 + NAV_RESUME_MS - 1, NAMES);
  assert.strictEqual(just.resumeNav, true);
  const late = loadSession(mk(), T0 + NAV_RESUME_MS, NAMES);
  assert.strictEqual(late.resumeNav, false);
  assert.strictEqual(late.cur, -1);              // cur hanya berlaku saat resume
  assert.strictEqual(late.from, "Simpang Kuningan"); // rute tetap di-restore (D4)
}

// 3. nav null (tidak sedang navigasi) → rute balik, resumeNav false
{
  const st = memStore();
  saveSession(st, { from: "Cawang", to: "Ragunan", tab: "dist", nav: null }, T0);
  const s = loadSession(st, T0, NAMES);
  assert.deepStrictEqual(s, { from: "Cawang", to: "Ragunan", tab: "dist", resumeNav: false, cur: -1 });
}

// 4. JSON korup → null + key dibuang
{
  const st = memStore("{korup!!");
  assert.strictEqual(loadSession(st, T0, NAMES), null);
  assert.strictEqual(st._m.has(KEY), false);
}

// 5. skema versi beda → null
{
  const st = memStore(JSON.stringify({ v: 2, from: "Cawang", to: "Ragunan", tab: "fare", nav: null, savedAt: T0 }));
  assert.strictEqual(loadSession(st, T0, NAMES), null);
}

// 6. halte hilang dari data (refresh GTFS mingguan) → null
{
  const st = memStore();
  saveSession(st, { from: "Halte Sudah Almarhum", to: "Cawang", tab: "fare", nav: null }, T0);
  assert.strictEqual(loadSession(st, T0, NAMES), null);
}

// 7. kosong (belum pernah ada sesi) → null tanpa crash
assert.strictEqual(loadSession(memStore(), T0, NAMES), null);

// 8. store melempar → semua fungsi no-op tanpa crash
{
  assert.strictEqual(saveSession(boomStore(), { from: "Cawang", to: "Ragunan", tab: "fare", nav: null }, T0), false);
  assert.strictEqual(loadSession(boomStore(), T0, NAMES), null);
  clearNav(boomStore());      // tidak boleh melempar
  clearSession(boomStore());  // tidak boleh melempar
}

// 9. clearNav: buang bagian nav saja, rute tetap (D5)
{
  const st = memStore();
  saveSession(st, { from: "Simpang Kuningan", to: "Cawang", tab: "alternative", nav: { cur: 3, lastFixAt: T0 } }, T0);
  clearNav(st);
  const s = loadSession(st, T0, NAMES);
  assert.deepStrictEqual(s, { from: "Simpang Kuningan", to: "Cawang", tab: "alternative", resumeNav: false, cur: -1 });
}

// 10. cur tak valid (bukan integer ≥ 0) → -1 walau resume
{
  const st = memStore();
  saveSession(st, { from: "Cawang", to: "Ragunan", tab: "fare", nav: { cur: "x", lastFixAt: T0 } }, T0);
  const s = loadSession(st, T0 + 1, NAMES);
  assert.strictEqual(s.resumeNav, true);
  assert.strictEqual(s.cur, -1);
}

// 11. clearSession: sesi hilang total
{
  const st = memStore();
  saveSession(st, { from: "Cawang", to: "Ragunan", tab: "fare", nav: null }, T0);
  clearSession(st);
  assert.strictEqual(loadSession(st, T0, NAMES), null);
}

console.log("test-session: semua tes lulus");
