#!/usr/bin/env python3
"""Ubah GTFS extracted -> web/data.json (lihat spec Bagian 5).

Struktur output:
  stops:  [nama, ...]                       # index -> nama halte
  routes: ["short (long)", ...]             # index -> label koridor
  edges:  {"routeIdx": {"stopIdx": [nextStopIdx, ...]}}  # adjacency berarah
"""
import csv, json, math, os
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
GTFS = os.environ.get("GTFS_DIR", os.path.join(HERE, "data/f-transjakarta~id/extracted"))
OUT = os.environ.get("OUT", os.path.join(HERE, "web/data.json"))

WALK_M = 150  # ponytail: tunable proximity threshold (roadmap DECIDED 150 m)


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
        trip_seq[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"]))

    edges = defaultdict(lambda: defaultdict(set))  # routeIdx -> stopIdx -> {next}
    for tid, seq in trip_seq.items():
        rid = trip_route.get(tid)
        if rid is None:
            continue
        ridx = route_idx[rid]
        seq.sort()
        for (_, a), (_, b) in zip(seq, seq[1:]):
            edges[ridx][stop_idx[a]].add(stop_idx[b])

    edges_out = {
        str(ri): {str(si): sorted(nx) for si, nx in adj.items()}
        for ri, adj in edges.items()
    }
    xfer = build_xfer(stop_idx, stop_lat, stop_lon)
    data = {
        "stops": stop_names, "routes": route_labels, "edges": edges_out,
        "lat": stop_lat, "lon": stop_lon, "rtype": route_types, "xfer": xfer,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    edge_nodes = sum(len(a) for a in edges_out.values())
    print(f"wrote {OUT}: {len(stop_names)} stops, {len(route_labels)} routes, "
          f"{edge_nodes} edge-nodes, {len(xfer)} xfer-nodes")


if __name__ == "__main__":
    main()
