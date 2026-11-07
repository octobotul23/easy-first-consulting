"""
Geometry for build.py, in the site's axes (x right, y up, z towards the street camera, metres): the ground cells and
their vertical faces (kerbs, risers, podium walls), and the props (palms, poles, lanterns, bollards, lamps, boxes).

Everything is made with shared points where faces meet, so no merge pass is needed, and a face's points are
listed anticlockwise seen from the side it faces (Blender bakes light on that side; three.js shows the back darker).
"""
import math
import random
from contextlib import contextmanager

import bmesh
import bpy
import numpy as np
from mathutils import Vector

UP = Vector((0, 1, 0))


def B(x, y, z):
    """Site axes -> Blender axes (a rotation, so faces keep their side)."""
    return Vector((x, -z, y))


def V(*p):
    return Vector(p[0] if len(p) == 1 else p)


class Builder:
    """Faces with a per-corner colour and a per-point _FACE value (which way a stone face looks), made into one object.
    tag() records which polygons and how many triangles each kind of thing adds."""

    def __init__(self, name, color='albedo'):
        self.name = name
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new(color)
        self.kind = self.bm.verts.layers.float.new('_FACE')
        self.uv = None
        self.polys = 0
        self.tris = {}
        self.tags = {}
        self._tag = None

    @contextmanager
    def tag(self, name):
        start, outer = self.polys, self._tag
        self._tag = name
        yield
        self._tag = outer
        self.tags.setdefault(name, []).append((start, self.polys))

    def vert(self, p, face=0):
        v = self.bm.verts.new(B(*p))
        v[self.kind] = face
        return v

    def poly(self, vs, rgb, smooth=False, mat=0, uvs=None):
        f = self.bm.faces.new(vs)
        f.smooth = smooth
        f.material_index = mat
        for i, lp in enumerate(f.loops):
            lp[self.col] = (*rgb, 1)
            if uvs:
                lp[self.uv].uv = uvs[i]
        self.polys += 1
        if self._tag:
            self.tris[self._tag] = self.tris.get(self._tag, 0) + len(vs) - 2
        return f

    def grid(self, o, u, v, nu, nv, rgb, face=0):
        """The rectangle o + s·u + t·v (facing u × v) in nu × nv quads."""
        o, u, v = V(o), V(u), V(v)
        rows = [[self.vert(o + u * (i / nu) + v * (j / nv), face) for i in range(nu + 1)] for j in range(nv + 1)]
        for j in range(nv):
            for i in range(nu):
                self.poly([rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]], rgb)

    def box(self, c, s, rgb, ry=0.0, seg=None, tile=False, bottom=False, back=True):
        """Box centred at c (x, y, z), size s (w, h, d), turned ry radians about y. No bottom unless asked (it stands
        on the ground). seg = the longest edge (m) of its quads, so baked light has points to land on. tile: its sides
        get _FACE 1 (facing ±z) or 2 (facing ±x) for the site's stone tile. back=False drops the -z side."""
        C = V(c)
        w, h, d = s[0] / 2, s[1] / 2, s[2] / 2
        X = Vector((math.cos(ry), 0, -math.sin(ry)))
        Z = Vector((math.sin(ry), 0, math.cos(ry)))

        def n(length):
            return max(1, math.ceil(length / seg - 1e-6)) if seg else 1

        def side(normal):
            return (1 if abs(normal.z) >= abs(normal.x) else 2) if tile else 0

        faces = [
            (C + UP * h - X * w + Z * d, X * 2 * w, -Z * 2 * d),  # top
            (C + Z * d - X * w - UP * h, X * 2 * w, UP * 2 * h),  # +z
            (C - Z * d + X * w - UP * h, -X * 2 * w, UP * 2 * h),  # -z
            (C + X * w + Z * d - UP * h, -Z * 2 * d, UP * 2 * h),  # +x
            (C - X * w - Z * d - UP * h, Z * 2 * d, UP * 2 * h),  # -x
        ]
        if bottom:
            faces.append((C - UP * h - X * w - Z * d, X * 2 * w, Z * 2 * d))
        for k, (o, u, v) in enumerate(faces):
            if k == 2 and not back:
                continue
            normal = u.cross(v).normalized()
            self.grid(o, u, v, n(u.length), n(v.length), rgb, 0 if k in (0, 5) else side(normal))

    def tube(self, path, radii, rgb, sides=8, cap=True, mat=0):
        """A tube along points (site axes) with a radius per point, smooth, capped at the end; returns its rings."""
        rings = []
        for i, p in enumerate(path):
            a = (V(path[min(i + 1, len(path) - 1)]) - V(path[max(i - 1, 0)])).normalized()
            ref = Vector((1, 0, 0)) if abs(a.x) < 0.9 else Vector((0, 0, 1))
            u = a.cross(ref).normalized()
            v = a.cross(u).normalized()
            # (u, v, a) is right-handed, so the ring runs anticlockwise about the tube and its quads face out.
            rings.append([self.vert(V(p) + (u * math.cos(t) + v * math.sin(t)) * radii[i])
                          for t in (2 * math.pi * k / sides for k in range(sides))])
        for i in range(len(rings) - 1):
            for k in range(sides):
                k2 = (k + 1) % sides
                self.poly([rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]], rgb, smooth=True, mat=mat)
        if cap and radii[-1] > 0:
            self.poly(rings[-1], rgb, mat=mat)
        return rings

    def roof(self, c, r, h, rgb, sides=6):
        """A low pyramid roof on a ring of radius r at c, apex h above, with its flat underside."""
        c = V(c)
        ring = [self.vert(c + Vector((math.cos(t), 0, -math.sin(t))) * r)
                for t in (2 * math.pi * k / sides for k in range(sides))]
        apex = self.vert(c + UP * h)
        for k in range(sides):
            self.poly([ring[k], ring[(k + 1) % sides], apex], rgb)
        self.poly(ring[::-1], rgb)

    def disc(self, c, r0, r1, rgb, sides=12, down=False):
        """A flat disc (r0 = 0) or ring (r0 > 0) at c, facing up (or down)."""
        c = V(c)
        dirs = [Vector((math.cos(t), 0, -math.sin(t))) for t in (2 * math.pi * k / sides for k in range(sides))]
        outer = [self.vert(c + d * r1) for d in dirs]
        if r0 <= 0:
            self.poly(outer[::-1] if down else outer, rgb)
            return
        inner = [self.vert(c + d * r0) for d in dirs]
        for k in range(sides):
            k2 = (k + 1) % sides
            self.poly([inner[k], outer[k], outer[k2], inner[k2]], rgb)

    def strip(self, a, b, w, rgb, piece):
        """A thin bar a -> b (w wide, w/2 high) in pieces of at most `piece` metres; long faces only."""
        a, b = V(a), V(b)
        length = (b - a).length
        n = max(1, math.ceil(length / piece))
        along = (b - a) / n
        side = along.cross(UP).normalized() * (w / 2)
        up = UP * (w / 4)
        for i in range(n):
            p = a + along * i
            self.grid(p + side + up, along, -side * 2, 1, 1, rgb)  # top
            self.grid(p - side - up, along, side * 2, 1, 1, rgb)  # bottom
            self.grid(p + side - up, along, up * 2, 1, 1, rgb)
            self.grid(p - side + up, along, -up * 2, 1, 1, rgb)

    def object(self, collection, materials):
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        ob = bpy.data.objects.new(self.name, me)
        collection.objects.link(ob)
        for m in materials:
            me.materials.append(m)
        return ob


