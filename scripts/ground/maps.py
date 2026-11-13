"""
The ground's flat maps for build.py: which surface is where (zone and albedo maps), the road paint, and how the
baked light is stored (sRGB, dithered, PNG or WebP). Plain numpy, no Blender, so it runs in any Python with numpy.

Rows of every array here run from the low edge of its rect upwards (row 0 = z0 = uv.y 0, like Blender's pixels);
the writers flip them, because an image file starts at its top row (uv.y 1 once three.js flips it on load).
"""
import os
import struct
import subprocess
import zlib

import numpy as np

# Surface classes; index 0 (plain pavers) is black in the zone maps, the others are its R, G and B.
CLASSES = ['pavers', 'stone', 'asphalt', 'planting']


def hex_lin(h):
    """sRGB hex colour -> linear RGB."""
    h = h.lstrip('#')
    return srgb_decode(np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]))


def srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def srgb_decode(x):
    return np.where(x <= 0.04045, x / 12.92, np.power((x + 0.055) / 1.055, 2.4))


def to8(x):
    return np.clip(np.round(x * 255), 0, 255).astype(np.uint8)


# ---------------------------------------------------------------- shapes (site x, z)
def line_of(sh):
    """The {a, b, w, dash} of a line shape: a paint line itself, or a surface's seg."""
    return sh['seg'] if 'seg' in sh else sh


def bbox(sh):
    if 'rect' in sh:
        x0, z0, x1, z1 = sh['rect']
        return min(x0, x1), min(z0, z1), max(x0, x1), max(z0, z1)
    if 'circle' in sh or 'ring' in sh:
        c = sh.get('circle') or sh['ring']
        return c[0] - c[-1], c[1] - c[-1], c[0] + c[-1], c[1] + c[-1]
    if 'poly' in sh:
        p = np.array(sh['poly'])
        return p[:, 0].min(), p[:, 1].min(), p[:, 0].max(), p[:, 1].max()
    ln = line_of(sh)
    (ax, az), (bx, bz), r = ln['a'], ln['b'], ln['w'] / 2
    return min(ax, bx) - r, min(az, bz) - r, max(ax, bx) + r, max(az, bz) + r


def inside(sh, X, Z):
    """Which of the sample points (X, Z broadcast together) the shape covers."""
    if 'rect' in sh:
        x0, z0, x1, z1 = bbox(sh)
        return (X >= x0) & (X <= x1) & (Z >= z0) & (Z <= z1)
    if 'circle' in sh:
        cx, cz, r = sh['circle']
        return (X - cx) ** 2 + (Z - cz) ** 2 <= r * r
    if 'ring' in sh:
        cx, cz, r0, r1 = sh['ring']
        d = (X - cx) ** 2 + (Z - cz) ** 2
        return (d >= r0 * r0) & (d <= r1 * r1)
    if 'poly' in sh:
        poly = sh['poly']
        m = np.zeros(np.broadcast(X, Z).shape, dtype=bool)
        j = len(poly) - 1
        for i in range(len(poly)):
            (xi, zi), (xj, zj) = poly[i], poly[j]
            if zi != zj:
                m ^= ((zi > Z) != (zj > Z)) & (X < (xj - xi) * (Z - zi) / (zj - zi) + xi)
            j = i
        return m
    ln = line_of(sh)
    (ax, az), (bx, bz) = ln['a'], ln['b']
    length = np.hypot(bx - ax, bz - az)
    ux, uz = (bx - ax) / length, (bz - az) / length
    t = (X - ax) * ux + (Z - az) * uz
    d = -(X - ax) * uz + (Z - az) * ux
    m = (t >= 0) & (t <= length) & (np.abs(d) <= ln['w'] / 2)
    if ln.get('dash'):
        on, off = ln['dash']
        m &= np.mod(t, on + off) < on
    return m


def _span(coords, lo, hi):
    """Index range of the (sorted) sample coordinates within [lo, hi]."""
    return int(np.searchsorted(coords, lo, 'left')), int(np.searchsorted(coords, hi, 'right'))


# ---------------------------------------------------------------- surfaces: class and tone, painted in order
def palette(L):
    """Linear palette, [class, stop, rgb]."""
    return np.array([[hex_lin(c) for c in L['palette'][name]] for name in CLASSES])


