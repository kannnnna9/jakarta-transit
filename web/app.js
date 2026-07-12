"use strict";
// DOM/render. Router murni ada di Router (router.js). File ini TIDAK berisi logika rute.
(function () {
const APP_VERSION = "1.12.1";
const CACHE_NAME = "jt-v15";
  const { buildIndex, findGoalRoutes } = window.Router;
  const { suggest } = window.Suggest;
  const { pathToLegs } = window.Legs;
  const { snap } = window.LiveNav;
  const { routeCost, fmtFare } = window.Cost;
  const $ = (id) => document.getElementById(id);
  let data = null, index = null, validNames = null, serviceStops = null;
  let here = null; // {lat,lon} once user shares location
  const RADIUS_M = 50; // ambang "sampai halte" — knob dunia nyata (GPS HP ~10-30 m)
  let nav = { watchId: null, cur: -1, stops: [] }; // stops: [{idx, el}] urut jalur

  $("app-version").textContent = "v" + APP_VERSION;

  function activeRtypes() {
    return new Set(Array.from(document.querySelectorAll("#service-filter input:checked")).map((el) => el.value));
  }

  function rebuildServiceStops() {
    const allowed = activeRtypes();
    serviceStops = new Set();
    for (const ri in data.edges) {
      if (!allowed.has((data.rtype && data.rtype[ri]) || "")) continue;
      for (const si in data.edges[ri]) {
        serviceStops.add(Number(si));
        for (const nx of data.edges[ri][si]) serviceStops.add(nx);
      }
    }
  }

  function filterLabel() {
    const all = new Set(data.rtype.filter(Boolean));
    const on = activeRtypes();
    return on.size === all.size ? "" : "Filter: " + Array.from(on).join(", ");
  }

  function buildFilters() {
    const wrap = $("service-filter");
    wrap.innerHTML = "";
    const saved = JSON.parse(localStorage.getItem("jt-service-filter") || "null");
    const types = Array.from(new Set(data.rtype.filter(Boolean))).sort();
    for (const rt of types) {
      const lab = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.value = rt; cb.checked = !saved || saved.includes(rt);
      cb.onchange = () => {
        const checked = Array.from(wrap.querySelectorAll("input:checked")).map((el) => el.value);
        if (!checked.length) { cb.checked = true; return; }
        localStorage.setItem("jt-service-filter", JSON.stringify(checked));
        rebuildServiceStops();
        fillDatalist();
      };
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(rt));
      wrap.appendChild(lab);
    }
    rebuildServiceStops();
  }

  // Rebuild the datalist: deduped names, alphabetical or (with `here`) nearest-first.
  function fillDatalist() {
    const dl = $("haltes"); dl.innerHTML = "";
    const coords = { lat: data.lat, lon: data.lon };
    const frag = document.createDocumentFragment();
    for (const it of suggest(data.stops, coords, "", 9999, here)) {
      const ids = index.nameStops.get(it.name) || [];
      if (serviceStops && !ids.some((id) => serviceStops.has(id))) continue;
      const o = document.createElement("option");
      o.value = it.name;
      frag.appendChild(o);
    }
    dl.appendChild(frag);
  }

  fetch("data.json")
    .then((r) => r.json())
    .then((d) => {
      data = d;
      index = buildIndex(d);
      validNames = new Set(d.stops);
      buildFilters();
      fillDatalist();
    })
    .catch(() => { $("err").textContent = "Gagal memuat data halte."; });

  $("geo").addEventListener("click", () => {
    if (!data) { $("geostat").textContent = "Data belum siap, tunggu sebentar."; return; }
    if (!navigator.geolocation) { $("geostat").textContent = "GPS tak didukung peramban ini."; return; }
    $("geostat").textContent = "Mencari lokasi…";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        fillDatalist();
        $("geostat").textContent = "Saran halte diurut dari lokasi Anda (terdekat di atas).";
      },
      (err) => {
        $("geostat").textContent = err.code === 1
          ? "Izin lokasi ditolak — aktifkan untuk mengurutkan halte terdekat."
          : "Gagal ambil lokasi (sinyal GPS lemah?). Coba lagi.";
      },
      { timeout: 10000, maximumAge: 60000 }
    );
  });

   const nm = (i) => data.stops[i];
   const li = (cls, text) => {
     const e = document.createElement("li");
     if (cls) e.className = cls;
     e.textContent = text;
     return e;
   };

   // Render route selector tabs untuk tujuan v1.8
   let routeOptions = null;
   let lastGoals = null;
   let selectedRouteIdx = 0;
   
    function routeSelector(ops, selected) {
      const wrap = li("route-selector", "");
      if (ops.length <= 1) return wrap;
      const tabs = document.createElement("div");
      tabs.className = "route-tabs";
      ops.forEach((op, i) => {
        const tab = document.createElement("button");
        tab.textContent = op.label;
        if (i === selected) tab.className = "active";
        tab.onclick = () => switchRoute(i);
        tabs.appendChild(tab);
      });
      wrap.appendChild(tabs);
      return wrap;
    }

   function switchRoute(i) {
     selectedRouteIdx = i;
     nav.stops = [];
     const ol = $("result");
     ol.innerHTML = "";
     const selector = routeSelector(routeOptions, i);
     ol.appendChild(selector);
     renderRoute(routeOptions[i].route, ol);
     setSummary(routeOptions[i].route);
     updateFareWarning(routeOptions[i].route);
   }

   function updateFareWarning(selectedRoute) {
     const warn = (lastGoals && selectedRoute === lastGoals.dist)
       ? fareWarning(lastGoals.dist, lastGoals.simple)
       : null;
     $("fare-warn").textContent = warn || "";
   }

  function routeWalkMeters(path) {
    return path.reduce((n, step) => n + ((step.kind === "access" || step.kind === "take") && step.xtype === "w" ? (step.xdist || 0) : 0), 0);
  }

  function summaryText(res) {
    const c = routeCost(res.path, data);
    return `~${Math.round(c.secs / 60)} mnt · ${fmtFare(c.fare)} · ${res.transfers} transfer · 🚶${routeWalkMeters(res.path)}m`;
  }

  function setSummary(res) {
    $("summary").textContent = summaryText(res);
    const flt = filterLabel();
    if (flt) $("summary").textContent += " · " + flt;
  }

   function goalOptions(goals) {
     const ops = [
       { label: "💰 Tarif terendah", route: goals.fare },
       { label: "🌟 Rekomendasi", route: goals.simple },
       { label: "📏 Jarak terpendek", route: goals.dist },
     ].filter((op) => op.route);
     if (goals.alternative) ops.push({ label: "🔀 Alternatif", route: goals.alternative });
     return ops;
   }

   const PREMIUM = new Set(["PP", "PP2", "PP3"]);

   function fareWarning(distRoute, rekomRoute) {
     if (!distRoute || !rekomRoute || !data) return null;
     const distFare = routeCost(distRoute.path, data).fare;
     const rekomFare = routeCost(rekomRoute.path, data).fare;
     if (distFare <= rekomFare) return null;
     const hasPremium = distRoute.path.some((step) =>
       step.kind === "take" && PREMIUM.has((data.fare[step.route] || [0, "?"])[1]));
     const selisih = fmtFare(distFare - rekomFare);
     return hasPremium
       ? "🅿️ Pakai bus Premium — tarif tiap naik (" + selisih + " lebih mahal dari Rekomendasi)"
       : "🚶 Transfer keluar halte — bayar tiket 2× (" + selisih + " lebih mahal dari Rekomendasi)";
   }

  function renderRoute(res, ol) {
     const legs = pathToLegs(res.path);
     if (!legs.length) {
       const start = res.path[0].stop, end = res.path[res.path.length - 1].stop;
       ol.appendChild(stopLi("start", "🚩 ", start));
       const x = res.path.find((p) => p.kind === "xfer");
       if (x) ol.appendChild(li("xfer", "── " + (x.xtype === "w" ? "🚶 Jalan kaki ~" + (x.xdist || 0) + " m" : "🔗 Pindah") + " ke " + nm(end) + " ──"));
       ol.appendChild(stopLi("end", "🏁 Sampai: ", end));
       return;
     }
     const track = (idx, el) => {
       const last = nav.stops[nav.stops.length - 1];
       if (!last || last.idx !== idx) nav.stops.push({ idx, el });
       return el;
     };
     const start = res.path[0].stop;
     const access = res.path.find((p) => p.kind === "access");
     ol.appendChild(track(start, stopLi("start", "🚩 ", start)));
     if (access) ol.appendChild(li("xfer", "── 🚶 jalan " + (access.xdist || 0) + "m → " + nm(access.stop) + " ──"));
     legs.forEach((leg, j) => {
       if (j > 0) ol.appendChild(transferBlock(legs[j - 1], leg));
       ol.appendChild(legHeader(leg));
       ol.appendChild(track(leg.board, stopLi("stop", "Naik: ", leg.board)));
       if (leg.mid.length) {
         const { wrap, els } = midDetails(leg.mid);
         leg.mid.forEach((s, k) => track(s, els[k]));
         ol.appendChild(wrap);
       }
       ol.appendChild(track(leg.alight, stopLi("stop", "Turun: ", leg.alight)));
     });
     const endEl = stopLi("end", "🏁 Sampai: ", legs[legs.length - 1].alight);
     ol.appendChild(endEl);
     nav.stops[nav.stops.length - 1].el = endEl;
     if (navigator.geolocation) $("nav").hidden = false;
  }

  // Baris halte dgn badge nomor BRT (peta integrasi) sebelum nama, contoh "1-20 Kota".
  function stopLi(cls, prefix, idx) {
    const e = li(cls, prefix);
    for (const n of (data.snum && data.snum[idx]) || []) {
      const b = document.createElement("span");
      b.className = "badge snum";
      b.textContent = n;
      e.appendChild(b);
      e.appendChild(document.createTextNode(" "));
    }
    e.appendChild(document.createTextNode(nm(idx)));
    return e;
  }

  // Blok transfer antar-leg. Ikon beda per jenis biar tak rancu:
  // 🚶 jalan kaki (w) · 🔗 halte terhubung/transfer resmi (o) · ↔️ pindah peron (s).
  // tipe "w" tampilkan jarak; "s" → pindah peron; sisanya → "lanjut" (non-BRT).
  function transferBlock(prev, leg) {
    const to = nm(leg.board);
    let text;
    if (leg.xtype === "w")
      text = "🚶 Jalan kaki " + (leg.xdist ? "~" + leg.xdist + " m " : "") + "ke " + to;
    else if (leg.xtype === "o")
      text = "🔗 Pindah di halte terhubung " + to;
    else if (leg.xtype === "s")
      text = "↔️ Pindah peron di " + to;
    else
      text = "↔️ Lanjut naik " + to;
    return li("xfer", "── " + text + " ──");
  }

  // Header satu leg: 🚌 nama route + badge kelas layanan (BRT ditonjolkan).
  function legHeader(leg) {
    const head = li("hop", "🚌 " + data.routes[leg.route]);
    const rt = data.rtype && data.rtype[leg.route];
    if (rt) {
      const b = document.createElement("span");
      b.className = "badge" + (/^BRT$/i.test(rt) ? " brt" : "");
      b.textContent = rt;
      head.appendChild(document.createTextNode(" "));
      head.appendChild(b);
    }
    return head;
  }

  // Halte yang cuma dilewati: default ringkas, buka via native <details>.
  // Return els (li per halte, urut mid) buat tracking navigasi live.
  function midDetails(mid) {
    const wrap = li("stop", "");
    const det = document.createElement("details");
    const sum = document.createElement("summary");
    sum.textContent = mid.length + " halte dilewati";
    det.appendChild(sum);
    const inner = document.createElement("ol");
    inner.className = "mid";
    const els = mid.map((s) => inner.appendChild(stopLi("stop", "", s)));
    det.appendChild(inner);
    wrap.appendChild(det);
    return { wrap, els };
  }

   function render(res) {
     stopNav();
     nav.stops = []; $("nav").hidden = true;
     const ol = $("result"); ol.innerHTML = "";
     if (!res) { $("summary").textContent = "Rute tidak ditemukan."; return; }
     
     routeOptions = goalOptions(res);
     lastGoals = res;
     selectedRouteIdx = 0;

     if (!routeOptions.length) { $("summary").textContent = "Rute tidak ditemukan."; return; }
     if (routeOptions.length > 1) ol.appendChild(routeSelector(routeOptions, selectedRouteIdx));
     const selected = routeOptions[selectedRouteIdx].route;
     setSummary(selected);
     renderRoute(selected, ol);
     updateFareWarning(selected);
   }

  // --- Navigasi live: watchPosition -> snap maju-only -> highlight halte aktif ---
  function stopNav() {
    if (nav.watchId != null) navigator.geolocation.clearWatch(nav.watchId);
    nav.watchId = null; nav.cur = -1;
    $("nav").textContent = "🧭 Mulai navigasi";
    $("navstat").textContent = "";
  }

  function onFix(pos) {
    const points = nav.stops.map(({ idx }) => ({ lat: data.lat[idx], lon: data.lon[idx] }));
    const j = snap(points, { lat: pos.coords.latitude, lon: pos.coords.longitude }, nav.cur, RADIUS_M);
    if (j === nav.cur) {
      if (nav.cur < 0) $("navstat").textContent = "Menunggu GPS dekat halte pertama…";
      return;
    }
    if (nav.cur >= 0) nav.stops[nav.cur].el.classList.remove("here");
    nav.cur = j;
    const { idx, el } = nav.stops[j];
    el.classList.add("here");
    const det = el.closest("details");
    if (det) det.open = true;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    if (j === nav.stops.length - 1) {
      stopNav();
      el.classList.add("here"); // stopNav reset cur; highlight tujuan dipertahankan
      $("navstat").textContent = "🏁 Sampai di " + nm(idx) + " — navigasi selesai.";
    } else {
      $("navstat").textContent = `Posisi: ${nm(idx)} (${j + 1}/${nav.stops.length})`;
    }
  }

  $("nav").addEventListener("click", () => {
    if (nav.watchId != null) { stopNav(); return; }
    $("nav").textContent = "⏹ Berhenti navigasi";
    $("navstat").textContent = "Mencari sinyal GPS…";
    nav.watchId = navigator.geolocation.watchPosition(onFix, (err) => {
      stopNav();
      $("navstat").textContent = err.code === 1
        ? "Izin lokasi ditolak — aktifkan untuk navigasi live."
        : "Gagal ambil lokasi (sinyal GPS lemah?).";
    }, { enableHighAccuracy: true, maximumAge: 5000 });
  });

  $("go").addEventListener("click", () => {
    $("err").textContent = ""; $("summary").textContent = ""; $("result").innerHTML = "";
    const from = $("from").value.trim(), to = $("to").value.trim();
    if (!validNames) { $("err").textContent = "Data belum siap, tunggu sebentar."; return; }
    if (!validNames.has(from)) { $("err").textContent = "Halte asal tidak ditemukan — pilih dari daftar."; return; }
    if (!validNames.has(to)) { $("err").textContent = "Halte tujuan tidak ditemukan — pilih dari daftar."; return; }
    if (!Array.from(index.nameStops.get(from) || []).some((id) => serviceStops.has(id))) {
      $("err").textContent = `Halte asal "${from}" tidak dilayani filter aktif — coba longgarkan filter.`; return;
    }
    if (!Array.from(index.nameStops.get(to) || []).some((id) => serviceStops.has(id))) {
      $("err").textContent = `Halte tujuan "${to}" tidak dilayani filter aktif — coba longgarkan filter.`; return;
    }
    if (from === to) { $("err").textContent = "Asal dan tujuan sama."; return; }
    try {
      const res = findGoalRoutes(data, from, to, index, activeRtypes());
      if (!res.fare && !res.simple && !res.dist) {
        $("summary").textContent = "Tidak ada rute dengan filter aktif — coba longgarkan filter.";
        return;
      }
      render(res);
    } catch (e) { $("err").textContent = e.message; }
  });

  // daftar service worker (offline)
  if ("serviceWorker" in navigator)
    navigator.serviceWorker.register("sw.js?cache=" + encodeURIComponent(CACHE_NAME)).catch(() => {});
})();
