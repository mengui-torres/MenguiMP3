"""Generate simple app icons (PNG) with no external dependencies."""
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(OUT_DIR, exist_ok=True)

BG = (108, 92, 231)      # purple
FG = (255, 255, 255)     # white triangle


def rounded_square_mask(x, y, size, radius):
    corners = [(radius, radius), (size - radius, radius),
               (radius, size - radius), (size - radius, size - radius)]
    if radius <= x < size - radius or radius <= y < size - radius:
        return True
    for cx, cy in corners:
        if (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2:
            return True
    return False


def in_triangle(px, py, size):
    # Equilateral-ish play triangle centered, pointing right
    cx, cy = size / 2, size / 2
    s = size * 0.34
    x0, y0 = cx - s * 0.5, cy - s * 0.62
    x1, y1 = cx - s * 0.5, cy + s * 0.62
    x2, y2 = cx + s * 0.75, cy

    def sign(ax, ay, bx, by, cx_, cy_):
        return (ax - cx_) * (by - cy_) - (bx - cx_) * (ay - cy_)

    d1 = sign(px, py, x0, y0, x1, y1)
    d2 = sign(px, py, x1, y1, x2, y2)
    d3 = sign(px, py, x2, y2, x0, y0)
    has_neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    has_pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (has_neg and has_pos)


def make_icon(size, radius_ratio=0.22, maskable=False):
    radius = int(size * (0 if maskable else radius_ratio))
    pad = int(size * 0.18) if maskable else 0  # keep glyph inside safe zone for maskable
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            if maskable or rounded_square_mask(x, y, size, radius):
                if in_triangle(x, y, size):
                    r, g, b = FG
                else:
                    r, g, b = BG
                a = 255
            else:
                r, g, b, a = 0, 0, 0, 0
            row += bytes((r, g, b, a))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    raw = bytearray()
    for row in rows:
        raw += b"\x00" + row
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(sig)
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", idat))
        f.write(chunk(b"IEND", b""))


for size, name, maskable in [
    (192, "icon-192.png", False),
    (512, "icon-512.png", False),
    (512, "icon-maskable-512.png", True),
    (180, "apple-touch-icon.png", False),
]:
    rows = make_icon(size, maskable=maskable)
    out_path = os.path.abspath(os.path.join(OUT_DIR, name))
    write_png(out_path, size, rows)
    print("wrote", out_path)
