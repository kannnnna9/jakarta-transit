"use strict";
// DOM/render. Router murni ada di Router (router.js). File ini TIDAK berisi logika rute.
(function () {
  const { buildIndex, findRoute } = window.Router;
  const $ = (id) => document.getElementById(id);
  let data = null, index = null, validNames = null;

  fetch("data.json")
    .then((r) => r.json())
    .then((d) => {
      data = d;
      index = buildIndex(d);
      validNames = new Set(d.stops);
      // datalist unik (banyak halte punya nama sama utk peron; tampilkan sekali)
      const dl = $("haltes");
      const frag = document.createDocumentFragment();
      for (const nm of [...validNames].sort((a, b) => a.localeCompare(b, "id"))) {
        const o = document.createElement("option");
        o.value = nm;
        frag.appendChild(o);
      }
      dl.appendChild(frag);
    })
    .catch(() => { $("err").textContent = "Gagal memuat data halte."; });

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
        li.textContent = "🚌 " + data.routes[step.route];
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
