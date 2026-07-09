#!/usr/bin/env python3
"""Verifikasi output build-data.py cocok GTFS sumber."""
import csv, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
GTFS = os.path.join(HERE, "data/f-transjakarta~id/extracted")
OUT = os.path.join(HERE, "web/data.json")


def count_rows(name):
    with open(os.path.join(GTFS, name), newline="", encoding="utf-8") as f:
        return sum(1 for _ in csv.DictReader(f))


def main():
    subprocess.run([sys.executable, os.path.join(HERE, "build-data.py")], check=True)
    data = json.load(open(OUT, encoding="utf-8"))

    # 1. jumlah stops & routes cocok jumlah baris GTFS
    assert len(data["stops"]) == count_rows("stops.txt"), \
        (len(data["stops"]), count_rows("stops.txt"))
    assert len(data["routes"]) == count_rows("routes.txt"), \
        (len(data["routes"]), count_rows("routes.txt"))

    # 2. semua index di edges valid (dalam rentang)
    ns, nr = len(data["stops"]), len(data["routes"])
    for ri, adj in data["edges"].items():
        assert 0 <= int(ri) < nr, ri
        for si, nexts in adj.items():
            assert 0 <= int(si) < ns, si
            for nx in nexts:
                assert 0 <= nx < ns, nx

    # 2b. etime parallel to edges: per-edge ride time in seconds
    etime = data["etime"]
    assert etime, "etime missing"
    for ri, adj in data["edges"].items():
        assert ri in etime, ("etime route missing", ri)
        for si, nexts in adj.items():
            assert si in etime[ri], ("etime stop missing", ri, si)
            for nx in nexts:
                secs = etime[ri][si][str(nx)]
                assert isinstance(secs, int) and secs > 0, ("bad etime", ri, si, nx, secs)

    # 2c. fare parallel to routes: [price_int, fare_id]
    fare = data["fare"]
    assert len(fare) == nr, (len(fare), nr)
    classes = set()
    for item in fare:
        assert isinstance(item, list) and len(item) == 2, item
        price, klass = item
        assert isinstance(price, int) and price >= 0, item
        assert isinstance(klass, str) and klass, item
        classes.add(klass)
    assert "FP" in classes or "FP2" in classes, "BRT fare class missing"

    # 3. halte acuan ada
    assert "Pancoran Arah Barat" in data["stops"], "Pancoran Arah Barat hilang"

    # 4. lat/lon parallel to stops, plausible Jakarta bounds
    assert len(data["lat"]) == len(data["stops"]), (len(data["lat"]), len(data["stops"]))
    assert len(data["lon"]) == len(data["stops"]), (len(data["lon"]), len(data["stops"]))
    lats = [v for v in data["lat"] if v is not None]
    lons = [v for v in data["lon"] if v is not None]
    assert lats and all(-7.5 < v < -5.5 for v in lats), "lat out of Jakarta range"
    assert lons and all(106.0 < v < 107.5 for v in lons), "lon out of Jakarta range"

    # 5. rtype parallel to routes, non-empty strings
    assert len(data["rtype"]) == len(data["routes"]), (len(data["rtype"]), len(data["routes"]))
    assert any(v for v in data["rtype"]), "all rtype empty"

    # 6. xfer: keys & neighbor indices in range, types valid, symmetric, self-excluded
    ns = len(data["stops"])
    xfer = data["xfer"]
    seen_pair = set()
    types = set()
    for si, links in xfer.items():
        assert 0 <= int(si) < ns, si
        for nb, ty, dist in links:
            assert 0 <= nb < ns, nb
            assert nb != int(si), ("self-transfer", si)
            assert ty in ("s", "o", "w"), ty
            assert isinstance(dist, int) and dist >= 0, dist
            types.add(ty)
            seen_pair.add((int(si), nb))
    # official transfers.txt present as "o" both directions
    assert "o" in types, "no official transfers emitted"
    # symmetry: every (a,b) has (b,a)
    for a, b in seen_pair:
        assert (b, a) in seen_pair, ("asymmetric", a, b)

    # 7. snum: nomor halte BRT koridor 1-14, terverifikasi vs peta integrasi 2026-06
    import re
    snum = data["snum"]
    ns = len(data["stops"])
    for si, nums in snum.items():
        assert 0 <= int(si) < ns, si
        for n in nums:
            assert re.fullmatch(r"([1-9]|1[0-4])-\d+", n), n
    by_name = {}
    for si, nums in snum.items():
        by_name.setdefault(data["stops"][int(si)], set()).update(nums)
    expect = {
        "Kota": {"1-20", "12-6"},
        "Widya Chandra Telkomsel Arah Timur": {"9-13"},
        "Widya Chandra Telkomsel Arah Barat": {"9-13"},
        "Kejaksaan Agung": {"1-2"},          # peta: gabung ASEAN = 1-2
        "Kwitang": {"2-24"},
        "Pancoran Arah Barat": {"9-9"},
        "Museum Sejarah Jakarta": {"1-22", "12-5"},
        "Pasar Baru": {"3-16", "8-26"},
        "Jembatan Merah": {"5-4", "12-10"},
        "Tegal Mampang": {"13-1"},
        "CSW 1": {"13-4"},  # halte dipakai trayek 13E, nomor tetap milik stasiun
        "Jakarta International Stadium": {"14-10"},
    }
    for name, want in expect.items():
        assert by_name.get(name) == want, (name, by_name.get(name), want)
    # Monas: peta hanya kasih nomor koridor 1 & 2 (bukan 3)
    assert by_name.get("Monumen Nasional") == {"1-14", "2-21"}, by_name.get("Monumen Nasional")
    # varian trip malam koridor 1 (via Petojo/Pasar Santa) tak boleh dapat nomor 1-x
    assert by_name.get("Petojo") == {"3-13", "8-23"}, by_name.get("Petojo")
    assert by_name.get("Pasar Santa") == {"13-3"}, by_name.get("Pasar Santa")

    print("test_build ok:", len(data["stops"]), "stops,", len(data["routes"]), "routes,",
          len(xfer), "xfer-nodes,", len(snum), "snum-nodes")


if __name__ == "__main__":
    main()
