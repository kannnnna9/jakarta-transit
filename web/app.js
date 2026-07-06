"use strict";
// DOM/render. Router murni ada di Router (router.js). File ini TIDAK berisi logika rute.
(function () {
  const { buildIndex, findRoute } = window.Router;
  const { suggest } = window.Suggest;
  const $ = (id) => document.getElementById(id);
  let data = null, index = null, validNames = null;
  let here = null; // {lat,lon} once user shares location

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

  function render(res) {
    const ol = $("result"); ol.innerHTML = "";
    if (!res) { $("summary").textContent = "Rute tidak ditemukan."; return; }
    $("summary").textContent =
      `${res.transfers} transfer · ${res.stops} halte`;
    for (const step of res.path) {
      const li = document.createElement("li");
      const name = data.stops[step.stop];
      if (step.kind === "board") { li.textContent = "🚩 " + name; }
      else if (step.kind === "take") {
        li.className = "hop";
        // ponytail: route_desc taxonomy is messy — anything not BRT/Koridor = non-BRT, show raw desc.
        const rt = (data.rtype && data.rtype[step.route]) || "";
        const nonBrt = rt && !/BRT|Koridor/i.test(rt) ? " · " + rt : "";
        const xtag = { o: " · transfer resmi", w: " · jalan kaki" }[step.xtype] || "";
        li.textContent = "🚌 " + data.routes[step.route] + nonBrt + xtag;
        ol.appendChild(li);
        const sub = document.createElement("li");
        sub.className = "stop"; sub.textContent = name;
        ol.appendChild(sub);
        continue;
      } else { li.className = "stop"; li.textContent = name; }
      ol.appendChild(li);
    }
    const last = res.path[res.path.length - 1];
    const li = document.createElement("li");
    li.className = "end"; li.textContent = "🏁 " + data.stops[last.stop];
    ol.appendChild(li);
  }

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