def palette_colour(pal, cls, tone):
    """Linear albedo of class cls at tone (0..1, linear between the 5 stops)."""
    t = np.clip(tone, 0, 1) * 4
    i = np.minimum(np.floor(t).astype(int), 3)
    f = (t - i)[..., None]
    return pal[cls, i] * (1 - f) + pal[cls, i + 1] * f


def classify_grid(L, xs, zs):
    """Class index and tone at every sample of the grid (columns xs, rows zs); later surfaces win."""
    cls = np.zeros((len(zs), len(xs)), np.int8)
    tone = np.zeros((len(zs), len(xs)), np.float32)
    for s in L['surfaces']:
        x0, z0, x1, z1 = bbox(s)
        c0, c1 = _span(xs, x0, x1)
        r0, r1 = _span(zs, z0, z1)
        if c0 >= c1 or r0 >= r1:
            continue
        k = CLASSES.index(s['cls'])
        if 'rect' in s:
            cls[r0:r1, c0:c1] = k
            tone[r0:r1, c0:c1] = s['tone']
            continue
        m = inside(s, xs[None, c0:c1], zs[r0:r1, None])
        cls[r0:r1, c0:c1][m] = k
        tone[r0:r1, c0:c1][m] = s['tone']
    return cls, tone


def classify_points(L, X, Z):
    """Class index and tone at single points (arrays of the same shape)."""
    cls = np.zeros(X.shape, np.int8)
    tone = np.zeros(X.shape, np.float32)
    for s in L['surfaces']:
        m = inside(s, X, Z)
        cls[m] = CLASSES.index(s['cls'])
        tone[m] = s['tone']
    return cls, tone