# ---------------------------------------------------------------- ground cells and their vertical faces
class Ground:
    """The ground as a grid through every edge of the height rects (and the map rects and tower parts). Each cell
    takes the height of the last rect over its centre; cells under the tower are left out (its lift notch stays).
    Where two cells differ in height, a vertical face joins them; the cells on both sides carry the face's points
    along that edge, so ground and faces meet point to point, with no cracks."""

    def __init__(self, L):
        self.L = L
        self.walk = L['levels']['walk']
        self.road = L['levels']['road']
        bx0, bz0, bx1, bz1 = L['bounds']
        xs, zs = {bx0, bx1}, {bz0, bz1}
        rects = [h['rect'] for h in L['heights']] + [r['rect'] for r in L['regions'].values()]
        rects += L['tower']['parts'] + [L['tower']['notch']]
        for x0, z0, x1, z1 in rects:
            xs.update(v for v in (x0, x1) if bx0 <= v <= bx1)
            zs.update(v for v in (z0, z1) if bz0 <= v <= bz1)
        self.xs, self.zs = sorted(xs), sorted(zs)
        near = L['regions']['near']['rect']
        self.near = near
        self.y = {}
        for i in range(len(self.xs) - 1):
            for j in range(len(self.zs) - 1):
                cx, cz = (self.xs[i] + self.xs[i + 1]) / 2, (self.zs[j] + self.zs[j + 1]) / 2
                if not any(x0 < cx < x1 and z0 < cz < z1 for x0, z0, x1, z1 in L['tower']['parts']):
                    self.y[i, j] = self.height(cx, cz)
        self._points = {}

    def height(self, x, z):
        y = self.walk
        for h in self.L['heights']:
            x0, z0, x1, z1 = h['rect']
            if x0 <= x <= x1 and z0 <= z <= z1:
                y = h['y']
        return y

    def in_near(self, x, z):
        x0, z0, x1, z1 = self.near
        return x0 <= x <= x1 and z0 <= z <= z1

    def step(self, x, z):
        """Spacing of a vertical face's points: fine inside the near light map's rect, coarse beyond."""
        return 0.25 if self.in_near(x, z) else 2.0

    def edge(self, axis, i, j):
        """Points along one grid edge: axis 'x' = the line x = xs[i] from zs[j] to zs[j+1]; 'z' = the line z = zs[j]
        from xs[i] to xs[i+1]. Split only where a vertical face runs, else just its two ends."""
        key = (axis, i, j)
        if key not in self._points:
            if axis == 'x':
                a, b = (self.xs[i], self.zs[j]), (self.xs[i], self.zs[j + 1])
                cells = ((i - 1, j), (i, j))
            else:
                a, b = (self.xs[i], self.zs[j]), (self.xs[i + 1], self.zs[j])
                cells = ((i, j - 1), (i, j))
            ya, yb = self.y.get(cells[0]), self.y.get(cells[1])
            n = 1
            if ya is not None and yb is not None and ya != yb:
                length = math.hypot(b[0] - a[0], b[1] - a[1])
                n = max(1, math.ceil(length / self.step((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) - 1e-6))
            self._points[key] = [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(n + 1)]
        return self._points[key]

    def cell(self, i, j):
        """The cell's outline (x, y, z), anticlockwise seen from above."""
        y = self.y[i, j]
        loop = self.edge('z', i, j) + self.edge('x', i + 1, j)[1:] + self.edge('z', i, j + 1)[::-1][1:] \
            + self.edge('x', i, j)[::-1][1:-1]
        # The walk above runs +x then +z, which faces down in site axes (x × z = -y): reverse it.
        return [(x, y, z) for x, z in loop[::-1]]

    def cells(self, keep=None):
        """Outlines of the cells whose centre passes keep(cx, cz)."""
        out = []
        for (i, j) in sorted(self.y):
            cx, cz = (self.xs[i] + self.xs[i + 1]) / 2, (self.zs[j] + self.zs[j + 1]) / 2
            if keep is None or keep(cx, cz):
                out.append(self.cell(i, j))
        return out

    def faces(self, b, colours):
        """Vertical faces between cells of different height, into Builder b. colours(x, z, high, low) gives the
        albedo of every face piece at once (arrays: a point just inside the higher cell, the two cells' heights)."""
        strips = []
        for (i, j), y in self.y.items():
            for axis, other, normal in (('x', (i - 1, j), (-1, 0)), ('z', (i, j - 1), (0, -1))):
                y2 = self.y.get(other)
                if y2 is None or y2 == y:
                    continue
                # The face looks towards the lower cell: here, if this cell is the higher one, towards -x / -z.
                n = normal if y > y2 else (-normal[0], -normal[1])
                strips.append((self.edge(axis, i, j), min(y, y2), max(y, y2), n, 2 if axis == 'x' else 1))
        mids = [((x0 + x1) / 2 - nx * 0.05, (z0 + z1) / 2 - nz * 0.05, hi, lo)
                for pts, lo, hi, (nx, nz), _ in strips for (x0, z0), (x1, z1) in zip(pts, pts[1:])]
        cols = iter(colours(*(np.array(v) for v in zip(*mids))))
        for pts, lo, hi, (nx, nz), face in strips:
            bottom = [b.vert((x, lo, z), face) for x, z in pts]
            top = [b.vert((x, hi, z), face) for x, z in pts]
            for k in range(len(pts) - 1):
                q = [bottom[k], bottom[k + 1], top[k + 1], top[k]]
                (x0, z0), (x1, z1) = pts[k], pts[k + 1]
                # This quad faces (p1 - p0) × up = (-dz, 0, dx): flip it when that is not the way it should look.
                if (z1 - z0) * nx - (x1 - x0) * nz > 0:
                    q = q[::-1]
                b.poly(q, next(cols))


# ---------------------------------------------------------------- props
def palm(b, pm, A):
    """One palm: S-leaning tapered trunk, a dark boot, 12 V-folded saw-tooth fronds. Its top is exactly at base + h.
    Returns the trunk's axis (height above base -> point) for its uplights, and the range of its trunk's polygons."""
    r = random.Random(pm['seed'])
    x0, z0 = pm['p']
    y0, h = pm['base'], pm['h']
    yaw0 = r.uniform(0, 2 * math.pi)
    lean_dir = r.uniform(0, 2 * math.pi)
    lean = math.tan(math.radians(r.uniform(-4, 4)))

    # Fronds first, around a crown at the origin, to know how far they rise above it.
    fronds = []
    for k in range(12):
        yaw = yaw0 + 2 * math.pi * k / 12 + r.uniform(-0.15, 0.15)
        elev = math.radians(r.uniform(5, 40))
        droop = r.uniform(0.6, 1.2)
        length = 3.2 * r.uniform(0.94, 1.04)
        fold = math.radians(r.uniform(20, 35))
        hor = Vector((math.cos(yaw), 0, math.sin(yaw)))
        side = Vector((-math.sin(yaw), 0, math.cos(yaw)))
        d0 = hor * math.cos(elev) + UP * math.sin(elev)
        rows = []
        for i in range(11):
            s = i / 10
            c = d0 * (length * s) - UP * (droop * s * s)
            w = 0.42 * math.sin(math.pi * min(1.0, 0.12 + 0.95 * s)) ** 0.7 * (1 - 0.4 * s)
            if i % 2 and i < 10:
                w *= 0.55  # saw-tooth edge: alternate leaflet tips and notches
            rows.append((c - side * (w * math.cos(fold)) + UP * (w * math.sin(fold)), c,
                         c + side * (w * math.cos(fold)) + UP * (w * math.sin(fold))))
        fronds.append(rows)
    rise = max(p.y for rows in fronds for row in rows for p in row)
    top = h - rise  # height of the crown above the base
    boot = 0.6
    trunk_h = top - boot

    def axis(t):
        """Trunk axis at height t above the base: an S lean, upright at the foot and at the crown."""
        u = min(max(t / top, 0.0), 1.0)
        d = top * lean * (3 * u * u - 2 * u ** 3) / 1.5
        return Vector((x0 + math.cos(lean_dir) * d, y0 + t, z0 + math.sin(lean_dir) * d))

    def radius(t):
        u = min(max(t / trunk_h, 0.0), 1.0)
        return 0.22 + (0.16 - 0.22) * u + 0.06 * max(0.0, 1 - t / 0.5)

    rings = max(12, math.ceil(trunk_h / 0.6) + 1)
    ts = [trunk_h * i / (rings - 1) for i in range(rings)]
    first = b.polys
    b.tube([axis(t) for t in ts], [radius(t) for t in ts], A['trunk'], sides=8, cap=False)
    trunk = (first, b.polys)
    b.tube([axis(trunk_h), axis(trunk_h + boot * 0.5), axis(top)], [0.17, 0.24, 0.3], A['boot'], sides=8)
    crown = axis(top)
    for rows in fronds:
        vs = [[b.vert(crown + p) for p in row] for row in rows]
        for i in range(10):
            (l0, c0, r0), (l1, c1, r1) = vs[i], vs[i + 1]
            b.poly([l0, c0, c1, l1], A['frond'], smooth=True, mat=1)
            b.poly([c0, r0, r1, c1], A['frond'], smooth=True, mat=1)
    return axis, trunk


def uplight_spots(pm):
    """Where a palm's uplights stand (x, z), on the camera side of the trunk."""
    n = pm.get('uplights', 0)
    dirs = [(0.0, 1.0)] if n == 1 else [(-0.5, 0.866), (0.5, 0.866)][:n]
    return [(pm['p'][0] + dx * 0.8, pm['p'][1] + dz * 0.8) for dx, dz in dirs]


def pole(b, lens, pl, A, rgb):
    """Street pole: a tapered octagon (a ring every 2 m at most) with arms; returns the lamp head points."""
    x, z = pl['p']
    y0, h = pl['base'], pl['h']
    n = math.ceil(h / 2)
    b.tube([(x, y0 + h * i / n, z) for i in range(n + 1)], [0.12 + (0.065 - 0.12) * i / n for i in range(n + 1)],
           A['pole'], sides=8)
    heads = []
    for dx, dz in pl['arms']:
        arm = pl['arm']
        b.tube([(x, y0 + h - 0.6, z), (x + dx * arm * 0.4, y0 + h - 0.12, z + dz * arm * 0.4),
                (x + dx * arm, y0 + h - 0.06, z + dz * arm)], [0.05, 0.04, 0.035], A['pole'], sides=6, cap=False)
        hx, hz = x + dx * arm, z + dz * arm
        ry = math.atan2(-dz, dx)
        b.box((hx, y0 + h - 0.08, hz), (0.75, 0.1, 0.32), A['pole'], ry, bottom=True)
        lens.box((hx, y0 + h - 0.14, hz), (0.62, 0.02, 0.24), rgb, ry, bottom=True)
        heads.append((hx, y0 + h, hz))
    return heads


def lantern(b, lens, ln, A, rgb, plate=None):
    """4.5 m lantern: plinth, slim pole, a hexagonal glass head under a low roof.
    plate: the builder for the head's bottom plate (default b). The bake passes one whose objects cast no shadow, so
    the plate does not shade the pool under its own light, which sits in the glass above it."""
    x, z = ln['p']
    y0, h = ln['base'], ln['h']
    b.tube([(x, y0, z), (x, y0 + 0.5, z)], [0.1, 0.09], A['bronze'], sides=8)
    b.tube([(x, y0 + 0.5, z), (x, y0 + 2.2, z), (x, y0 + h - 0.6, z)], [0.055, 0.05, 0.045], A['bronze'], sides=8)
    (plate or b).disc((x, y0 + h - 0.6, z), 0, 0.17, A['bronze'], sides=6, down=True)
    lens.tube([(x, y0 + h - 0.58, z), (x, y0 + h - 0.12, z)], [0.17, 0.21], rgb, sides=6, cap=False)
    b.roof((x, y0 + h - 0.12, z), 0.27, 0.12, A['bronze'])


def bollard(b, lens, bl, A, rgb):
    """Lit bollard: hexagonal post, a light band, a hood over it."""
    x, z = bl['p']
    y0, h = bl['base'], bl['h']
    b.tube([(x, y0, z), (x, y0 + h - 0.17, z)], [0.095, 0.095], A['bronze'], sides=6)
    lens.tube([(x, y0 + h - 0.17, z), (x, y0 + h - 0.07, z)], [0.08, 0.08], rgb, sides=6, cap=False)
    b.tube([(x, y0 + h - 0.07, z), (x, y0 + h, z)], [0.12, 0.12], A['bronze'], sides=6)
    b.disc((x, y0 + h - 0.07, z), 0, 0.12, A['bronze'], sides=6, down=True)


def steel_bollard(b, bl, A):
    """Brushed steel anti-ram bollard, Ø0.22 × 0.9 m, slightly domed."""
    x, z = bl['p']
    y0, h = bl['base'], bl['h']
    b.tube([(x, y0, z), (x, y0 + h - 0.03, z), (x, y0 + h, z)], [0.11, 0.11, 0.08], A['steel'], sides=12)


def cap(b, lens, cp, A, rgb):
    """Flush retractable cap: a steel disc in the paving with an LED ring."""
    x, z = cp['p']
    y0 = cp['base']
    b.disc((x, y0 + 0.01, z), 0, 0.14, A['steel'])
    lens.disc((x, y0 + 0.012, z), 0.14, 0.165, rgb)


def lamp(b, lens, lp, A, rgb):
    """3.5 m quay lamp of the necklace: plinth, pole, hexagonal glass head, low roof."""
    x, z = lp['p']
    y0, h = lp['base'], lp['h']
    b.tube([(x, y0, z), (x, y0 + 0.4, z)], [0.1, 0.09], A['pole'], sides=8)
    b.tube([(x, y0 + 0.4, z), (x, y0 + h - 0.35, z)], [0.06, 0.045], A['pole'], sides=8)
    b.disc((x, y0 + h - 0.35, z), 0, 0.14, A['pole'], sides=6, down=True)
    lens.tube([(x, y0 + h - 0.34, z), (x, y0 + h - 0.1, z)], [0.14, 0.17], rgb, sides=6, cap=False)
    b.roof((x, y0 + h - 0.1, z), 0.21, 0.1, A['pole'])
