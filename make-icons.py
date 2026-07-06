#!/usr/bin/env python3
"""Generate app icons (pure stdlib, no deps) — Termux gak ada PIL/ImageMagick.

Gambar glyph "JT" putih geometris di background biru full-bleed (aman maskable:
launcher tinggal masking sudut). Bentuk letter = kumpulan rect (J pakai hook
kotak, bukan kurva) — sengaja geometris. Ganti pakai logo asli sebelum submit Play.

Usage: python3 make-icons.py   -> web/icons/icon-192.png, icon-512.png
"""
import os, struct, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "web/icons")
BG = (11, 107, 203)      # #0b6bcb (theme_color)
FG = (255, 255, 255)     # putih


def rects(S):
    """Kotak-kotak (x0,y0,x1,y1) buat 'JT', koordinat skala ke ukuran S."""
    w = 0.085 * S              # tebal stroke
    y0, y1 = 0.30 * S, 0.70 * S  # tinggi huruf
    out = []
    # --- J (kiri) ---
    jx0, jx1 = 0.30 * S, 0.46 * S
    out.append((jx1 - w, y0, jx1, y1 - w))          # stem kanan
    out.append((jx0, y1 - w, jx1, y1))              # bar bawah
    out.append((jx0, y1 - 2.1 * w, jx0 + w, y1))    # upcurl kiri
    # --- T (kanan) ---
    tx0, tx1 = 0.52 * S, 0.70 * S
    txc = (tx0 + tx1) / 2
    out.append((tx0, y0, tx1, y0 + w))              # bar atas
    out.append((txc - w / 2, y0, txc + w / 2, y1))  # stem tengah
    return out


def render(S):
    px = bytearray(BG[i] for _ in range(S * S) for i in range(3))  # flat RGB, bg
    for (x0, y0, x1, y1) in rects(S):
        xa, xb = max(0, int(x0)), min(S, int(round(x1)))
        ya, yb = max(0, int(y0)), min(S, int(round(y1)))
        for y in range(ya, yb):
            base = (y * S + xa) * 3
            for x in range(xb - xa):
                o = base + x * 3
                px[o], px[o + 1], px[o + 2] = FG
    return bytes(px)


def write_png(path, S):
    raw = render(S)
    # tambah filter byte 0 tiap scanline
    stride = S * 3
    lines = b"".join(b"\x00" + raw[i:i + stride] for i in range(0, len(raw), stride))

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", S, S, 8, 2, 0, 0, 0)  # 8-bit truecolor RGB
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", zlib.compress(lines, 9)) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    return png


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for S in (192, 512):
        p = os.path.join(OUT_DIR, f"icon-{S}.png")
        png = write_png(p, S)
        # self-check: signature + IHDR dims cocok + non-kosong
        assert png[:8] == b"\x89PNG\r\n\x1a\n", "bad PNG signature"
        w, h = struct.unpack(">II", png[16:24])
        assert (w, h) == (S, S), f"dim mismatch {w}x{h} != {S}"
        assert len(png) > 200, "PNG too small"
        print(f"wrote {p}: {S}x{S}, {len(png)} bytes")


if __name__ == "__main__":
    main()
