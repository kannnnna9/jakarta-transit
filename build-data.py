#!/usr/bin/env python3
"""Ubah GTFS extracted -> web/data.json (lihat spec Bagian 5).

Struktur output:
  stops:  [nama, ...]                       # index -> nama halte
  routes: ["short (long)", ...]             # index -> label koridor
  edges:  {"routeIdx": {"stopIdx": [nextStopIdx, ...]}}  # adjacency berarah
"""
import csv, json, os
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
GTFS = os.environ.get("GTFS_DIR", os.path.join(HERE, "data/f-transjakarta~id/extracted"))
OUT = os.environ.get("OUT", os.path.join(HERE, "web/data.json"))


def rows(name):
    with open(os.path.join(GTFS, name), newline="", encoding="utf-8") as f:
        yield from csv.DictReader(f)


def main():
    stop_idx, stop_names = {}, []
    for r in rows("stops.txt"):
        stop_idx[r["stop_id"]] = len(stop_names)
        stop_names.append(r["stop_name"].strip())

    route_idx, route_labels = {}, []
    for r in rows("routes.txt"):
        short = r["route_short_name"].strip()
        long = r["route_long_name"].strip()
        route_idx[r["route_id"]] = len(route_labels)
        route_labels.append(f"{short} ({long})" if long else short)

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
    data = {"stops": stop_names, "routes": route_labels, "edges": edges_out}

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    edge_nodes = sum(len(a) for a in edges_out.values())
    print(f"wrote {OUT}: {len(stop_names)} stops, {len(route_labels)} routes, "
          f"{edge_nodes} edge-nodes")


if __name__ == "__main__":
    main()
