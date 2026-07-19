"use strict";
// Sesi lengket (v1.15): simpan INPUT rute + progres nav, murni tanpa DOM.
// Storage di-inject (kontrak getItem/setItem/removeItem) biar bisa dites di Node.
// Dipakai browser (window.Session) & Node (tes). Spec: docs/superpowers/specs/2026-07-18-*.md
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Session = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const KEY = "jt-session";
  const NAV_RESUME_MS = 2 * 60 * 60 * 1000; // auto-lanjut GPS hanya < 2 jam sejak fix terakhir (D3)

  // sess: {from, to, tab, nav} — nav: {cur, lastFixAt} atau null. now: epoch ms.
  function saveSession(store, sess, now) {
    try {
      store.setItem(KEY, JSON.stringify({
        v: 1, from: sess.from, to: sess.to, tab: sess.tab, nav: sess.nav || null, savedAt: now,
      }));
      return true;
    } catch (e) { return false; }
  }

  // Return {from, to, tab, resumeNav, cur} atau null (tak ada/korup/halte hilang).
  // Sesi tak valid ikut dibuang dari store (best-effort).
  function loadSession(store, now, validNames) {
    let s = null;
    try { s = JSON.parse(store.getItem(KEY)); } catch (e) { s = null; }
    if (!s || s.v !== 1 || typeof s.from !== "string" || typeof s.to !== "string" ||
        !validNames.has(s.from) || !validNames.has(s.to)) {
      try { store.removeItem(KEY); } catch (e) {}
      return null;
    }
    const nav = s.nav;
    const resumeNav = !!nav && typeof nav.lastFixAt === "number" && now - nav.lastFixAt < NAV_RESUME_MS;
    const cur = resumeNav && Number.isInteger(nav.cur) && nav.cur >= 0 ? nav.cur : -1;
    return { from: s.from, to: s.to, tab: typeof s.tab === "string" ? s.tab : "", resumeNav, cur };
  }

  // Buang bagian nav saja; rute tersimpan tetap (D5: stop/sampai ≠ lupa rute).
  function clearNav(store) {
    let s = null;
    try { s = JSON.parse(store.getItem(KEY)); } catch (e) { return; }
    if (!s || s.v !== 1) return;
    s.nav = null;
    try { store.setItem(KEY, JSON.stringify(s)); } catch (e) {}
  }

  function clearSession(store) {
    try { store.removeItem(KEY); } catch (e) {}
  }

  return { saveSession, loadSession, clearNav, clearSession, NAV_RESUME_MS, KEY };
});
