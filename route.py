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
import csv, heapq, os, sys
from collections import defaultdict
from itertools import count

HERE = os.path.dirname(os.path.abspath(__file__))
GTFS = os.environ.get(
    "GTFS_DIR",
    os.path.join(HERE, "data/f-transjakarta~id/extracted"),
)


def load():
    def rows(name):
        with open(os.path.join(GTFS, name), newline="", encoding="utf-8") as f:
            yield from csv.DictReader(f)

    stop_name = {}          # stop_id -> name
    name_stops = defaultdict(list)   # name -> [stop_id]
    for r in rows("stops.txt"):
        sid, nm = r["stop_id"], r["stop_name"].strip()
        stop_name[sid] = nm
        name_stops[nm].append(sid)

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
    return stop_name, name_stops, rname, ride, routes_at


def find(origin, dest, data):
    stop_name, name_stops, rname, ride, routes_at = data[:5]
    xfer = data[5] if len(data) > 5 else {}   # {stop_id: [(nbr, type, dist), ...]}
    o, d = origin.lower(), dest.lower()
    origins = [s for s, n in stop_name.items() if o in n.lower()]
    dests = {s for s, n in stop_name.items() if d in n.lower()}
    if not origins:
        sys.exit(f"no stop matches origin '{origin}'")
    if not dests:
        sys.exit(f"no stop matches dest '{dest}'")

    # State = (stop, route). Cost = (transfers, stops). Board = route None.
    # heap: (transfers, stops, tiebreak, stop, route, path) -- tiebreak keeps
    # heapq from ever comparing route (may be None) or path.
    seq = count()
    pq = [(0, 0, next(seq), s, None, [("board", s, None, None)]) for s in origins]
    heapq.heapify(pq)
    best = {}  # (stop, route) -> (transfers, stops)
    while pq:
        tr, st, _, stop, route, path = heapq.heappop(pq)
        if stop in dests:
            return tr, st, path
        key = (stop, route)
        if key in best and best[key] <= (tr, st):
            continue
        best[key] = (tr, st)
        # ride one stop forward on current route
        if route is not None:
            for nxt in ride[route].get(stop, ()):
                heapq.heappush(pq, (tr, st + 1, next(seq), nxt, route,
                                    path + [("ride", nxt, route, None)]))
        # board / transfer: same-name stops (type "s") + typed xfer links.
        # Cost is +1 per transfer regardless of type; type is a label only.
        targets = [(s2, "s") for s2 in name_stops[stop_name[stop]]]
        for nb, ty, _dist in xfer.get(stop, ()):
            targets.append((nb, ty))
        for s2, xtype in targets:
            for r2 in routes_at[s2]:
                if r2 == route:
                    continue
                ntr = tr if route is None else tr + 1
                heapq.heappush(pq, (ntr, st, next(seq), s2, r2,
                                    path + [("take", s2, r2, xtype)]))
    return None


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
    render(find(sys.argv[1], sys.argv[2], data), data)


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
    tr, st, _ = find("A", "C", data)
    assert (tr, st) == (1, 2), (tr, st)   # 1 transfer at B, 2 ride-stops
    tr, st, _ = find("A", "B", data)
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
    res = find("A", "C", data2)
    assert res is not None, "A->C via walk xfer not found"
    tr, st, path = res
    assert tr == 1, ("transfers", tr)
    takes = [(k, ty) for (k, s, r, ty) in path if k == "take"]
    assert takes and takes[-1][1] == "w", ("walk type missing", takes)
    print("xfer selftest ok")
