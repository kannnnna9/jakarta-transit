"use strict";
// DOM/render. Router murni ada di Router (router.js). File ini TIDAK berisi logika rute.
(function () {
  const { buildIndex, findRoute } = window.Router;
  const { suggest } = window.Suggest;
  const { pathToLegs } = window.Legs;
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

  const nm = (i) => data.stops[i];
  const li = (cls, text) => {
    const e = document.createElement("li");
    if (cls) e.className = cls;
    e.textContent = text;
    return e;
  };

  // Blok transfer antar-leg. Ikon beda per jenis biar tak rancu:
  // 🚶 jalan kaki (w) · 🔗 halte terhubung/transfer resmi (o) · ↔️ pindah peron (s).
  function transferBlock(prev, leg) {
    const to = nm(leg.board);
    let text;
    if (leg.xtype === "w") text = "🚶 Jalan kaki ke " + to;
    else if (leg.xtype === "o") text = "🔗 Pindah di halte terhubung";
    else text = nm(prev.alight) === to ? "↔️ Pindah peron di " + to : "↔️ Pindah ke " + to;
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
  function midDetails(mid) {
    const wrap = li("stop", "");
    const det = document.createElement("details");
    const sum = document.createElement("summary");
    sum.textContent = mid.length + " halte dilewati";
    det.appendChild(sum);
    const inner = document.createElement("ol");
    inner.className = "mid";
    for (const s of mid) inner.appendChild(li("stop", nm(s)));
    det.appendChild(inner);
    wrap.appendChild(det);
    return wrap;
  }

  function render(res) {
    const ol = $("result"); ol.innerHTML = "";
    if (!res) { $("summary").textContent = "Rute tidak ditemukan."; return; }
    $("summary").textContent = `${res.transfers} transfer · ${res.stops} halte`;
    const legs = pathToLegs(res.path);
    if (!legs.length) { $("summary").textContent = "Rute tidak ditemukan."; return; }

    ol.appendChild(li("start", "🚩 " + nm(legs[0].board)));
    legs.forEach((leg, i) => {
      if (i > 0) ol.appendChild(transferBlock(legs[i - 1], leg));
      ol.appendChild(legHeader(leg));
      ol.appendChild(li("stop", "Naik: " + nm(leg.board)));
      if (leg.mid.length) ol.appendChild(midDetails(leg.mid));
      ol.appendChild(li("stop", "Turun: " + nm(leg.alight)));
    });
    ol.appendChild(li("end", "🏁 Sampai: " + nm(legs[legs.length - 1].alight)));
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
