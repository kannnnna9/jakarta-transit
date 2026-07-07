#!/usr/bin/env python3
"""Offline Transjakarta navigator: halte A -> halte B, fewest transfers.

Reads the cached GTFS feed and finds a route by number of interchanges
(tiebreak: number of stops). No schedules, no realtime -- just navigation.

Usage:
  ./route.py "pancoran" "ragunan"
  GTFS_DIR=/path/to/extracted ./route.py "asal" "tujuan"

Matching: origin/dest are case-insensitive substrings of stop_name; every
matching stop is a candidate board/alight point. Transfers only happen
between stops that share the EXACT same name (same physical halte).
"""
import csv, heapq, math, os, sys
from collections import defaultdict
from itertools import count

HERE = os.path.dirname(os.path.abspath(__file__))
GTFS = os.environ.get(
    "GTFS_DIR",
    os.path.join(HERE, "data/f-transjakarta~id/extracted"),
)

WALK_M = 150  # keep in sync with build-data.py WALK_M
WEIGHT = 8    # biaya 1 transfer = WEIGHT halte; transfer dipilih hanya kalau hemat >WEIGHT halte


def _num(s):
    s = (s or "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def _haversine_m(lat1, lon1, lat2, lon2):
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def load():
    def rows(name):
        with open(os.path.join(GTFS, name), newline="", encoding="utf-8") as f:
            yield from csv.DictReader(f)

    stop_name = {}          # stop_id -> name
    name_stops = defaultdict(list)   # name -> [stop_id]
    stop_lat, stop_lon, stop_parent = {}, {}, {}
    for r in rows("stops.txt"):
        sid, nm = r["stop_id"], r["stop_name"].strip()
        stop_name[sid] = nm
        name_stops[nm].append(sid)
        stop_lat[sid] = _num(r.get("stop_lat"))
        stop_lon[sid] = _num(r.get("stop_lon"))
        stop_parent[sid] = (r.get("parent_station") or "").strip()

    xfer = _build_xfer(rows, stop_lat, stop_lon, stop_parent)

    trip_route = {r["trip_id"]: r["route_id"] for r in rows("trips.txt")}

    rname = {}              # route_id -> label
    for r in rows("routes.txt"):
        short = r["route_short_name"].strip()
        long = r["route_long_name"].strip()
        rname[r["route_id"]] = f"{short} ({long})" if long else short

    # consecutive stop pairs per trip -> directed ride edges per route
    trip_seq = defaultdict(list)     # trip_id -> [(seq, stop_id)]
    for r in rows("stop_times.txt"):
        trip_seq[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"]))

    ride = defaultdict(lambda: defaultdict(set))  # route -> stop -> {next stops}
    routes_at = defaultdict(set)                  # stop -> {route}
    for tid, seq in trip_seq.items():
        route = trip_route.get(tid)
        if route is None:
            continue
        seq.sort()
        for (_, a), (_, b) in zip(seq, seq[1:]):
            ride[route][a].add(b)
            routes_at[a].add(route)
            routes_at[b].add(route)
    return stop_name, name_stops, rname, ride, routes_at, xfer


def _build_xfer(rows, stop_lat, stop_lon, stop_parent):
    """Extra (non-same-name) transfer links keyed by stop_id.
    MUST mirror build-data.py build_xfer semantics so route.py stays a true
    oracle for web/router.js. Priority s > o > w; directed + symmetric."""
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
    for sid, par in stop_parent.items():
        if par:
            parent_group[par].append(sid)
    for members in parent_group.values():
        for i in range(len(members)):
            for j in range(i + 1, len(members)):
                add(members[i], members[j], "s", 0)

    # 2. official transfers.txt -> "o" (skip type 3 = not possible)
    try:
        for r in rows("transfers.txt"):
            if (r.get("transfer_type") or "0").strip() == "3":
                continue
            a, b = r.get("from_stop_id"), r.get("to_stop_id")
            if a in stop_lat and b in stop_lat:
                add(a, b, "o", 0)
    except FileNotFoundError:
        pass

    # 3. proximity walk < WALK_M -> "w" (grid bucket; cell > threshold)
    CELL = (WALK_M * 1.1) / 111_320
    grid = defaultdict(list)
    for sid in stop_lat:
        la, lo = stop_lat[sid], stop_lon[sid]
        if la is None or lo is None:
            continue
        grid[(round(la / CELL), round(lo / CELL))].append(sid)
    for (cy, cx), bucket in grid.items():
        cand = []
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                cand += grid.get((cy + dy, cx + dx), [])
        for a in bucket:
            for b in cand:
                if b <= a:  # stop_ids are strings; stable dedup of each pair
                    continue
                dm = _haversine_m(stop_lat[a], stop_lon[a], stop_lat[b], stop_lon[b])
                if dm < WALK_M:
                    add(a, b, "w", int(round(dm)))

    out = defaultdict(list)
    for (a, b), (ty, dist) in pairs.items():
        out[a].append((b, ty, dist))
    return dict(out)


def _dominates(a, b):
    """Check if label a dominates label b (Pareto: both metrics <= and one <)."""
    return a[0] <= b[0] and a[1] <= b[1] and (a[0] < b[0] or a[1] < b[1])


def find(origin, dest, data, pareto_limit=3):
    """Find Pareto-optimal routes (minim transfers, minim stops).
    
    Returns list of (transfers, stops, path) sorted by (transfers, stops).
    pareto_limit caps number of returned solutions (default 3).
    """
    stop_name, name_stops, rname, ride, routes_at = data[:5]
    xfer = data[5] if len(data) > 5 else {}
    o, d = origin.lower(), dest.lower()
    origins = [s for s, n in stop_name.items() if o in n.lower()]
    dests = {s for s, n in stop_name.items() if d in n.lower()}
    if not origins:
        sys.exit(f"no stop matches origin '{origin}'")
    if not dests:
        sys.exit(f"no stop matches dest '{dest}'")

    # State = (stop, route). Each state can have MULTIPLE non-dominated labels.
    #Label = (transfers, stops, seq, path)
    # heap key = (transfers, stops, seq) for deterministic ordering
    seq = count()
    pq = []
    for s in origins:
        label = (0, 0, next(seq), [("board", s, None, None)])
        heapq.heappush(pq, (0, 0, label[2], s, None, label))
    
    # best[state] = list of non-dominated (transfers, stops) pairs
    best = defaultdict(list)  # (stop, route) -> [(tr, st), ...]
    
    # Collect all solutions that reach destination
    solutions = []
    
    while pq and len(solutions) < pareto_limit * 10:  # cap explores to avoid explosion
        tr, st, sq, stop, route, label = heapq.heappop(pq)
        _, _, _, path = label
        
        # Check dominated by existing labels
        key = (stop, route)
        existing = best[key]
        is_dominated = any(_dominates((etr, est), (tr, st)) for etr, est in existing)
        if is_dominated:
            continue
        
        # Add new label, remove old dominated labels
        existing = [(etr, est) for etr, est in existing if not _dominates((tr, st), (etr, est))]
        existing.append((tr, st))
        best[key] = existing
        
        if stop in dests:
            solutions.append((tr, st, path))
            continue
        
        # ride one stop forward on current route
        if route is not None:
            for nxt in sorted(ride[route].get(stop, ())):
                nst = st + 1
                new_label = (tr, nst, next(seq), path + [("ride", nxt, route, None)])
                heapq.heappush(pq, (tr, nst, new_label[2], nxt, route, new_label))
        
        # board / transfer
        targets = [(s2, "s") for s2 in name_stops[stop_name[stop]]]
        for nb, ty, _dist in xfer.get(stop, ()):
            targets.append((nb, ty))
        for s2, xtype in targets:
            for r2 in sorted(routes_at[s2]):
                if r2 == route:
                    continue
                ntr = tr if route is None else tr + 1
                new_label = (ntr, st, next(seq), path + [("take", s2, r2, xtype)])
                heapq.heappush(pq, (ntr, st, new_label[2], s2, r2, new_label))
    
    # Filter Pareto-optimal from solutions
    if not solutions:
        return []
    
    # Sort by (transfers, stops)
    solutions.sort(key=lambda x: (x[0], x[1]))
    
    # Keep only non-dominated solutions (unique by (transfers, stops))
    pareto = []
    seen = set()
    for sol in solutions:
        tr, st, _ = sol
        key = (tr, st)
        if key not in seen:
            seen.add(key)
            pareto.append(sol)
    
    # Sort by (transfers, stops)
    pareto.sort(key=lambda x: (x[0], x[1]))
    
    return pareto[:pareto_limit]


def render(res, data):
    stop_name, _, rname, *_ = data
    if not res:
        print("No route found.")
        return
    transfers, stops, path = res
    print(f"Route found: {transfers} transfer(s), {stops} stop(s)\n")
    tags = {"o": " [transfer resmi]", "w": " [jalan kaki]"}
    for kind, stop, route, xtype in path:
        nm = stop_name[stop]
        if kind == "board":
            print(f"START at {nm}")
        elif kind == "take":
            print(f"  -> board  [{rname[route]}]{tags.get(xtype, '')}  at {nm}")
        elif kind == "ride":
            print(f"       ...  {nm}")
    print(f"\nARRIVE at {stop_name[path[-1][1]]}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(f"usage: {sys.argv[0]} <origin> <dest>")
    data = load()
    stop_name, _, rname, *_ = data
    routes = find(sys.argv[1], sys.argv[2], data, pareto_limit=3)
    if not routes:
        print("No route found.")
    else:
        print(f"Found {len(routes)} Pareto-optimal route(s):\n")
        for i, (tr, st, path) in enumerate(routes, 1):
            print(f"--- Option {i} ---")
            print(f"{tr} transfer(s), {st} stop(s)\n")
            tags = {"o": " [transfer resmi]", "w": " [jalan kaki]"}
            for kind, stop, route, xtype in path:
                nm = stop_name[stop]
                if kind == "board":
                    print(f"START at {nm}")
                elif kind == "take":
                    print(f"  -> board  [{rname[route]}]{tags.get(xtype, '')}  at {nm}")
                elif kind == "ride":
                    print(f"       ...  {nm}")
            print(f"\nARRIVE at {stop_name[path[-1][1]]}\n")


def _selftest():
    # ponytail: tiny hand-built feed, asserts transfer counting + ordering
    name_stops = defaultdict(list)
    stop_name = {"a": "A", "b": "B", "c": "C", "b2": "B"}
    for s, n in stop_name.items():
        name_stops[n].append(s)
    ride = defaultdict(lambda: defaultdict(set))
    ride["R1"]["a"].add("b")          # R1: A->B
    ride["R2"]["b2"].add("c")         # R2: B->C  (b2 same name as b)
    routes_at = defaultdict(set)
    routes_at["a"].add("R1"); routes_at["b"].add("R1")
    routes_at["b2"].add("R2"); routes_at["c"].add("R2")
    data = (stop_name, name_stops, {"R1": "R1", "R2": "R2"}, ride, routes_at)
    routes = find("A", "C", data, pareto_limit=3)
    assert len(routes) == 1, f"expected 1 route, got {len(routes)}"
    tr, st, _ = routes[0]
    assert (tr, st) == (1, 2), (tr, st)   # 1 transfer at B, 2 ride-stops
    routes = find("A", "B", data, pareto_limit=3)
    assert len(routes) == 1, f"expected 1 route, got {len(routes)}"
    tr, st, _ = routes[0]
    assert (tr, st) == (0, 1), (tr, st)   # board R1, ride 1
    print("selftest ok")

    # xfer: A->D on R1, D within walking distance of B (different name),
    # B->C on R3. Route A->C must transfer at D via a "w" (walk) xfer edge.
    stop_name2 = {"a": "A", "b": "B", "c": "C", "d": "D"}
    name_stops2 = defaultdict(list)
    for s, n in stop_name2.items():
        name_stops2[n].append(s)
    ride2 = defaultdict(lambda: defaultdict(set))
    ride2["R1"]["a"].add("d")          # R1: A->D
    ride2["R3"]["b"].add("c")          # R3: B->C
    routes_at2 = defaultdict(set)
    routes_at2["a"].add("R1"); routes_at2["d"].add("R1")
    routes_at2["b"].add("R3"); routes_at2["c"].add("R3")
    xfer2 = {"d": [("b", "w", 120)], "b": [("d", "w", 120)]}   # walk D<->B 120 m
    data2 = (stop_name2, name_stops2, {"R1": "R1", "R3": "R3"}, ride2, routes_at2, xfer2)
    routes = find("A", "C", data2, pareto_limit=3)
    assert len(routes) >= 1, "A->C via walk xfer not found"
    tr, st, path = routes[0]
    assert tr == 1, ("transfers", tr)
    takes = [(k, ty) for (k, s, r, ty) in path if k == "take"]
    assert takes and takes[-1][1] == "w", ("walk type missing", takes)
    print("xfer selftest ok")

    # weighted: long 0-transfer ride (13 halte) must lose to short 1-transfer (2 halte).
    # Pareto should find both: 0-transfer/13-stops and 1-transfer/2-stops are non-dominated.
    sn3 = {"a": "A", "c": "C", "b": "B", "b2": "B"}
    ns3 = defaultdict(list)
    for s, n in list(sn3.items()):
        ns3[n].append(s)
    ride3 = defaultdict(lambda: defaultdict(set))
    prev = "a"
    for i in range(12):                       # R1: a -> x0..x11 -> c  (13 rides)
        nid = "x%d" % i
        sn3[nid] = "X%d" % i
        ns3[sn3[nid]].append(nid)
        ride3["R1"][prev].add(nid)
        prev = nid
    ride3["R1"][prev].add("c")
    ride3["R2"]["a"].add("b")                 # R2: a -> b
    ride3["R3"]["b2"].add("c")                # R3: b2 -> c   (b2 same name "B")
    ra3 = defaultdict(set)
    for r, adj in ride3.items():
        for u, vs in adj.items():
            ra3[u].add(r)
            for v in vs:
                ra3[v].add(r)
    data3 = (sn3, ns3, {"R1": "R1", "R2": "R2", "R3": "R3"}, ride3, ra3, {})
    routes = find("A", "C", data3, pareto_limit=3)
    # Pareto should find both solutions: 0tf/13stops and 1tf/2stops (both non-dominated)
    assert len(routes) == 2, f"expected 2 Pareto routes, got {len(routes)}: {routes}"
    # Check both routes exist (order depends on exploration order)
    routes_set = {(tr, st) for tr, st, _ in routes}
    assert routes_set == {(0, 13), (1, 2)}, f"expected routes (0,13) and (1,2), got {routes_set}"
    print("weighted selftest ok")
