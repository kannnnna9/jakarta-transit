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
BUS_SPEED_MS = 6
TRANSFER_WAIT_S = 240
WALK_SPEED_MS = 1.4
BRT_FARES = {"FP", "FP2"}
PREMIUM_FARES = {"PP", "PP2", "PP3"}
MAX_GOAL_TRANSFERS = 6  # ponytail: guard transfer 0-detik; naikkan kalau rute nyata butuh >6 transfer.
MAX_PARETO_STATES = 100000  # ponytail: CLI oracle guard; JS app remains primary runtime.


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


def _time_s(s):
    h, m, sec = map(int, (s or "0:0:0").split(":"))
    return h * 3600 + m * 60 + sec


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
    rtype = {}              # route_id -> service class
    for r in rows("routes.txt"):
        short = r["route_short_name"].strip()
        long = r["route_long_name"].strip()
        rname[r["route_id"]] = f"{short} ({long})" if long else short
        rtype[r["route_id"]] = (r.get("route_desc") or "").strip()

    # consecutive stop pairs per trip -> directed ride edges per route
    trip_seq = defaultdict(list)     # trip_id -> [(seq, stop_id)]
    for r in rows("stop_times.txt"):
        trip_seq[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"], _time_s(r["arrival_time"])))

    ride = defaultdict(lambda: defaultdict(set))  # route -> stop -> {next stops}
    routes_at = defaultdict(set)                  # stop -> {route}
    for tid, seq in trip_seq.items():
        route = trip_route.get(tid)
        if route is None:
            continue
        seq.sort()
        for (_, a, _), (_, b, _) in zip(seq, seq[1:]):
            ride[route][a].add(b)
            routes_at[a].add(route)
            routes_at[b].add(route)

    etime = _build_etime(trip_route, trip_seq, stop_lat, stop_lon, ride)
    dist = _build_dist(stop_lat, stop_lon, ride)
    fare = _build_fare(rows, rname)
    return stop_name, name_stops, rname, ride, routes_at, xfer, etime, dist, fare, rtype


def _build_etime(trip_route, trip_seq, stop_lat, stop_lon, ride):
    deltas = defaultdict(list)
    for tid, seq in trip_seq.items():
        route = trip_route.get(tid)
        if route is None:
            continue
        seq.sort()
        for (_, a, ta), (_, b, tb) in zip(seq, seq[1:]):
            d = tb - ta
            if d > 0:
                deltas[(route, a, b)].append(d)

    out = {}
    for route, adj in ride.items():
        out[route] = {}
        for a, nexts in adj.items():
            out[route][a] = {}
            for b in nexts:
                vals = sorted(deltas.get((route, a, b), ()))
                if vals:
                    sec = vals[(len(vals) - 1) // 2]
                else:
                    la1, lo1, la2, lo2 = stop_lat[a], stop_lon[a], stop_lat[b], stop_lon[b]
                    sec = 60 if None in (la1, lo1, la2, lo2) else int(round(_haversine_m(la1, lo1, la2, lo2) / BUS_SPEED_MS))
                out[route][a][b] = max(1, int(sec))
    return out


def _build_dist(stop_lat, stop_lon, ride):
    out = {}
    for route, adj in ride.items():
        out[route] = {}
        for a, nexts in adj.items():
            out[route][a] = {}
            for b in nexts:
                la1, lo1, la2, lo2 = stop_lat[a], stop_lon[a], stop_lat[b], stop_lon[b]
                meters = 1 if None in (la1, lo1, la2, lo2) else int(round(_haversine_m(la1, lo1, la2, lo2)))
                out[route][a][b] = max(1, meters)
    return out


def _build_fare(rows, rname):
    prices = {r["fare_id"]: int(round(float(r["price"] or 0))) for r in rows("fare_attributes.txt")}
    route_fare = {}
    for r in rows("fare_rules.txt"):
        route_fare.setdefault(r["route_id"], r["fare_id"])
    fare = {}
    for route in rname:
        fid = route_fare.get(route)
        if not fid:
            fare[route] = (0, "?")
        else:
            fare[route] = (prices.get(fid, 0), fid)
    return fare


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


def _allowed(route, rtype, allowed):
    return not allowed or rtype.get(route, "") in allowed


def _targets(stop, stop_name, name_stops, xfer):
    targets = [(s2, "s", 0) for s2 in name_stops[stop_name[stop]]]
    targets += list(xfer.get(stop, ()))
    return sorted(targets, key=lambda x: (x[0], x[1], x[2] or 0))


def find(origin, dest, data, pareto_limit=3, allowed=None):
    """Find Pareto-optimal routes (minim transfers, minim stops).
    
    Returns list of (transfers, stops, path) sorted by (transfers, stops).
    pareto_limit caps number of returned solutions (default 3).
    """
    stop_name, name_stops, rname, ride, routes_at = data[:5]
    xfer = data[5] if len(data) > 5 else {}
    rtype = data[9] if len(data) > 9 else {}
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
        label = (0, 0, next(seq), [("board", s, None, None, None)])
        heapq.heappush(pq, (0, 0, label[2], s, None, False, label))
    
    # best[state] = list of non-dominated (transfers, stops) pairs
    best = defaultdict(list)  # (stop, route) -> [(tr, st), ...]
    
    # Collect all solutions that reach destination
    solutions = []
    
    seen_states = 0
    while pq and len(solutions) < pareto_limit * 10 and seen_states < MAX_PARETO_STATES:
        seen_states += 1
        tr, st, sq, stop, route, ridden, label = heapq.heappop(pq)
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
                new_label = (tr, nst, next(seq), path + [("ride", nxt, route, None, None)])
                heapq.heappush(pq, (tr, nst, new_label[2], nxt, route, True, new_label))
        
        # board / transfer
        if route is not None and not ridden:
            continue
        for s2, xtype, xdist in _targets(stop, stop_name, name_stops, xfer):
            if route is None and xtype != "s" and s2 not in dests:
                continue
            ntr = tr if route is None else tr + 1
            if s2 in dests and s2 != stop:
                solutions.append((ntr, st, path + [("xfer", s2, None, xtype, xdist)]))
                continue
            for r2 in sorted(r for r in routes_at[s2] if _allowed(r, rtype, allowed)):
                if r2 == route and s2 == stop:
                    continue
                new_label = (ntr, st, next(seq), path + [("take", s2, r2, xtype, xdist)])
                heapq.heappush(pq, (ntr, st, new_label[2], s2, r2, False, new_label))
    
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


def route_cost(path, etime, fare_table):
    secs = fare = 0
    brt_paid = False
    prev_stop = cur_route = None
    boarded = False
    for kind, stop, route, xtype, _xdist in path:
        if kind == "take":
            if boarded:
                secs += TRANSFER_WAIT_S
            boarded = True
            if xtype == "w":
                brt_paid = False
            price, klass = fare_table.get(route, (0, "?"))
            if klass in BRT_FARES:
                if not brt_paid:
                    fare += price
                    brt_paid = True
            elif klass in PREMIUM_FARES:
                fare += price
            cur_route, prev_stop = route, stop
        elif kind == "ride":
            route = route if route is not None else cur_route
            if route is not None and prev_stop is not None:
                secs += etime.get(route, {}).get(prev_stop, {}).get(stop, 0)
            cur_route, prev_stop = route, stop
        elif kind == "board":
            prev_stop = stop
        elif kind == "xfer":
            if cur_route is not None:
                secs += TRANSFER_WAIT_S
            if xtype == "w":
                secs += round((_xdist or 0) / WALK_SPEED_MS)
            prev_stop = stop
    return secs, fare


def fmt_fare(n):
    return f"Rp{n:,}".replace(",", ".") if n else "Gratis"


def fmt_minutes(secs):
    return (secs + 30) // 60


def _edge_secs(etime, route, a, b):
    return etime.get(route, {}).get(a, {}).get(b, 0)


def _edge_dist(dist, route, a, b):
    return dist.get(route, {}).get(a, {}).get(b, 1)


def _fare_after_take(fare_table, route, xtype, brt_paid):
    if xtype == "w":
        brt_paid = False
    price, klass = fare_table.get(route, (0, "?"))
    if klass in BRT_FARES:
        if not brt_paid:
            return price, True
        return 0, True
    if klass in PREMIUM_FARES:
        return price, brt_paid
    return 0, brt_paid


def _dominates_goal(a, b):
    return a[0] <= b[0] and a[1] <= b[1] and a[2] <= b[2] and a[3] <= b[3]


def find_goal(origin, dest, data, goal, allowed=None):
    stop_name, name_stops, _rname, ride, routes_at = data[:5]
    xfer = data[5] if len(data) > 5 else {}
    etime = data[6] if len(data) > 6 else {}
    dist = data[7] if len(data) > 7 else {}
    fare_table = data[8] if len(data) > 8 else {}
    rtype = data[9] if len(data) > 9 else {}
    o, d = origin.lower(), dest.lower()
    origins = sorted(s for s, n in stop_name.items() if o in n.lower())
    dests = {s for s, n in stop_name.items() if d in n.lower()}
    if not origins or not dests:
        return None

    seq = count()
    pq = []
    for s in origins:
        path = [("board", s, None, None, None)]
        heapq.heappush(pq, (0, 0, 0, 0, next(seq), s, None, False, False, path))

    best = defaultdict(list)
    seen = 0
    while pq and seen < 500000:
        seen += 1
        cost, walk_m, tr, st, _sq, stop, route, brt_paid, ridden, path = heapq.heappop(pq)
        key = (stop, route, brt_paid) if goal == "fare" else (stop, route)
        if any(_dominates_goal(old, (cost, walk_m, tr, st)) for old in best[key]):
            continue
        best[key].append((cost, walk_m, tr, st))

        if stop in dests:
            return tr, st, path, cost

        if route is not None:
            for nxt in sorted(ride[route].get(stop, ())):
                add = _edge_dist(dist, route, stop, nxt) if goal == "dist" else (1 if goal == "simple" else 0)
                npath = path + [("ride", nxt, route, None, None)]
                nsq = next(seq)
                heapq.heappush(pq, (cost + add, walk_m, tr, st + 1, nsq, nxt, route, brt_paid, True, npath))

        if route is not None and not ridden:
            continue
        for s2, xtype, xdist in _targets(stop, stop_name, name_stops, xfer):
            if route is None and xtype != "s" and s2 not in dests:
                continue
            ntr = tr if route is None else tr + 1
            walk_add = (xdist or 0) if xtype == "w" else 0
            xcost = walk_add if goal == "dist" else 0
            if s2 in dests and s2 != stop:
                npath = path + [("xfer", s2, None, xtype, xdist)]
                nsq = next(seq)
                heapq.heappush(pq, (cost + xcost, walk_m + walk_add, ntr, st, nsq, s2, None, brt_paid, False, npath))
                continue
            for r2 in sorted(r for r in routes_at[s2] if _allowed(r, rtype, allowed)):
                if r2 == route and s2 == stop:
                    continue
                add, paid = 0, brt_paid
                if goal == "fare":
                    add, paid = _fare_after_take(fare_table, r2, xtype, brt_paid)
                elif goal == "simple":
                    add = 0 if route is None else WEIGHT
                elif goal == "dist":
                    add = walk_add
                if ntr > MAX_GOAL_TRANSFERS:
                    continue
                npath = path + [("take", s2, r2, xtype, xdist)]
                nsq = next(seq)
                heapq.heappush(pq, (cost + add, walk_m + walk_add, ntr, st, nsq, s2, r2, paid, False, npath))
    return None


def find_goals(origin, dest, data, allowed=None):
    return {
        "fare": find_goal(origin, dest, data, "fare", allowed),
        "simple": find_goal(origin, dest, data, "simple", allowed),
        "dist": find_goal(origin, dest, data, "dist", allowed),
    }


def _walk_m(path):
    return sum((xdist or 0) for kind, _stop, _route, xtype, xdist in path if kind in ("take", "xfer") and xtype == "w")


def render(res, data):
    stop_name, _, rname = data[:3]
    etime, fare_table = data[6], data[8]
    if not res:
        print("No route found.")
        return
    transfers, stops, path = res
    secs, rupiah = route_cost(path, etime, fare_table)
    print(f"Route found: {transfers} transfer(s), {stops} stop(s), ~{fmt_minutes(secs)} min, {fmt_fare(rupiah)}\n")
    tags = {"o": " [transfer resmi]", "w": " [jalan kaki]", "s": " [pindah peron]"}
    for kind, stop, route, xtype, xdist in path:
        nm = stop_name[stop]
        if kind == "board":
            print(f"START at {nm}")
        elif kind == "take":
            dist = f" ~{xdist}m" if xtype == "w" and xdist else ""
            print(f"  -> board  [{rname[route]}]{tags.get(xtype, '')}{dist}  at {nm}")
        elif kind == "ride":
            print(f"       ...  {nm}")
        elif kind == "xfer":
            dist = f" ~{xdist}m" if xtype == "w" and xdist else ""
            print(f"  -> transfer{tags.get(xtype, '')}{dist}  to {nm}")
    print(f"\nARRIVE at {stop_name[path[-1][1]]}")


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        sys.exit(f"usage: {sys.argv[0]} <origin> <dest> [rtype1,rtype2,...]")
    data = load()
    stop_name, _, rname, *_ = data
    allowed = set(sys.argv[3].split(",")) if len(sys.argv) == 4 else None
    routes = find(sys.argv[1], sys.argv[2], data, pareto_limit=3, allowed=allowed)
    if not routes:
        print("No route found.")
    else:
        goals = find_goals(sys.argv[1], sys.argv[2], data, allowed=allowed)
        print("Goal winners:\n")
        labels = (("fare", "Tarif terendah"), ("simple", "Paling simpel"), ("dist", "Jarak terpendek"))
        for key, label in labels:
            goal = goals[key]
            if not goal:
                continue
            tr, st, path, score = goal
            secs, rupiah = route_cost(path, data[6], data[8])
            extra = fmt_fare(score) if key == "fare" else (f"{score} cost" if key == "simple" else f"{score} m")
            print(f"- {label}: {tr} transfer(s), {st} stop(s), ~{fmt_minutes(secs)} min, {fmt_fare(rupiah)}, {_walk_m(path)} m jalan [{extra}]")
        print()
        print(f"Found {len(routes)} Pareto-optimal route(s):\n")
        for i, (tr, st, path) in enumerate(routes, 1):
            print(f"--- Option {i} ---")
            secs, rupiah = route_cost(path, data[6], data[8])
            print(f"{tr} transfer(s), {st} stop(s), ~{fmt_minutes(secs)} min, {fmt_fare(rupiah)}\n")
            tags = {"o": " [transfer resmi]", "w": " [jalan kaki]", "s": " [pindah peron]"}
            for kind, stop, route, xtype, xdist in path:
                nm = stop_name[stop]
                if kind == "board":
                    print(f"START at {nm}")
                elif kind == "take":
                    dist = f" ~{xdist}m" if xtype == "w" and xdist else ""
                    print(f"  -> board  [{rname[route]}]{tags.get(xtype, '')}{dist}  at {nm}")
                elif kind == "ride":
                    print(f"       ...  {nm}")
                elif kind == "xfer":
                    dist = f" ~{xdist}m" if xtype == "w" and xdist else ""
                    print(f"  -> transfer{tags.get(xtype, '')}{dist}  to {nm}")
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
    takes = [(k, ty) for (k, s, r, ty, xd) in path if k == "take"]
    assert takes and takes[-1][1] == "w", ("walk type missing", takes)
    # verify distance in path
    walk_take = [(k, s, r, ty, xd) for (k, s, r, ty, xd) in path if k == "take" and ty == "w"]
    assert walk_take and walk_take[0][4] == 120, ("walk distance missing", walk_take)
    print("xfer selftest ok")

    et = {
        "R1": {"a": {"b": 90}, "b2": {"c": 120}},
        "R2": {"b": {"c": 60}},
        "GR": {"d": {"e": 30}},
        "PP": {"d": {"e": 45}},
    }
    ft = {"R1": (3500, "FP"), "R2": (3500, "FP2"), "GR": (0, "GR"), "PP": (20000, "PP")}
    p_same = [
        ("board", "a", None, None, None),
        ("take", "a", "R1", None, None),
        ("ride", "b", "R1", None, None),
        ("take", "b", "R2", "s", 0),
        ("ride", "c", "R2", None, None),
    ]
    assert route_cost(p_same, et, ft) == (390, 3500), route_cost(p_same, et, ft)
    p_walk = [
        ("board", "a", None, None, None),
        ("take", "a", "R1", None, None),
        ("ride", "b", "R1", None, None),
        ("take", "b2", "R1", "w", 0),
        ("ride", "c", "R1", None, None),
    ]
    assert route_cost(p_walk, et, ft)[1] == 7000, route_cost(p_walk, et, ft)
    p_walk_gr_brt = [
        ("board", "a", None, None, None),
        ("take", "a", "R1", None, None),
        ("ride", "b", "R1", None, None),
        ("take", "d", "GR", "w", 0),
        ("ride", "e", "GR", None, None),
        ("take", "b", "R2", "s", 0),
        ("ride", "c", "R2", None, None),
    ]
    assert route_cost(p_walk_gr_brt, et, ft)[1] == 7000, route_cost(p_walk_gr_brt, et, ft)
    p_gr = [("board", "d", None, None, None), ("take", "d", "GR", None, None), ("ride", "e", "GR", None, None)]
    assert route_cost(p_gr, et, ft)[1] == 0, route_cost(p_gr, et, ft)
    p_pp = [("board", "d", None, None, None), ("take", "d", "PP", None, None), ("ride", "e", "PP", None, None)]
    assert route_cost(p_pp, et, ft)[1] == 20000, route_cost(p_pp, et, ft)
    print("cost selftest ok")

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
