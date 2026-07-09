#!/usr/bin/env python3
"""Ubah GTFS extracted -> web/data.json (lihat spec Bagian 5).

Struktur output:
  stops:  [nama, ...]                       # index -> nama halte
  routes: ["short (long)", ...]             # index -> label koridor
  edges:  {"routeIdx": {"stopIdx": [nextStopIdx, ...]}}  # adjacency berarah
"""
import csv, json, math, os, re
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
GTFS = os.environ.get("GTFS_DIR", os.path.join(HERE, "data/f-transjakarta~id/extracted"))
OUT = os.environ.get("OUT", os.path.join(HERE, "web/data.json"))

WALK_M = 150  # ponytail: tunable proximity threshold (roadmap DECIDED 150 m)
BUS_SPEED_MS = 6  # ponytail: fallback kalau GTFS delta kosong; kalibrasi kalau estimasi meleset.


def rows(name):
    with open(os.path.join(GTFS, name), newline="", encoding="utf-8") as f:
        yield from csv.DictReader(f)


def _num(s):
    s = (s or "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def _haversine_m(lat1, lon1, lat2, lon2):
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _time_s(s):
    h, m, sec = map(int, (s or "0:0:0").split(":"))
    return h * 3600 + m * 60 + sec


# --- Penomoran halte BRT (peta integrasi Transjakarta ed. 2026-06) ---
# Nomor "koridor-urut" tidak ada di GTFS; diturunkan dari urutan stop trip
# terpanjang arah resmi (origin sesuai peta), halte arah-balik dapat nomor
# lanjutan. Origin & OVERRIDES diverifikasi manual dari peta integrasi.jpg.
SNUM_ORIGIN = {
    "1": "Blok M", "2": "Pulo Gadung", "3": "Kalideres", "4": "Pulo Gadung",
    "5": "Ancol", "6": "Ragunan", "7": "Kampung Rambutan", "8": "Lebak Bulus",
    "9": "Pinang Ranti", "10": "Tanjung Priok", "11": "Pulo Gebang",
    "12": "Pluit", "13": "Tegal Mampang", "14": "Senen TOYOTA Rangga",
}
# Koreksi yang terbaca di peta tapi beda/absen di GTFS. None = tanpa nomor.
SNUM_OVERRIDE = {
    "1": {"Kejaksaan Agung": 2,  # peta: "1-2 ASEAN Kejaksaan Agung"
          "Kota": 20, "Kali Besar": 21, "Museum Sejarah Jakarta": 22},
    "2": {"Monumen Nasional": 21, "Balai Kota": 22, "Gambir 2": 23,
          "Kwitang": 24},  # peta punya halte 2-20 yang tak ada di GTFS
    "3": {"Pecenongan": 14, "Juanda": 15, "Pasar Baru": 16,
          "Monumen Nasional": None},  # peta tak beri nomor 3 di Monas
}
_ARAH = re.compile(r"\s+Arah\s+(Utara|Selatan|Timur|Barat)$")


def _station(name):
    """Nama stasiun peta: halte 'Arah X' GTFS = satu stasiun, satu nomor."""
    return _ARAH.sub("", name)


def build_snum(trip_route, trip_seq, stop_idx, stop_names):
    """{stopIdx: ["1-20","12-6",...]} untuk halte platform koridor BRT 1-14."""
    corr_trips = defaultdict(list)  # rid -> [urutan nama stasiun per trip]
    for tid, seq in trip_seq.items():
        rid = trip_route.get(tid)
        if rid in SNUM_ORIGIN:
            names = [_station(stop_names[stop_idx[s]]) for _, s, *_ in sorted(seq)]
            corr_trips[rid].append(names)

    def best(trips, key, score):
        cands = [t for t in trips if t and key(t)]
        return max(cands, key=score, default=[])

    num_by_corr = {}  # rid -> {station: num|None}
    for rid, origin in SNUM_ORIGIN.items():
        trips = corr_trips.get(rid, [])
        outb = best(trips, lambda t: t[0] == origin and t[-1] != origin,
                    lambda t: len(set(t)))
        if not outb:
            outb = best(trips, lambda t: t[0] == origin, lambda t: len(set(t)))
        dest = outb[-1] if outb else None
        # trip balik: overlap terbesar dgn outbound, bukan terpanjang —
        # varian malam lewat jalan lain ikut terdaftar di route_id koridor
        ob = set(outb)
        ret = best(trips, lambda t: t[0] == dest and t[-1] == origin,
                   lambda t: (len(set(t) & ob), len(set(t))))
        if trips and not outb:  # drift GTFS vs origin hardcode — jangan diam
            print(f"warn: koridor {rid} tak punya trip dari origin '{origin}'")
        nums, n = {}, 0
        for name in list(outb) + list(ret):
            if name not in nums:
                n += 1
                nums[name] = n
        nums.update(SNUM_OVERRIDE.get(rid, {}))
        num_by_corr[rid] = nums

    # label per nama stasiun untuk SEMUA stop senama (halte koridor dipakai juga
    # trayek non-koridor spt 13E — papan halte fisiknya tetap bernomor);
    # halte bersama lintas koridor = multi-nomor
    snum = {}
    for si in range(len(stop_names)):
        station = _station(stop_names[si])
        labels = [
            f"{rid}-{nums[station]}"
            for rid, nums in num_by_corr.items()
            if nums.get(station) is not None
        ]
        if labels:
            labels.sort(key=lambda s: tuple(map(int, s.split("-"))))
            snum[str(si)] = labels
    return snum


def build_xfer(stop_idx, stop_lat, stop_lon):
    """Extra transfer links (NOT same-name; router handles those live).
    Sources, priority s > o > w: shared parent_station, transfers.txt, proximity walk.
    Returns {str(stopIdx): [[nbrIdx, type, dist_m], ...]}, directed+symmetric."""
    prio = {"s": 3, "o": 2, "w": 1}
    pairs = {}

    def add(a, b, ty, dist):
        if a == b:
            return
        for x, y in ((a, b), (b, a)):
            old = pairs.get((x, y))
            if old is None or prio[ty] > prio[old[0]]:
                pairs[(x, y)] = (ty, dist)

    # 1. shared parent_station -> "s"
    parent_group = defaultdict(list)
    for r in rows("stops.txt"):
        par = (r.get("parent_station") or "").strip()
        if par:
            parent_group[par].append(stop_idx[r["stop_id"]])
    for members in parent_group.values():
        for i in range(len(members)):
            for j in range(i + 1, len(members)):
                add(members[i], members[j], "s", 0)

    # 2. official transfers.txt -> "o" (skip type 3 = "transfer not possible")
    try:
        for r in rows("transfers.txt"):
            if (r.get("transfer_type") or "0").strip() == "3":
                continue
            a, b = r.get("from_stop_id"), r.get("to_stop_id")
            if a in stop_idx and b in stop_idx:
                add(stop_idx[a], stop_idx[b], "o", 0)
    except FileNotFoundError:
        pass  # feed may omit transfers.txt

    # 3. proximity walk < WALK_M -> "w"  (grid bucket, not O(n^2))
    # Derive CELL from WALK_M so cell > threshold always holds: a true pair
    # can then never sit >1 cell apart, so the 3x3 neighbor window is complete.
    # ponytail: enforce the invariant, don't just comment it.
    CELL = (WALK_M * 1.1) / 111_320  # deg; ~0.00148 for 150 m
    grid = defaultdict(list)
    for i, (la, lo) in enumerate(zip(stop_lat, stop_lon)):
        if la is None or lo is None:
            continue
        grid[(round(la / CELL), round(lo / CELL))].append(i)
    for (cy, cx), bucket in grid.items():
        cand = []
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                cand += grid.get((cy + dy, cx + dx), [])
        for i in bucket:
            for j in cand:
                if j <= i:
                    continue
                d = _haversine_m(stop_lat[i], stop_lon[i], stop_lat[j], stop_lon[j])
                if d < WALK_M:
                    add(i, j, "w", int(round(d)))

    out = defaultdict(list)
    for (a, b), (ty, dist) in pairs.items():
        out[str(a)].append([b, ty, dist])
    for links in out.values():
        links.sort()
    return dict(out)


def build_etime(trip_route, trip_seq, route_idx, stop_idx, stop_lat, stop_lon, edges):
    deltas = defaultdict(list)  # (routeIdx, stopIdx, nextStopIdx) -> [secs]
    for tid, seq in trip_seq.items():
        rid = trip_route.get(tid)
        if rid is None:
            continue
        ridx = route_idx[rid]
        seq.sort()
        for (_, a, ta), (_, b, tb) in zip(seq, seq[1:]):
            d = tb - ta
            if d > 0:
                deltas[(ridx, stop_idx[a], stop_idx[b])].append(d)

    out = {}
    for ri, adj in edges.items():
        out[str(ri)] = {}
        for si, nexts in adj.items():
            out[str(ri)][str(si)] = {}
            for nx in nexts:
                vals = sorted(deltas.get((ri, si, nx), ()))
                if vals:
                    sec = vals[(len(vals) - 1) // 2]
                else:
                    la1, lo1, la2, lo2 = stop_lat[si], stop_lon[si], stop_lat[nx], stop_lon[nx]
                    if None in (la1, lo1, la2, lo2):
                        sec = 60
                    else:
                        sec = int(round(_haversine_m(la1, lo1, la2, lo2) / BUS_SPEED_MS))
                out[str(ri)][str(si)][str(nx)] = max(1, int(sec))
    return out


def build_dist(edges, stop_lat, stop_lon):
    out = {}
    for ri, adj in edges.items():
        out[str(ri)] = {}
        for si, nexts in adj.items():
            out[str(ri)][str(si)] = {}
            for nx in nexts:
                la1, lo1, la2, lo2 = stop_lat[si], stop_lon[si], stop_lat[nx], stop_lon[nx]
                meters = 1 if None in (la1, lo1, la2, lo2) else int(round(_haversine_m(la1, lo1, la2, lo2)))
                out[str(ri)][str(si)][str(nx)] = max(1, meters)
    return out


def build_fare(route_idx):
    prices = {}
    for r in rows("fare_attributes.txt"):
        prices[r["fare_id"]] = int(round(float(r["price"] or 0)))

    route_fare = {}
    for r in rows("fare_rules.txt"):
        route_fare.setdefault(r["route_id"], r["fare_id"])

    fare = [[0, "?"] for _ in route_idx]
    for rid, idx in route_idx.items():
        fid = route_fare.get(rid)
        if not fid:
            print(f"warn: route {rid} missing fare_rules")
            continue
        fare[idx] = [prices.get(fid, 0), fid]
    return fare


def main():
    stop_idx, stop_names, stop_lat, stop_lon = {}, [], [], []
    for r in rows("stops.txt"):
        stop_idx[r["stop_id"]] = len(stop_names)
        stop_names.append(r["stop_name"].strip())
        stop_lat.append(_num(r.get("stop_lat")))
        stop_lon.append(_num(r.get("stop_lon")))

    route_idx, route_labels, route_types = {}, [], []
    for r in rows("routes.txt"):
        short = r["route_short_name"].strip()
        long = r["route_long_name"].strip()
        route_idx[r["route_id"]] = len(route_labels)
        route_labels.append(f"{short} ({long})" if long else short)
        route_types.append((r.get("route_desc") or "").strip())

    trip_route = {r["trip_id"]: r["route_id"] for r in rows("trips.txt")}

    trip_seq = defaultdict(list)
    for r in rows("stop_times.txt"):
        trip_seq[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"], _time_s(r["arrival_time"])))

    edges = defaultdict(lambda: defaultdict(set))  # routeIdx -> stopIdx -> {next}
    for tid, seq in trip_seq.items():
        rid = trip_route.get(tid)
        if rid is None:
            continue
        ridx = route_idx[rid]
        seq.sort()
        for (_, a, _), (_, b, _) in zip(seq, seq[1:]):
            edges[ridx][stop_idx[a]].add(stop_idx[b])

    edges_out = {
        str(ri): {str(si): sorted(nx) for si, nx in adj.items()}
        for ri, adj in edges.items()
    }
    xfer = build_xfer(stop_idx, stop_lat, stop_lon)
    snum = build_snum(trip_route, trip_seq, stop_idx, stop_names)
    etime = build_etime(trip_route, trip_seq, route_idx, stop_idx, stop_lat, stop_lon, edges)
    dist = build_dist(edges, stop_lat, stop_lon)
    fare = build_fare(route_idx)
    data = {
        "stops": stop_names, "routes": route_labels, "edges": edges_out,
        "lat": stop_lat, "lon": stop_lon, "rtype": route_types, "xfer": xfer,
        "snum": snum, "etime": etime, "dist": dist, "fare": fare,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    edge_nodes = sum(len(a) for a in edges_out.values())
    print(f"wrote {OUT}: {len(stop_names)} stops, {len(route_labels)} routes, "
          f"{edge_nodes} edge-nodes, {len(xfer)} xfer-nodes")


if __name__ == "__main__":
    main()
