#!/usr/bin/env python3
from collections import defaultdict

from route import find_alternative, find_goals


def test_mini_alternative():
    stop_name = {0: "A", 1: "D", 2: "C", 3: "B", 4: "X", 5: "Y", 6: "Z"}
    name_stops = defaultdict(list)
    for sid, name in stop_name.items():
        name_stops[name].append(sid)
    rname = {0: "Goal1", 1: "Goal2", 2: "AltBrt", 3: "Micro"}
    ride = defaultdict(lambda: defaultdict(set))
    ride[0][0].add(1)
    ride[1][1].add(2)
    ride[2][3].add(2)
    ride[3][3].add(4)
    ride[3][4].add(5)
    ride[3][5].add(6)
    ride[3][6].add(2)
    routes_at = defaultdict(set)
    for route, adj in ride.items():
        for stop, nexts in adj.items():
            routes_at[stop].add(route)
            for nxt in nexts:
                routes_at[nxt].add(route)
    xfer = {1: [(1, "s", 0)]}
    etime = {
        0: {0: {1: 60}},
        1: {1: {2: 60}},
        2: {3: {2: 300}},
        3: {3: {4: 1}, 4: {5: 1}, 5: {6: 1}, 6: {2: 1}},
    }
    dist = {}
    fare = {0: (3500, "FP"), 1: (3500, "FP"), 2: (3500, "FP"), 3: (0, "GR")}
    rtype = {0: "BRT", 1: "BRT", 2: "BRT", 3: "Mikrotrans"}
    stop_lat = {0: 0, 1: 0, 2: 0, 3: 0, 4: 1, 5: 1, 6: 1}
    stop_lon = {0: 0, 1: 0.01, 2: 0.011, 3: 0.003, 4: 1, 5: 1, 6: 1}
    data = (stop_name, name_stops, rname, ride, routes_at, xfer, etime, dist, fare, rtype, stop_lat, stop_lon)

    goals = find_goals("A", "C", data)
    alt = find_alternative("A", "C", data, goals)
    assert alt is not None
    tr, stops, path = alt
    assert (tr, stops) == (0, 1)
    assert path[1] == ("access", 3, None, "w", 334)
    assert path[2] == ("take", 3, 2, "s", 0)


def test_dest_exact_name():
    """Regresi v1.11.1: tujuan harus exact-name, bukan substring.
    'Ragunan' JANGAN ketangkep 'Simpang Ragunan Ar-Raudhah'."""
    try:
        import route
        data = route.load()
    except Exception as e:  # GTFS data belum di-fetch → skip, bukan gagal
        print("test-route-alt: skip real-data (", e, ")")
        return
    stop_name = data[0]
    goals = find_goals("Simpang Kuningan", "Ragunan", data, allowed={"BRT"})
    alt = find_alternative("Simpang Kuningan", "Ragunan", data, goals, allowed={"BRT"})
    assert alt is not None, "alternatif Simpang Kuningan->Ragunan hilang"
    last = alt[2][-1]
    assert stop_name[last[1]] == "Ragunan", f"turun di halte salah: {stop_name[last[1]]!r}"


def test_no_ghost_leg():
    """Regresi leg-hantu: Simpang Kuningan -> CSW 1.
    Tak boleh ada take lalu ride di stasiun bernama SAMA (geser peron).
    v1.14: rute waras boleh L13E one-seat via Underpass atau 9→L13E."""
    try:
        import route as R
        data = R.load()
    except Exception as e:  # GTFS data belum di-fetch -> skip
        print("test-route-alt: skip real-data (", e, ")")
        return
    stop_name = data[0]
    goals = find_goals("Simpang Kuningan", "CSW 1", data, allowed={"BRT"})
    alt = find_alternative("Simpang Kuningan", "CSW 1", data, goals, allowed={"BRT"})
    paths = []
    for k in ("fare", "simple", "dist"):
        if goals.get(k):
            paths.append((k, goals[k][2]))
    if alt is not None:
        paths.append(("alt", alt[2]))
    assert paths, "Simpang Kuningan->CSW 1 hilang semua tab"
    for label, path in paths:
        for i in range(len(path) - 1):
            if path[i][0] == "take" and path[i + 1][0] == "ride":
                assert stop_name[path[i][1]] != stop_name[path[i + 1][1]], \
                    f"{label} leg-hantu di " + stop_name[path[i][1]]


def _assert_no_leg_revisit(stop_name, path, label):
    names = []
    for kind, stop, *_rest in path:
        if kind in ("take", "board"):
            names = [stop_name[stop]]
        elif kind == "ride":
            names.append(stop_name[stop])
            assert len(names) == len(set(names)), f"{label} leg revisits: {' → '.join(names)}"


def test_uturn_guard_and_fare_access():
    """v1.14: BRT-only Underpass Kuningan → Cawang fare waras (no U-turn + access seed)."""
    try:
        import route as R
        data = R.load()
    except Exception as e:
        print("test-route-alt: skip real-data (", e, ")")
        return
    stop_name = data[0]
    goals = find_goals("Underpass Kuningan", "Cawang", data, allowed={"BRT"})
    fare = goals["fare"]
    assert fare is not None, "fare Underpass→Cawang hilang"
    tr, st, path, cost = fare
    _assert_no_leg_revisit(stop_name, path, "fare")
    assert tr == 0, f"fare harus 0 transfer via access, got {tr}"
    assert cost == 3500, f"fare harus Rp3.500, got {cost}"
    assert any(k == "access" for k, *_ in path), "fare harus punya langkah access di awal"
    # Loop sah: tujuan di tengah trayek loop tetap dapat rute
    loop = find_goals("Underpass Kuningan", "Petukangan D'MASIV", data, allowed={"BRT"})
    assert any(loop.get(k) for k in ("fare", "simple", "dist")), "loop-legit harus tetap dapat rute"
    if loop.get("fare"):
        _assert_no_leg_revisit(stop_name, loop["fare"][2], "loop-fare")
    # Normal pair tetap ada
    for o, d in (
        ("Pancoran Arah Barat", "Komplek Polri Ragunan"),
        ("Harmoni", "Komplek Polri Ragunan"),
        ("Pancoran Arah Barat", "Kota Kasablanka"),
    ):
        g = find_goals(o, d, data)
        assert g["fare"] is not None, f"fare {o}→{d} hilang"
        _assert_no_leg_revisit(stop_name, g["fare"][2], f"normal {o}")


if __name__ == "__main__":
    test_mini_alternative()
    test_dest_exact_name()
    test_no_ghost_leg()
    test_uturn_guard_and_fare_access()
    print("test-route-alt ok")
