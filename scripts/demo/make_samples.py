#!/usr/bin/env python3
"""Soft gradient placeholder images for the demo client's media (standard library only)."""
import struct, sys, zlib, math, os

def png(path, w, h, a, b):
    rows = bytearray()
    for y in range(h):
        rows.append(0)
        for x in range(w):
            t = (x / w * 0.6 + y / h * 0.4)
            v = 0.5 + 0.5 * math.sin((x + y) / 90.0)
            rows += bytes(int(a[i] * (1 - t) + b[i] * t - 12 * v) for i in range(3))
    def chunk(k, d):
        return struct.pack('>I', len(d)) + k + d + struct.pack('>I', zlib.crc32(k + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(rows), 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
palette = [((217, 210, 199), (110, 115, 96)), ((246, 228, 226), (122, 112, 89)), ((239, 234, 226), (63, 59, 53)), ((182, 188, 173), (247, 244, 239))]
for i, (a, b) in enumerate(palette, 1):
    png(os.path.join(out, f'HarperLee_Engagement_{i:03d}.png'), 1600, 1067, a, b)
