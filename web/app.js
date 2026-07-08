"use strict";
// DOM/render. Router murni ada di Router (router.js). File ini TIDAK berisi logika rute.
(function () {
  const { buildIndex, findRoute } = window.Router;
  const { suggest } = window.Suggest;
  const { pathToLegs } = window.Legs;
  const { snap } = window.LiveNav;
  const $ = (id) => document.getElementById(id);
  let data = null, index = null, validNames = null;
  let here = null; // {lat,lon} once user shares location
  const RADIUS_M = 50; // ambang "sampai halte" — knob dunia nyata (GPS HP ~10-30 m)
  let nav = { watchId: null, cur: -1, stops: [] }; // stops: [{idx, el}] urut jalur

  // Rebuild the datalist: deduped names, alphabetical or (with `here`) nearest-first.
  function fillDatalist() {
    const dl = $("haltes"); dl.innerHTML = "";
    const coords = { lat: data.lat, lon: data.lon };
    const frag = document.createDocumentFragment();
    for (const it of suggest(data.stops, coords, "", 9999, here)) {
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

   // Render route selector tabs untuk multi-rute Pareto
   let routeOptions = null; // Store all Pareto routes
   let selectedRouteIdx = 0;
   
   function routeLabel(r, i, total) {
      if (total <= 2) return i === 0 ? "Minim transfer" : "Minim halte";
      if (i === 0) return "Minim transfer";
      if (i === total - 1) return "Minim halte";
      return "Seimbang";
    }

    function routeSelector(ops, selected) {
      const wrap = li("route-selector", "");
      if (ops.length <= 1) return wrap;
      const tabs = document.createElement("div");
      tabs.className = "route-tabs";
      ops.forEach((r, i) => {
        const tab = document.createElement("button");
        const label = routeLabel(r, i, ops.length);
        const dot = i === 0 ? "🟢" : i === ops.length - 1 ? "⚪" : "🟡";
        tab.textContent = dot + " " + label;
        if (i === selected) tab.className = "active";
        tab.onclick = () => switchRoute(i);
        tabs.appendChild(tab);
      });
      wrap.appendChild(tabs);
      return wrap;
    }

   function switchRoute(i) {
     selectedRouteIdx = i;
     const ol = $("result"); ol.innerHTML = "";
     // Re-render route selector (active tab)
     const selector = routeSelector(routeOptions, i);
     const first = ol.firstChild;
     ol.insertBefore(selector, first);
     // Re-render selected route
     const res = routeOptions[i];
     const legs = pathToLegs(res.path);
     const track = (idx, el) => {
       const last = nav.stops[nav.stops.length - 1];
       if (!last || last.idx !== idx) nav.stops.push({ idx, el });
       return el;
     };
     ol.appendChild(track(legs[0].board, stopLi("start", "🚩 ", legs[0].board)));
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
     // Update summary for selected route
      const label = routeLabel(res, i, routeOptions.length);
      $("summary").textContent = label + ": " + res.transfers + " transfer · " + res.stops + " halte";
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
     
     // Handle both single route (object) and Pareto routes (array)
     routeOptions = Array.isArray(res) ? res : [res];
     selectedRouteIdx = 0;
     
     // Show route selector if multiple options
     if (routeOptions.length > 1) {
       const selector = routeSelector(routeOptions, selectedRouteIdx);
       ol.appendChild(selector);
       $("summary").textContent = "Ditemukan " + routeOptions.length + " opsi rute Pareto-optimal:";
     } else {
       $("summary").textContent = `${routeOptions[0].transfers} transfer · ${routeOptions[0].stops} halte`;
     }
     
     // Render selected route
     const selected = routeOptions[selectedRouteIdx];
     const legs = pathToLegs(selected.path);
     if (!legs.length) { $("summary").textContent = "Rute tidak ditemukan."; return; }

     // track: urutan halte jalur buat navigasi live (skip duplikat berurutan)
     const track = (idx, el) => {
       const last = nav.stops[nav.stops.length - 1];
       if (!last || last.idx !== idx) nav.stops.push({ idx, el });
       return el;
     };
     ol.appendChild(track(legs[0].board, stopLi("start", "🚩 ", legs[0].board)));
     legs.forEach((leg, i) => {
       if (i > 0) ol.appendChild(transferBlock(legs[i - 1], leg));
       ol.appendChild(legHeader(leg));
       ol.appendChild(track(leg.board, stopLi("stop", "Naik: ", leg.board)));
       if (leg.mid.length) {
         const { wrap, els } = midDetails(leg.mid);
         leg.mid.forEach((s, j) => track(s, els[j]));
         ol.appendChild(wrap);
       }
       ol.appendChild(track(leg.alight, stopLi("stop", "Turun: ", leg.alight)));
     });
     const endEl = stopLi("end", "🏁 Sampai: ", legs[legs.length - 1].alight);
     ol.appendChild(endEl);
     nav.stops[nav.stops.length - 1].el = endEl; // highlight tiba di baris "Sampai", bukan "Turun"
     if (navigator.geolocation) $("nav").hidden = false;
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
    if (from === to) { $("err").textContent = "Asal dan tujuan sama."; return; }
    try { render(findRoute(data, from, to, index)); }
    catch (e) { $("err").textContent = e.message; }
  });

  // daftar service worker (offline)
  if ("serviceWorker" in navigator)
    navigator.serviceWorker.register("sw.js").catch(() => {});
})();
