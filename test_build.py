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

    # 3. halte acuan ada
    assert "Pancoran Arah Barat" in data["stops"], "Pancoran Arah Barat hilang"

    print("test_build ok:", len(data["stops"]), "stops,", len(data["routes"]), "routes")


if __name__ == "__main__":
    main()