def region_maps(L, rect, size, ss=4):
    """Zone weights (R stone, G asphalt, B planting) and linear albedo of each pixel of a rect, each pixel the mean of
    ss × ss samples (anti-aliased edges). Worked through in bands of rows to keep the memory small."""
    W, H = size
    x0, z0, x1, z1 = rect
    pal = palette(L)
    xs = x0 + (np.arange(W * ss) + 0.5) / (W * ss) * (x1 - x0)
    zones = np.zeros((H, W, 3), np.float32)
    albedo = np.zeros((H, W, 3), np.float32)
    band = 64
    for r in range(0, H, band):
        n = min(band, H - r)
        zs = z0 + (np.arange(r * ss, (r + n) * ss) + 0.5) / (H * ss) * (z1 - z0)
        cls, tone = classify_grid(L, xs, zs)
        for k in range(3):
            zones[r:r + n, :, k] = (cls == k + 1).reshape(n, ss, W, ss).mean(axis=(1, 3))
        # Few distinct (class, tone) pairs: colour each pair once, then look the samples up.
        key = cls.astype(np.int32) * 10000 + np.round(tone * 9999).astype(np.int32)
        uniq, inv = np.unique(key, return_inverse=True)
        cols = palette_colour(pal, uniq // 10000, (uniq % 10000) / 9999).astype(np.float32)
        albedo[r:r + n] = cols[inv.reshape(key.shape)].reshape(n, ss, W, ss, 3).mean(axis=(1, 3))
    return zones, albedo


def paint_map(L, ss=4):
    """Road paint coverage: R white, G yellow. The upper half of the rows is paintMap.top, the lower half .bottom."""
    pm = L['paintMap']
    W, H = pm['size']
    half = H // 2
    out = np.zeros((H, W, 3), np.float32)
    for row0, rect in ((0, pm['bottom']), (half, pm['top'])):
        x0, z0, x1, z1 = rect
        xs = x0 + (np.arange(W * ss) + 0.5) / (W * ss) * (x1 - x0)
        zs = z0 + (np.arange(half * ss) + 0.5) / (half * ss) * (z1 - z0)
        cov = np.zeros((2, half * ss, W * ss), bool)
        for p in L['paint']:
            bx0, bz0, bx1, bz1 = bbox(p)
            c0, c1 = _span(xs, bx0, bx1)
            r0, r1 = _span(zs, bz0, bz1)
            if c0 < c1 and r0 < r1:
                cov[0 if p['c'] == 'white' else 1, r0:r1, c0:c1] |= inside(p, xs[None, c0:c1], zs[r0:r1, None])
        for k in range(2):
            out[row0:row0 + half, :, k] = cov[k].reshape(half, ss, W, ss).mean(axis=(1, 3))
    return out


# ---------------------------------------------------------------- storing light
def blue_noise(n=64, seed=1):
    """A tile of blue-ish noise, evenly spread over [0, 1): white noise minus its blur (so no low frequencies, which
    would show as blotches), ranked so every level is equally common."""
    w = np.random.default_rng(seed).random((n, n))
    f = np.fft.fftfreq(n)
    k = np.exp(-(f[:, None] ** 2 + f[None, :] ** 2) * (2 * np.pi * 1.5) ** 2 / 2)
    hp = w - np.real(np.fft.ifft2(np.fft.fft2(w) * k))
    rank = np.argsort(np.argsort(hp.ravel())).reshape(n, n)
    return (rank + 0.5) / (n * n)


def encode_light(light, scale, noise):
    """Light (linear) -> 8-bit sRGB of light / scale, with ±0.5 step of blue noise against banding."""
    h, w = light.shape[:2]
    tile = np.tile(noise, (h // noise.shape[0] + 1, w // noise.shape[1] + 1))[:h, :w, None]
    v = srgb(light / scale) * 255 + tile - 0.5
    return np.clip(np.round(v), 0, 255).astype(np.uint8)


def decode_light(rgb8, scale):
    return srgb_decode(rgb8.astype(np.float32) / 255) * scale


def _png_rows(a):
    """PNG row filtering: per row, the filter (none, sub, up, average, Paeth) that leaves the smallest numbers."""
    h = a.shape[0]
    a = a.reshape(h, -1).astype(np.int16)
    left = np.zeros_like(a)
    left[:, 3:] = a[:, :-3]
    up = np.zeros_like(a)
    up[1:] = a[:-1]
    ul = np.zeros_like(a)
    ul[1:, 3:] = a[:-1, :-3]
    p = left + up - ul
    pa, pb, pc = np.abs(p - left), np.abs(p - up), np.abs(p - ul)
    paeth = np.where((pa <= pb) & (pa <= pc), left, np.where(pb <= pc, up, ul))
    cands = np.stack([a, a - left, a - up, a - (left + up) // 2, a - paeth]) % 256
    score = np.minimum(cands, 256 - cands).sum(axis=2)
    best = score.argmin(axis=0)
    rows = cands[best, np.arange(h)].astype(np.uint8)
    return np.concatenate([best[:, None].astype(np.uint8), rows], axis=1).tobytes()


def write_atomic(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(data)
    os.replace(tmp, path)


def write_png(path, rgb8):
    """8-bit RGB PNG, no alpha. rgb8 rows bottom-up (see the top of this file)."""
    rgb8 = np.ascontiguousarray(rgb8[::-1])
    h, w = rgb8.shape[:2]

    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)

    write_atomic(path, b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                 + chunk(b'IDAT', zlib.compress(_png_rows(rgb8), 9)) + chunk(b'IEND', b''))


def write_webp(path, rgb8, quality, ffmpeg='ffmpeg'):
    """Lossy WebP through ffmpeg (libwebp). rgb8 rows bottom-up."""
    h, w = rgb8.shape[:2]
    tmp = path[:-5] + '.tmp.webp'
    subprocess.run([ffmpeg, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{w}x{h}', '-i', '-',
                    '-c:v', 'libwebp', '-quality', str(quality), '-compression_level', '6', tmp],
                   input=np.ascontiguousarray(rgb8[::-1]).tobytes(), check=True)
    os.replace(tmp, path)


def read_image(path, w, h, ffmpeg='ffmpeg'):
    """An image file decoded back to 8-bit RGB, rows bottom-up (to check what the browser will get)."""
    out = subprocess.run([ffmpeg, '-loglevel', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(out, np.uint8).reshape(h, w, 3)[::-1]


def sample(img, rect, x, z):
    """Bilinear sample of a map (rows bottom-up, pixel centres) at site points x, z."""
    h, w = img.shape[:2]
    x0, z0, x1, z1 = rect
    u = np.clip((np.asarray(x) - x0) / (x1 - x0) * w - 0.5, 0, w - 1)
    v = np.clip((np.asarray(z) - z0) / (z1 - z0) * h - 0.5, 0, h - 1)
    i0 = np.minimum(np.floor(u).astype(int), w - 2)
    j0 = np.minimum(np.floor(v).astype(int), h - 2)
    fu = (u - i0)[..., None]
    fv = (v - j0)[..., None]
    a = img[j0, i0].astype(np.float64)
    b = img[j0, i0 + 1].astype(np.float64)
    c = img[j0 + 1, i0].astype(np.float64)
    d = img[j0 + 1, i0 + 1].astype(np.float64)
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv
