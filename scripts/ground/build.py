"""
Builds the ground around the tower in Blender and bakes its night light (GROUND v2, "Plinth and Necklace").

Run from the project folder (Blender 5.2; an NVIDIA/AMD GPU or the CPU):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python scripts/ground/build.py
  add  -- --quick         a fast low-quality bake (half-size light maps, fewer samples, one calibration pass)
       -- --no-bake       only the geometry, the zone/albedo/paint maps and ground.blend (no light, no ground.glb)
       -- --reuse-calib   keep the lamp powers of the last calibration (scripts/ground/out/calibration.json)

Reads   src/three/ground/layout.json             (written by scripts/ground/layout.mjs)
Writes  public/models/ground.glb                 ground* (flat ground), props* (palms, poles, lamps, kerbs, walls,
                                                 benches...; their light baked into vertex colours: COLOR_0 lamps,
                                                 COLOR_1 sky), emissive* (lamp glass and LED strips)
        public/models/ground-near.webp, -far     lamp light on the ground (near the tower / the rest)
        public/models/ground-near-sky.webp, -far sky light on the ground
        public/models/ground-near-zones.png, -far which surface is where: R stone, G asphalt, B planting
        public/models/ground-near-albedo.png, -far the colour of the ground (sRGB)
        public/models/ground-paint.png           road paint: R white, G yellow
        src/three/ground/baked.json              how to read the maps, lamp glows (read by Ground.tsx)
        scripts/ground/out/                      ground.blend (to look around in Blender), calibration.json, previews

Axes: the layout uses the site's 3D axes (x right, y up, z towards the street camera, metres; the tower stands on the
origin). Blender's axes are x right, y away, z up, so a layout point (x, y, z) is (x, -z, y) here. The glTF export turns
them back. geom.py makes the meshes, maps.py the flat maps.
"""
import json
import math
import os
import shutil
import struct
import sys
import time
from contextlib import contextmanager

import bmesh
import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import geom  # noqa: E402
import maps  # noqa: E402
from geom import B, Builder, Ground  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
LAYOUT = os.path.join(ROOT, 'src', 'three', 'ground', 'layout.json')
BAKED = os.path.join(ROOT, 'src', 'three', 'ground', 'baked.json')
MODELS = os.path.join(ROOT, 'public', 'models')
OUT = os.path.join(ROOT, 'scripts', 'ground', 'out')
CALIBRATION = os.path.join(OUT, 'calibration.json')
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
QUICK = '--quick' in ARGS
NO_BAKE = '--no-bake' in ARGS
REUSE = '--reuse-calib' in ARGS
FFMPEG = os.environ.get('FFMPEG') or shutil.which('ffmpeg') or 'ffmpeg'

T0 = time.time()
TIMES = []  # (step, seconds)
BAKES = []  # (kind, name, seconds): map / vertex / probe bakes, for the estimate of a full bake


def log(*a):
    print(f'[ground {time.time() - T0:6.1f}s]', *a, flush=True)


@contextmanager
def step(name):
    t = time.time()
    yield
    TIMES.append((name, time.time() - t))
    log(f'-- {name}: {time.time() - t:.1f}s')


L = json.load(open(LAYOUT, encoding='utf-8'))
assert L.get('version') == 2, 'layout.json is not version 2: run node scripts/ground/layout.mjs'
Q = L['quality']['quick' if QUICK else 'final']
G = L['groups']
WALK = L['levels']['walk']
PAL = maps.palette(L)
os.makedirs(MODELS, exist_ok=True)
os.makedirs(OUT, exist_ok=True)


def lin(h):
    return tuple(float(c) for c in maps.hex_lin(h))


A = {k: lin(v) for k, v in L['albedo'].items()}
# The site's paint colours and podium slab grid (spec section 1-2), passed on to Ground.tsx.
PAINT = {'white': '#d9d4c8', 'yellow': '#d6a521'}
SLAB = {'origin': [-8.5, 5.5], 'size': [1.889, 0.944]}
EXPOSURE = 1.1  # the site's default sceneBrightness (renderer toneMappingExposure)

# ---------------------------------------------------------------- scene and renderer
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0  # ground.blend is saved twice; no .blend1 beside it
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
cyc = scene.cycles
prefs = bpy.context.preferences.addons['cycles'].preferences
for kind in ('OPTIX', 'CUDA', 'HIP', 'ONEAPI', 'METAL'):
    try:
        prefs.compute_device_type = kind
        prefs.get_devices()
        if any(d.type == kind for d in prefs.devices):
            for d in prefs.devices:
                d.use = d.type == kind
            cyc.device = 'GPU'
            log('rendering on', kind)
            break
    except Exception:  # noqa: BLE001 - backend not built in
        continue
else:
    cyc.device = 'CPU'
    log('rendering on the CPU')

cyc.use_denoising = False
cyc.max_bounces = 8
cyc.diffuse_bounces = 3
cyc.glossy_bounces = 0
cyc.transmission_bounces = 2
cyc.volume_bounces = 0
cyc.transparent_max_bounces = 4
cyc.sample_clamp_indirect = 10  # bounced fireflies off lamp heads would read as speckles after the denoiser
scene.view_settings.view_transform = 'Standard'

# Dusk sky: the light the ground gets where no lamp reaches.
world = bpy.data.worlds.new('dusk')
scene.world = world
world.use_nodes = True
wn, wl = world.node_tree.nodes, world.node_tree.links
WORLD = wn['Background']
coord = wn.new('ShaderNodeTexCoord')
sep = wn.new('ShaderNodeSeparateXYZ')
ramp = wn.new('ShaderNodeValToRGB')
wl.new(coord.outputs['Generated'], sep.inputs[0])
wl.new(sep.outputs['Z'], ramp.inputs[0])
# For the world, Generated is the direction of the ray: z = 0 at the horizon, 1 straight up.
ramp.color_ramp.elements[0].position = 0.0
ramp.color_ramp.elements[0].color = (*lin(L['sky']['horizon']), 1)
ramp.color_ramp.elements[1].position = 1.0
ramp.color_ramp.elements[1].color = (*lin(L['sky']['zenith']), 1)
wl.new(ramp.outputs['Color'], WORLD.inputs['Color'])

col = bpy.data.collections.new('ground')
scene.collection.children.link(col)


# ---------------------------------------------------------------- materials
EMITTERS = []  # (emission node, strength): lit in the lamp pass, dark in the sky pass


def material(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    return m, nt, nt.nodes.new('ShaderNodeOutputMaterial')


def diffuse(name, attr='albedo', translucent=0.0):
    """Plain diffuse in the per-corner albedo: the site shows baked light only, so nothing shiny."""
    m, nt, out = material(name)
    c = nt.nodes.new('ShaderNodeVertexColor')
    c.layer_name = attr
    d = nt.nodes.new('ShaderNodeBsdfDiffuse')
    nt.links.new(c.outputs['Color'], d.inputs['Color'])
    shader = d.outputs['BSDF']
    if translucent:
        # A thin leaf: light from below (the uplights) shows through on its upper side.
        t = nt.nodes.new('ShaderNodeBsdfTranslucent')
        nt.links.new(c.outputs['Color'], t.inputs['Color'])
        mix = nt.nodes.new('ShaderNodeMixShader')
        mix.inputs['Fac'].default_value = translucent
        nt.links.new(shader, mix.inputs[1])
        nt.links.new(t.outputs['BSDF'], mix.inputs[2])
        shader = mix.outputs['Shader']
    nt.links.new(shader, out.inputs['Surface'])
    return m


def emission(name, rgb=None, attr=None, strength=1.0, albedo=None, one_sided=False):
    """Light-emitting surface; over a dark diffuse when albedo is given (the tower's lit floors). Cycles lights both
    sides of a face: one_sided leaves the back black."""
    m, nt, out = material(name)
    e = nt.nodes.new('ShaderNodeEmission')
    if attr:
        c = nt.nodes.new('ShaderNodeVertexColor')
        c.layer_name = attr
        nt.links.new(c.outputs['Color'], e.inputs['Color'])
    else:
        e.inputs['Color'].default_value = (*rgb, 1)
    EMITTERS.append((e, strength))
    shader = e.outputs['Emission']
    if albedo is not None:
        d = nt.nodes.new('ShaderNodeBsdfDiffuse')
        d.inputs['Color'].default_value = (*albedo, 1)
        add = nt.nodes.new('ShaderNodeAddShader')
        nt.links.new(d.outputs['BSDF'], add.inputs[0])
        nt.links.new(shader, add.inputs[1])
        shader = add.outputs['Shader']
    if one_sided:
        back = nt.nodes.new('ShaderNodeBsdfDiffuse')
        back.inputs['Color'].default_value = (0, 0, 0, 1)
        mix = nt.nodes.new('ShaderNodeMixShader')
        nt.links.new(nt.nodes.new('ShaderNodeNewGeometry').outputs['Backfacing'], mix.inputs['Fac'])
        nt.links.new(shader, mix.inputs[1])
        nt.links.new(back.outputs['BSDF'], mix.inputs[2])
        shader = mix.outputs['Shader']
    nt.links.new(shader, out.inputs['Surface'])
    return m


def float_image(name, arr):
    """A linear float image from rows bottom-up (Blender's pixel order)."""
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, float_buffer=True)
    img.colorspace_settings.name = 'Linear Rec.709'
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = arr
    img.pixels.foreach_set(rgba.ravel())
    return img


def pixels(img):
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    return px.reshape(h, w, 4)[..., :3].copy()


def ground_material(name, albedo_img):
    """Ground in the albedo map's colours (for the light it bounces), with an image node to bake into."""
    m, nt, out = material(name)
    uv = nt.nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'uv'
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = albedo_img
    t.extension = 'EXTEND'  # beyond the far rect the roads and pavements run on along x
    d = nt.nodes.new('ShaderNodeBsdfDiffuse')
    nt.links.new(uv.outputs['UV'], t.inputs['Vector'])
    nt.links.new(t.outputs['Color'], d.inputs['Color'])
    nt.links.new(d.outputs['BSDF'], out.inputs['Surface'])
    target = nt.nodes.new('ShaderNodeTexImage')
    target.name = 'target'
    nt.nodes.active = target
    return m


def ground_object(name, cells, rect=None, mat=None):
    """Ground cells (outlines in site axes) as one object, points shared; planar UVs over rect when given."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('uv') if rect else None
    pts = {}
    for cell in cells:
        vs = []
        for p in cell:
            if p not in pts:
                pts[p] = bm.verts.new(B(*p))
            vs.append(pts[p])
        f = bm.faces.new(vs)
        if uv:
            x0, z0, x1, z1 = rect
            for lp, (x, _, z) in zip(f.loops, cell):
                lp[uv].uv = ((x - x0) / (x1 - x0), (z - z0) / (z1 - z0))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    if mat:
        me.materials.append(mat)
    return ob


# ---------------------------------------------------------------- maps: zones, albedo, paint
REGIONS = {k: L['regions'][k]['rect'] for k in ('near', 'far')}
ALBEDO = {}
with step('zone, albedo and paint maps'):
    for key, rect in REGIONS.items():
        zones, albedo = maps.region_maps(L, rect, L['regions'][key]['zones'])
        maps.write_png(os.path.join(MODELS, f'ground-{key}-zones.png'), maps.to8(zones))
        maps.write_png(os.path.join(MODELS, f'ground-{key}-albedo.png'), maps.to8(maps.srgb(albedo)))
        ALBEDO[key] = float_image(f'albedo-{key}', albedo)
    maps.write_png(os.path.join(MODELS, 'ground-paint.png'), maps.to8(maps.paint_map(L)))

# ---------------------------------------------------------------- lights
LIGHT_DATA = {}  # one light datablock per group, shared by all its lamps: calibrating a group sets one energy
LIGHTS = {}  # group -> light objects
GLOWS = []  # the glow the site draws around each lamp
ENERGY = {g: G[g]['energy'] for g in G if 'light' in G[g]}
ENERGY['sky'] = L['sky']['strength']
RADIUS = {'pole': 0.15, 'lantern': 0.08, 'bollard': 0.03, 'uplight': 0.04, 'necklace': 0.08, 'cap': 0.03}
DOWN, UPWARD = (0, -1, 0), (0, 1, 0)


def add_light(group, pos, g, aim=None, glow=None, push=0.0):
    """One lamp of a group at pos (site axes), shining along aim (default: the group's aim, else down); the site
    draws its glow at glow (default: the light itself), depth-tested `push` metres nearer the camera (to clear the
    lamp's own head)."""
    gr = G[group]
    if group not in LIGHT_DATA:
        ld = bpy.data.lights.new(group, gr['light'])
        ld.color = lin(gr['color'])
        if gr['light'] == 'SPOT':
            ld.spot_size = math.radians(gr['cone'])
            ld.spot_blend = gr.get('blend', 0.5)
        if gr['light'] == 'AREA':
            ld.shape = 'RECTANGLE'
            ld.size, ld.size_y = gr['size']
        else:
            ld.shadow_soft_size = RADIUS[group]
        LIGHT_DATA[group] = ld
    obs = LIGHTS.setdefault(group, [])
    ob = bpy.data.objects.new(f'{group}{len(obs)}', LIGHT_DATA[group])
    ob.location = B(*pos)
    aim = aim or (UPWARD if gr.get('aim') == 'up' else DOWN)
    # Lights shine along their local -Z: turn -Z to the aim.
    ob.rotation_euler = (-B(*aim).normalized()).to_track_quat('Z', 'Y').to_euler()
    col.objects.link(ob)
    obs.append(ob)
    if gr.get('glow'):
        GLOWS.append({'p': [round(v, 3) for v in glow or pos], 'c': gr['color'], 's': gr['glow'], 'g': g,
                      **({'d': push} if push else {})})


# ---------------------------------------------------------------- geometry
ground = Ground(L)
near_rect, far_rect = REGIONS['near'], REGIONS['far']


def within(rect):
    return lambda x, z: rect[0] <= x <= rect[2] and rect[1] <= z <= rect[3]


def face_colours(x, z, high, low):
    """Albedo of each vertical face piece: kerb granite beside a road, else the surface of the higher side."""
    cls, tone = maps.classify_points(L, x, z)
    rgb = maps.palette_colour(PAL, cls, tone)
    rgb[low < WALK - 0.01] = A['kerb']
    return [tuple(c) for c in rgb]


props = Builder('props-main')  # everything that casts shadows
thin = Builder('props-thin')  # cast no shadow: the lit bollards (their light sits inside them), the lanterns' plates
lens = Builder('emissive', color='color')  # lamp glass and LED strips as the site draws them
emit = Builder('emitters', color='emit')  # LED strips as bake lights, in short pieces (each piece a small light)
STONE = {'granite', 'limestone', 'upstand', 'kerb'}  # box materials that take the site's stone tile on their sides

with step('geometry'):
    with props.tag('vertical faces'):
        ground.faces(props, face_colours)
    PALMS = []
    for pm in L['palms']:
        with props.tag('palms'):
            axis, trunk = geom.palm(props, pm, A)
        PALMS.append((pm, axis, trunk))
        for ux, uz in geom.uplight_spots(pm):
            y0 = pm['base']
            with props.tag('uplights'):
                props.box((ux, y0 + 0.04, uz), (0.16, 0.08, 0.16), A['charcoal'])
            lens.disc((ux, y0 + 0.085, uz), 0, 0.06, lin(G[pm['group']]['color']), sides=8)
            src = Vector((ux, y0 + 0.12, uz))
            add_light(pm['group'], tuple(src), pm['g'], aim=tuple(axis(0.45 * pm['h']) - src))
    for pl in L['poles']:
        with props.tag('poles'):
            heads = geom.pole(props, lens, pl, A, lin(G[pl['group']]['color']))
        for hx, hy, hz in heads:
            # The glow sits in the 2 cm lens, depth-tested 0.35 m nearer the camera: unpushed, the lens's own faces
            # hid its bright core from below.
            add_light(pl['group'], (hx, hy - 0.2, hz), pl['g'], glow=(hx, hy - 0.14, hz), push=0.35)
    for ln in L['lanterns']:
        with props.tag('lanterns'), thin.tag('lanterns'):
            geom.lantern(props, lens, ln, A, lin(G[ln['group']]['color']), plate=thin)
        x, z, top = ln['p'][0], ln['p'][1], ln['base'] + ln['h']
        # The light (radius 0.08) sits in the upper glass, clear of the roof (h - 0.12) and above the pole's top
        # (h - 0.6), so neither blocks it; the plate under it casts no shadow (thin), so no dark disc under the
        # lantern. Its glow is drawn in the middle of the glass, depth-tested 0.3 m nearer the camera so the
        # head's own glass does not hide it.
        add_light(ln['group'], (x, top - 0.25, z), ln['g'], glow=(x, top - 0.35, z), push=0.3)
    for bl in L['bollards']:
        x, z = bl['p']
        if bl['kind'] == 'lit':
            with thin.tag('bollards'):
                geom.bollard(thin, lens, bl, A, lin(G[bl['group']]['color']))
            # The light and its glow sit inside the lit band; the glow is depth-tested 0.2 m nearer the camera, or
            # the band's own glass would hide it.
            add_light(bl['group'], (x, bl['base'] + bl['h'] - 0.12, z), bl['g'], push=0.2)
        elif bl['kind'] == 'steel':
            with props.tag('bollards'):
                geom.steel_bollard(props, bl, A)
        else:
            with props.tag('bollards'):
                geom.cap(props, lens, bl, A, lin(G[bl['group']]['color']))
            add_light(bl['group'], (x, bl['base'] + 0.03, z), bl['g'])
    for lp in L['lamps']:
        with props.tag('lamps'):
            geom.lamp(props, lens, lp, A, lin(G[lp['group']]['color']))
        x, z, top = lp['p'][0], lp['p'][1], lp['base'] + lp['h']
        # The spot sits at the head's bottom plate (h - 0.35), inside the top of the post, and points down: the
        # plate is behind it, so it does not shade the pool. (Its 0.08 m sphere reaches 6 cm above the plate.)
        # The glow fills the middle of the glass, depth-tested 0.3 m nearer the camera so the glass does not hide it.
        add_light(lp['group'], (x, top - 0.37, z), lp['g'], glow=(x, top - 0.22, z), push=0.3)
    for bx in L['boxes']:
        with props.tag('boxes'):
            # The quay's water side faces no camera: its upstand and handrail have no -z side.
            props.box(bx['c'], bx['s'], A[bx['m']], bx.get('ry', 0), bx.get('seg'), tile=bx['m'] in STONE,
                      back=bx['c'][2] > L['quay']['inner'])
    for s in L['strips']:
        gr = G[s['group']]
        rgb = lin(gr['color'])
        lens.strip(s['a'], s['b'], s['w'], rgb, piece=100)
        strength = s.get('strength', gr.get('strength', 1))
        length = math.dist(s['a'], s['b'])
        emit.strip(s['a'], s['b'], s['w'], tuple(c * strength for c in rgb), piece=0.5 if length < 100 else 1.0)

    # The canopy's light: an area light just under its slab.
    tw = L['tower']
    cx0, cz0, cx1, cz1 = tw['canopy']['rect']
    add_light('canopy', ((cx0 + cx1) / 2, tw['canopy']['y'][0] - 0.01, (cz0 + cz1) / 2), 0)

    # The tower, for the bake only (the site has its own): it hides sky and lamps behind it, and its lit floors
    # (the facade's glow) and the lobby glass light the plaza. Its footprint parts only, as the ground's hole: the
    # lift notch is a glass well, and a solid box over it would leave its floor lit by nothing but the box's own
    # glow from inside (a yellow patch at the lift's foot).
    tower = Builder('tower')
    for x0, z0, x1, z1 in tw['parts']:
        tower.box(((x0 + x1) / 2, tw['h'] / 2, (z0 + z1) / 2), (x1 - x0, tw['h'], z1 - z0), A['tower'])
    tower_ob = tower.object(col, [emission('tower', lin(tw['facade']['color']), strength=tw['facade']['strength'],
                                           albedo=A['tower'])])
    slab = Builder('canopy')
    y0, y1 = tw['canopy']['y']
    slab.box(((cx0 + cx1) / 2, (y0 + y1) / 2, (cz0 + cz1) / 2), (cx1 - cx0, y1 - y0, cz1 - cz0), A['tower'], bottom=True)
    slab.object(col, [diffuse('canopy')])
    for i, gl in enumerate(tw['glow']):
        # Lit lobby glass, as glowing panels just in front of the facade (facing (b - a) × up, away from it). One-sided:
        # the panel across the lift notch would otherwise light the notch's floor behind it at arm's length.
        gb = Builder(f'glass{i}')
        (ax, az), (bx_, bz) = gl['a'], gl['b']
        gb.grid((ax, gl['y'][0], az), (bx_ - ax, 0, bz - az), (0, gl['y'][1] - gl['y'][0], 0), 1, 1, (1, 1, 1))
        gb.object(col, [emission(f'glass{i}', lin(gl['color']), strength=gl['strength'], one_sided=True)])

    props_mat = diffuse('props')
    props_ob = props.object(col, [props_mat, diffuse('frond', translucent=0.35)])
    thin_ob = thin.object(col, [props_mat])
    thin_ob.visible_shadow = False
    lens_ob = lens.object(col, [emission('lens', (1, 1, 1), strength=0)])
    lens_ob.hide_render = True  # the bake has real lights at the lamp heads; the glass would only block them
    emit_ob = emit.object(col, [emission('emitters', attr='emit')])
    emit_ob.visible_shadow = False
    for ob in (props_ob, thin_ob):
        for name in ('lamp', 'sky'):
            ob.data.color_attributes.new(name, 'FLOAT_COLOR', 'CORNER')

    # The ground: one mesh for the site, and overlapping copies to bake on (each map's rect with its UVs, and the
    # rest of the ground around it). Only one copy of each spot is in the scene during a bake.
    ground_ob = ground_object('ground', ground.cells())
    ground_ob.hide_render = True
    far_mat = ground_material('ground-far', ALBEDO['far'])
    BAKE_GROUND = {
        'near': ground_object('bake-near', ground.cells(within(near_rect)), near_rect,
                              ground_material('ground-near', ALBEDO['near'])),
        'out-near': ground_object('bake-out-near', ground.cells(lambda x, z: not within(near_rect)(x, z)), far_rect,
                                  far_mat),
        'far': ground_object('bake-far', ground.cells(within(far_rect)), far_rect, far_mat),
        'out-far': ground_object('bake-out-far', ground.cells(lambda x, z: not within(far_rect)(x, z)), far_rect,
                                 far_mat),
    }
    ground_tris = sum(len(p.vertices) - 2 for p in ground_ob.data.polygons)
log(f"ground: {len(ground.xs)} x {len(ground.zs)} grid lines, {len(ground.y)} cells, ~{ground_tris} triangles")
log('props triangles: ' + ', '.join(f'{k} {v}' for k, v in sorted(props.tris.items())) +
    f", lit bollards {thin.tris.get('bollards', 0)}; total {sum(props.tris.values()) + sum(thin.tris.values())}")
log('lights: ' + ', '.join(f'{g} {len(v)}' for g, v in LIGHTS.items()) + f'; {len(GLOWS)} glows')

# ---------------------------------------------------------------- calibration probes
PROBES = [{'group': 'sky', 'p': p['p'], 'surface': p['surface'], 'target': L['sky']['target'][p['surface']]}
          for p in L['sky']['probes']]
PROBES += [{**p, 'target': G[p['group']]['target'][p['surface']]} for p in L['probes']]
TILE = 32
PCOLS = 6
PROWS = math.ceil(len(PROBES) / PCOLS)


def disc_points(x, z, r=0.45, n=7):
    g = np.linspace(-r, r, n)
    X, Z = np.meshgrid(g, g)
    m = X ** 2 + Z ** 2 <= r * r
    return x + X[m], z + Z[m]


def probe_albedo(p):
    if p['surface'] == 'trunk':
        return np.array(A['trunk'])
    xs, zs = disc_points(*p['p'])
    cls, tone = maps.classify_points(L, xs, zs)
    return maps.palette_colour(PAL, cls, tone).mean(axis=0)


def build_probes():
    """1 m discs on the ground (a card on the trunk for the uplights), each baked into its own tile of one image.
    They see the light but are invisible to it: no shadow, no bounce."""
    pb = Builder('probes')
    pb.uv = pb.bm.loops.layers.uv.new('uv')
    W, H = PCOLS * TILE, PROWS * TILE
    masks = []
    yy, xx = np.mgrid[0:H, 0:W] + 0.5
    for k, p in enumerate(PROBES):
        tx, ty = (k % PCOLS) * TILE + TILE / 2, (k // PCOLS) * TILE + TILE / 2
        half = TILE / 2 - 3
        x, z = p['p']
        if p['surface'] == 'trunk':
            pm, axis, _ = min(PALMS, key=lambda e: math.dist(e[0]['p'], p['p']))
            ux, uz = geom.uplight_spots(pm)[0]
            d = Vector((ux - pm['p'][0], 0, uz - pm['p'][1])).normalized()
            t = geom.UP.cross(d) * 0.15  # card across the trunk, facing the uplight
            c0, c1 = axis(1.5) + d * 0.25, axis(3.5) + d * 0.25
            pts = [c0 - t, c0 + t, c1 + t, c1 - t]
            uvs = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
            masks.append((np.abs(xx - tx) < half - 1) & (np.abs(yy - ty) < half - 1))
        else:
            y = ground.height(x, z) + 0.01
            ang = [2 * math.pi * i / 16 for i in range(16)]
            pts = [(x + 0.5 * math.cos(a), y, z - 0.5 * math.sin(a)) for a in ang]
            uvs = [(math.cos(a), math.sin(a)) for a in ang]
            masks.append((xx - tx) ** 2 + (yy - ty) ** 2 < (half * 0.9) ** 2)
        pb.poly([pb.vert(q) for q in pts], (0.5, 0.5, 0.5),
                uvs=[((tx + u * half) / W, (ty + v * half) / H) for u, v in uvs])
        p['alb'] = probe_albedo(p)
    m, nt, out = material('probe')
    d = nt.nodes.new('ShaderNodeBsdfDiffuse')
    nt.links.new(d.outputs['BSDF'], out.inputs['Surface'])
    target = nt.nodes.new('ShaderNodeTexImage')
    target.name = 'target'
    nt.nodes.active = target
    ob = pb.object(col, [m])
    for v in ('visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow'):
        setattr(ob, v, False)
    img = bpy.data.images.new('probes', W, H, float_buffer=True)
    img.colorspace_settings.name = 'Linear Rec.709'
    return ob, img, masks


probe_ob, probe_img, PROBE_MASKS = build_probes()
lens_ob.data.attributes.remove(lens_ob.data.attributes['_FACE'])  # only the props' stone faces use it
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'ground.blend'))

if NO_BAKE:
    log('--no-bake: maps and ground.blend written; no light baked, ground.glb and baked.json left as they were')
    sys.exit(0)


# ---------------------------------------------------------------- baking
def select_only(ob):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def show_ground(*keys):
    for k, ob in BAKE_GROUND.items():
        ob.hide_render = k not in keys


def setup(lights=(), sky=False, emit_on=False):
    """Which light is on: a set of lamp groups, the sky, the emitting surfaces (LEDs, tower floors, lobby glass)."""
    for g, obs in LIGHTS.items():
        for ob in obs:
            ob.hide_render = g not in lights
    for g, ld in LIGHT_DATA.items():
        ld.energy = ENERGY[g]
    WORLD.inputs['Strength'].default_value = ENERGY['sky'] if sky else 0.0
    for node, strength in EMITTERS:
        node.inputs['Strength'].default_value = strength if emit_on else 0.0
    emit_ob.hide_render = not emit_on


def bake_image(ob, img, samples, margin, name):
    for m in ob.data.materials:
        node = m.node_tree.nodes['target']
        node.image = img
        m.node_tree.nodes.active = node
    cyc.samples = samples
    select_only(ob)
    t = time.time()
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, target='IMAGE_TEXTURES', margin=margin,
                        margin_type='EXTEND', use_clear=True)
    BAKES.append(('probe' if ob is probe_ob else 'map', name, time.time() - t))
    return pixels(img)


def bake_vertices(ob, attr, samples, name):
    """Light on a prop's corners (albedo × light: the colour the site shows)."""
    ca = ob.data.color_attributes
    ca.active_color = ca[attr]
    cyc.samples = samples
    select_only(ob)
    t = time.time()
    bpy.ops.object.bake(type='COMBINED', pass_filter={'DIRECT', 'INDIRECT', 'DIFFUSE', 'TRANSMISSION'},
                        target='VERTEX_COLORS', use_clear=True)
    BAKES.append(('vertex', name, time.time() - t))
    even_out(ob, attr)


def even_out(ob, attr):
    """One colour per point and surface: the corners around a point were baked apart and differ only by noise. On
    smooth surfaces (trunks, leaves, poles) every corner of a point shares it; on flat ones, the corners of faces in
    one plane (a subdivided box side), so hard edges stay hard. Equal corners also let the export share the point
    between its faces, and pack smaller."""
    me = ob.data
    vi = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get('vertex_index', vi)
    smooth = np.empty(len(me.polygons), dtype=bool)
    me.polygons.foreach_get('use_smooth', smooth)
    total = np.empty(len(me.polygons), dtype=np.int64)
    me.polygons.foreach_get('loop_total', total)
    normal = np.empty(len(me.polygons) * 3, dtype=np.float32)
    me.polygons.foreach_get('normal', normal)
    plane = np.round(np.repeat(normal.reshape(-1, 3), total, axis=0) * 100).astype(np.int64)
    plane[np.repeat(smooth, total)] = 0
    group = np.unique(np.column_stack([vi, plane]), axis=0, return_inverse=True)[1].ravel()
    data = me.color_attributes[attr].data
    c = np.empty(len(me.loops) * 4, dtype=np.float32)
    data.foreach_get('color', c)
    c = c.reshape(-1, 4)
    sums = np.zeros((group.max() + 1, 4))
    np.add.at(sums, group, c)
    c = (sums / np.bincount(group)[:, None])[group].astype(np.float32)
    data.foreach_set('color', c.ravel())


DENOISE = {}


def denoise(arr):
    """OIDN on a baked map (through the compositor of a scene of its own)."""
    h, w = arr.shape[:2]
    if not DENOISE:
        sc = bpy.data.scenes.new('denoise')
        sc.render.engine = 'CYCLES'
        sc.view_settings.view_transform = 'Standard'
        sc.render.resolution_percentage = 100
        sc.render.image_settings.file_format = 'OPEN_EXR'
        sc.render.image_settings.color_depth = '32'
        ng = bpy.data.node_groups.new('denoise', 'CompositorNodeTree')
        ng.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
        src = ng.nodes.new('CompositorNodeImage')
        d = ng.nodes.new('CompositorNodeDenoise')
        d.inputs['HDR'].default_value = True
        o = ng.nodes.new('NodeGroupOutput')
        ng.links.new(src.outputs['Image'], d.inputs['Image'])
        ng.links.new(d.outputs['Image'], o.inputs[0])
        sc.compositing_node_group = ng
        sc.render.use_compositing = True
        DENOISE.update(scene=sc, src=src)
    sc = DENOISE['scene']
    img = float_image('denoise-in', arr)
    DENOISE['src'].image = img
    sc.render.resolution_x, sc.render.resolution_y = w, h
    bpy.ops.render.render(scene=sc.name)
    path = os.path.join(OUT, 'denoise.exr')
    bpy.data.images['Render Result'].save_render(path, scene=sc)
    res = bpy.data.images.load(path)
    out = pixels(res)
    bpy.data.images.remove(res)
    bpy.data.images.remove(img)
    os.remove(path)
    return np.maximum(out, 0)


# ---------------------------------------------------------------- measuring as the site shows it
LUM = np.array([0.2126, 0.7152, 0.0722])  # Rec.709 luminance


def neutral(c):
    """three.js NeutralToneMapping (Khronos PBR Neutral) at the site's exposure; c (..., 3) linear."""
    c = c * EXPOSURE
    x = c.min(axis=-1, keepdims=True)
    c = c - np.where(x < 0.08, x - 6.25 * x * x, 0.04)
    peak = np.maximum(c.max(axis=-1, keepdims=True), 1e-9)
    d = 1 - 0.76
    new = 1 - d * d / (peak + d - 0.76)
    g = 1 - 1 / (0.15 * (peak - new) + 1)
    squeezed = c * new / peak * (1 - g) + new * g
    return np.where(peak < 0.76, c, squeezed)


def screen(rgb):
    """What a pixel of this linear colour reads on screen: sRGB of the tone-mapped luminance."""
    return maps.srgb(neutral(np.asarray(rgb)) @ LUM)


CALIBRATED = ['pole'] + [g for g in G if 'target' in G[g] and g not in ('pole', 'canopy')] + ['canopy']
ORDER = ['sky'] + CALIBRATED  # the sky first, the canopy last (spec section 4)
FIXED = [g for g in LIGHT_DATA if g not in CALIBRATED]  # lamps without a target (the caps)
ALB = np.array([p['alb'] for p in PROBES])
MID = np.array([np.mean(p['target']) for p in PROBES])
SKY_ONLY = np.array([p['group'] == 'sky' for p in PROBES])[:, None]  # the sky's targets are for unlit ground
# How a group's probes are brought to target: on average (in log), or for the sky, its brightest. The sky's three
# targets cannot all be met: pavers reflect 5x what asphalt does, the targets allow 1.7x. Averaged, pale stone
# (granite, the promenade) lit by the sky alone reads as bright as the lantern and necklace pools, and those can
# no longer show. So no unlit probe may read over its target: the pools keep the spec's hierarchy, asphalt and
# lawn read under theirs, and the haze lifts them where they are far.
AIM = {'sky': np.max}


def probe_light(name):
    px = bake_image(probe_ob, probe_img, 1024, 2, name)
    return np.array([px[m].mean(axis=0) for m in PROBE_MASKS])


def mix(contrib, fixed, scale):
    """Light at each probe for these scales of the baked contributions (light adds up linearly)."""
    sky = scale['sky'] * contrib['sky']
    return np.where(SKY_ONLY, sky, sky + fixed + sum(scale[g] * contrib[g] for g in CALIBRATED))


def solve(contrib, fixed):
    """Scale per group so its probes read their target's middle (mean in log), the others held; sweep the order a
    few times, as each group's light also reaches the others' probes."""
    scale = {g: 1.0 for g in ORDER}
    for _ in range(4):
        stuck = set()
        for g in ORDER:
            idx = [k for k, p in enumerate(PROBES) if p['group'] == g]
            lo, hi = -7.0, 7.0
            for _ in range(48):
                scale[g] = math.exp((lo + hi) / 2)
                if AIM.get(g, np.mean)(np.log(screen(ALB * mix(contrib, fixed, scale))[idx] / MID[idx])) > 0:
                    hi = (lo + hi) / 2
                else:
                    lo = (lo + hi) / 2
            if hi > 6.9 or lo < -6.9:
                # No power of its own brings its probes to target: they see (almost) none of it, or the other light
                # alone already passes the target. Turning it off (or up 1000x) would not help, so it stays as it is.
                scale[g] = 1.0
                stuck.add(g)
    for g in stuck:
        idx = [k for k, p in enumerate(PROBES) if p['group'] == g]
        others = screen(ALB * mix(contrib, fixed, {**scale, g: 0.0}))[idx]
        log(f'!! calibration: {g} cannot bring its probes to target {PROBES[idx[0]]["target"]}; without it they '
            f'already read {", ".join(f"{v:.3f}" for v in others)}. Kept at {ENERGY[g]:.1f} W.')
    total = mix(contrib, fixed, scale) @ LUM
    own = np.array([scale[p['group']] * contrib[p['group']][k] @ LUM for k, p in enumerate(PROBES)]) / total
    return scale, screen(ALB * mix(contrib, fixed, scale)), own


def calibrate():
    show_ground('near', 'out-near')
    for it in range(Q['calib']):
        contrib = {}
        for g in ORDER:
            setup(lights=() if g == 'sky' else {g}, sky=g == 'sky')
            contrib[g] = probe_light(f'calibration {g}')
        setup(lights=set(FIXED), emit_on=True)
        fixed = probe_light('calibration fixed')
        if it == 0:
            first = screen(ALB * mix(contrib, fixed, {g: 1.0 for g in ORDER}))
        scale, predicted, own = solve(contrib, fixed)
        for g in ORDER:
            ENERGY[g] *= scale[g]
        log(f'calibration pass {it + 1}: ' + ', '.join(f'{g} x{scale[g]:.3f}' for g in ORDER))
        if it > 0 and all(abs(scale[g] - 1) < 0.05 for g in ORDER):
            break
    return first, predicted, own


def table(title, start, values, own=None):
    """Per probe: its group's power (start -> now), what it reads on screen, the target; own = the share of the
    probe's light that comes from its own group."""
    log(title)
    log(f"  {'group':9} {'energy (W)':>19}  {'probe':17} {'surface':8} {'reads':>6}  {'target':11}" +
        ('  own' if own is not None else ''))
    for k, p in enumerate(PROBES):
        g, v, (t0, t1) = p['group'], values[k], p['target']
        ok = 'ok' if t0 <= v <= t1 else ('LOW' if v < t0 else 'HIGH')
        log(f"  {g:9} {start[g]:9.3f} -> {ENERGY[g]:7.3f}  ({p['p'][0]:6.1f},{p['p'][1]:7.1f}) {p['surface']:8} "
            f"{v:6.3f}  {t0:.3f}-{t1:.3f} {ok:4}" + (f' {own[k] * 100:3.0f}%' if own is not None else ''))


START = dict(ENERGY)
with step('calibration'):
    if REUSE and os.path.exists(CALIBRATION):
        saved = json.load(open(CALIBRATION, encoding='utf-8'))
        ENERGY.update(saved['energy'])
        log('calibration reused from', CALIBRATION)
    else:
        first, predicted, own = calibrate()
        table('calibration (screen values: NeutralToneMapping x1.1, sRGB of luminance; sky probes: sky light only)',
              START, predicted, own)
        rows = [{'group': p['group'], 'p': p['p'], 'surface': p['surface'], 'target': p['target'],
                 'before': round(float(first[k]), 4), 'predicted': round(float(predicted[k]), 4),
                 'own': round(float(own[k]), 3)} for k, p in enumerate(PROBES)]
        maps.write_atomic(CALIBRATION, json.dumps({'quality': 'quick' if QUICK else 'final', 'energy': ENERGY,
                                                   'start': START, 'probes': rows}, indent=1).encode())

# ---------------------------------------------------------------- the two bakes: lamps only, then sky only
size = {k: [int(v * Q['scale']) for v in L['regions'][k]['lightmap']] for k in REGIONS}
sky_size = {k: [int(v * Q['scale']) for v in L['regions'][k]['sky']] for k in REGIONS}
margin = max(2, round(16 * Q['scale']))
RAW = {}
for kind, sizes in (('lamp', size), ('sky', sky_size)):
    with step(f'bake: {kind} only'):
        if kind == 'lamp':
            setup(lights=set(LIGHT_DATA), emit_on=True)
        else:
            setup(sky=True)
        for key in REGIONS:
            show_ground(key, f'out-{key}')
            img = bpy.data.images.new(f'{kind}-{key}', *sizes[key], float_buffer=True)
            img.colorspace_settings.name = 'Linear Rec.709'
            RAW[kind, key] = bake_image(BAKE_GROUND[key], img, Q['samples'], margin, f'{kind} {key} {sizes[key]}')
            log(f'baked {kind} light on the {key} ground {sizes[key]}')
        show_ground('near', 'out-near')
        for ob in (props_ob, thin_ob):
            bake_vertices(ob, kind, Q['vsamples'], f'{kind} {ob.name}')
        log(f'baked {kind} light on the props ({len(props_ob.data.vertices) + len(thin_ob.data.vertices)} points)')

with step('denoise'):
    for k in RAW:
        RAW[k] = denoise(RAW[k])

# ---------------------------------------------------------------- store the maps
with step('encode maps'):
    noise = maps.blue_noise()

    def scale_of(kind):
        # One scale for both maps of a kind: 99.9% of pixels below it, the brightest few clip (lamp hot spots).
        return float(max(np.percentile(RAW[kind, k].max(axis=2), 99.9) for k in REGIONS))

    K, Ks = scale_of('lamp'), scale_of('sky')
    DECODED = {}
    for (kind, key), light in RAW.items():
        scale = K if kind == 'lamp' else Ks
        enc = maps.encode_light(light, scale, noise)
        name = f'ground-{key}' + ('' if kind == 'lamp' else '-sky')
        dst = os.path.join(MODELS, name + '.webp')
        maps.write_webp(dst, enc, Q['webp'], FFMPEG)
        maps.write_png(os.path.join(OUT, name + '.png'), enc)
        DECODED[kind, key] = maps.decode_light(maps.read_image(dst, enc.shape[1], enc.shape[0], FFMPEG), scale)
        clipped = (light.max(axis=2) > scale).mean() * 100
        log(f'{name}.webp {enc.shape[1]}x{enc.shape[0]} {os.path.getsize(dst) // 1024} KB, '
            f'{clipped:.2f}% clipped, mean {light.mean(axis=(0, 1)).round(4).tolist()}')
    SKY_CONST = RAW['sky', 'far'].mean(axis=(0, 1))
    log(f'K {K:.4f}, Ks {Ks:.5f}, skyConst {SKY_CONST.round(5).tolist()}')


# ---------------------------------------------------------------- checks on the maps as stored
def light_at(xs, zs, kinds=('lamp', 'sky')):
    """Light at ground points from the stored maps, as the site picks them: the near map inside its rect (less the
    blend band), the far map elsewhere in its rect, and outside both no lamp light and the sky's constant."""
    inner = [near_rect[0] + L['blend'], near_rect[1] + L['blend'], near_rect[2] - L['blend'], near_rect[3] - L['blend']]
    out = []
    for x, z in zip(xs, zs):
        key = 'near' if within(inner)(x, z) else 'far'
        if not within(REGIONS[key])(x, z):
            out.append(SKY_CONST if 'sky' in kinds else np.zeros(3))
            continue
        out.append(sum(maps.sample(DECODED[k, key], REGIONS[key], [x], [z])[0] for k in kinds))
    return np.array(out)


def shown(x, z):
    """Screen value of the ground at one point: its albedo × the stored light."""
    cls, tone = maps.classify_points(L, np.array([x]), np.array([z]))
    return float(screen(maps.palette_colour(PAL, cls, tone)[0] * light_at([x], [z])[0]))


def trunk_light(p):
    """Baked light on the trunk side that faces its uplight, 1.5-3.5 m up (the colours the site shows)."""
    pm, axis, (f0, f1) = min(PALMS, key=lambda e: math.dist(e[0]['p'], p['p']))
    ux, uz = geom.uplight_spots(pm)[0]
    d = Vector((ux - pm['p'][0], 0, uz - pm['p'][1])).normalized()
    me = props_ob.data
    colours = {}
    for name in ('lamp', 'sky'):
        c = np.empty(len(me.loops) * 4, np.float32)
        me.color_attributes[name].data.foreach_get('color', c)
        colours[name] = c.reshape(-1, 4)[:, :3]
    rgb = []
    for poly in me.polygons[f0:f1]:
        c = poly.center
        site = Vector((c.x, c.z, -c.y))
        h = site.y - pm['base']
        if 1.5 <= h <= 3.5 and (site - axis(h)).normalized().dot(d) > 0.9:
            rgb += [colours['lamp'][li] + colours['sky'][li] for li in poly.loop_indices]
    return np.mean(rgb, axis=0)


with step('checks'):
    # Seams: the near and far maps along the near rect, halfway into the band where the site fades one into the
    # other. Point by point, and averaged over 2 m: shadow edges are sharp in the near map and soft in the far one,
    # which is detail, not a seam. Ground under and right beside boxes (the hedges cross the band) is left out: the
    # near map sees the box's shade there, the far map's pixels are too big to.
    x0, z0, x1, z1 = near_rect
    inset = L['blend'] / 2
    t = np.arange(0, 1, 0.0005)
    ex = np.concatenate([x0 + (x1 - x0) * t, x0 + (x1 - x0) * t, np.full_like(t, x0 + inset), np.full_like(t, x1 - inset)])
    ez = np.concatenate([np.full_like(t, z0 + inset), np.full_like(t, z1 - inset), z0 + (z1 - z0) * t, z0 + (z1 - z0) * t])
    window = np.linspace(-1, 1, 9)

    def clear_of_boxes(margin):
        keep = np.ones(len(ex), bool)
        for bx in L['boxes']:
            ry = bx.get('ry', 0)
            dx, dz = ex - bx['c'][0], ez - bx['c'][2]
            u = dx * math.cos(ry) - dz * math.sin(ry)
            w = dx * math.sin(ry) + dz * math.cos(ry)
            keep &= (np.abs(u) > bx['s'][0] / 2 + margin) | (np.abs(w) > bx['s'][2] / 2 + margin)
        return keep

    sharp_ok, soft_ok = clear_of_boxes(0.5), clear_of_boxes(0.5 + window[-1])
    log(f'seam check: {len(ex)} points on the near edge, {(~sharp_ok).sum()} left out by boxes '
        f'({(~soft_ok).sum()} for the 2 m average)')
    for kind, scale in (('lamp', K), ('sky', Ks)):
        def stored(key, dx=0.0, dz=0.0):
            return maps.srgb(maps.sample(DECODED[kind, key], REGIONS[key], ex + dx, ez + dz) / scale) * 255

        def averaged(key):
            return np.mean([stored(key, dx, dz) for dx in window for dz in window], axis=0)

        point = np.abs(stored('near') - stored('far')).max(axis=1)[sharp_ok]
        soft = np.where(soft_ok, np.abs(averaged('near') - averaged('far')).max(axis=1), 0)
        log(f'seam, {kind} maps, 8-bit steps: point by point max {point.max():.0f}, 99% {np.percentile(point, 99):.0f}, '
            f'mean {point.mean():.1f}; over 2 m max {soft.max():.1f} at ({ex[soft.argmax()]:.1f}, '
            f'{ez[soft.argmax()]:.1f}), 99% {np.percentile(soft[soft_ok], 99):.1f}, mean {soft[soft_ok].mean():.2f}')

    # The probes again, from the maps as stored (the trunks from their baked colours).
    final = []
    for p in PROBES:
        if p['surface'] == 'trunk':
            final.append(float(screen(trunk_light(p))))
        else:
            xs, zs = disc_points(*p['p'])
            light = light_at(xs, zs, ('sky',) if p['group'] == 'sky' else ('lamp', 'sky'))
            final.append(float(screen(p['alb'] * light.mean(axis=0))))
    table('probes as stored (maps after denoise, WebP and dither; trunks from their vertex colours)', START, final)
    log('lobby spill, 1/4/8/12 m in front of the glass: '
        + ', '.join(f'{shown(0, 5.5 + d):.3f}' for d in (1, 4, 8, 12)))
    log(f'carpet wash beside the LED lines (x ±4.6, z 12): {shown(-4.6, 12):.3f}, {shown(4.6, 12):.3f}')

# ---------------------------------------------------------------- ground.glb
def read_glb(path):
    data = open(path, 'rb').read()
    jlen = struct.unpack('<I', data[12:16])[0]
    return json.loads(data[20:20 + jlen]), data[28 + jlen:]


def write_glb(path, J, binary):
    js = json.dumps(J, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    maps.write_atomic(path, struct.pack('<4sII', b'glTF', 2, 28 + len(js) + len(binary))
                      + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(binary), b'BIN\0') + binary)


def pack_colours(J, binary):
    """The exporter leaves 16-bit vertex colours unpacked (most of the file): pack them with meshopt like the rest.
    The binary chunk is rebuilt: packed data in buffer 0, the unpacked layout in the fallback buffer."""
    from io_scene_gltf2.io.exp.meshopt import MeshoptEncoder
    settings = {'gltf_meshopt_extension': 'EXT_meshopt_compression'}
    fallback = next(i for i, b in enumerate(J['buffers']) if 'extensions' in b)
    colours = {J['accessors'][i]['bufferView'] for m in J['meshes'] for p in m['primitives']
               for a, i in p['attributes'].items() if a.startswith('COLOR_')}
    out = bytearray()
    for k, view in enumerate(J['bufferViews']):
        ext = view.get('extensions', {}).get('EXT_meshopt_compression')
        start = view.get('byteOffset', 0)
        if ext:
            chunk = binary[ext['byteOffset']:ext['byteOffset'] + ext['byteLength']]
            ext['byteOffset'] = len(out)
        elif k in colours:
            rgba = np.frombuffer(binary, np.uint16, view['byteLength'] // 2, start).reshape(-1, 4)
            chunk = MeshoptEncoder.encode_attribute('COLOR', rgba, 8, settings)[0]
            view['extensions'] = {'EXT_meshopt_compression': {
                'buffer': 0, 'byteOffset': len(out), 'byteLength': len(chunk), 'byteStride': 8, 'count': len(rgba),
                'mode': 'ATTRIBUTES'}}
            view.update(buffer=fallback, byteOffset=J['buffers'][fallback]['byteLength'], byteStride=8)
            J['buffers'][fallback]['byteLength'] += view['byteLength']
        else:
            chunk = binary[start:start + view['byteLength']]
            view['byteOffset'] = len(out)
        out += chunk + b'\0' * (-len(chunk) % 4)
    J['buffers'][0]['byteLength'] = len(out)
    return bytes(out)


with step('export'):
    # props: one mesh with the two light colours and _FACE.
    for ob in (props_ob, thin_ob):
        ca = ob.data.color_attributes
        ca.remove(ca['albedo'])
    bpy.ops.object.select_all(action='DESELECT')
    thin_ob.select_set(True)
    props_ob.select_set(True)
    bpy.context.view_layer.objects.active = props_ob
    bpy.ops.object.join()
    props_ob.name = props_ob.data.name = 'props'
    me = props_ob.data
    corners = {}
    for name in ('lamp', 'sky'):
        c = np.empty(len(me.loops) * 4, np.float32)
        me.color_attributes[name].data.foreach_get('color', c)
        corners[name] = np.clip(c.reshape(-1, 4), 0, 1)
    baked_mean = {name: c[:, :3].mean(axis=0) for name, c in corners.items()}
    # The exporter writes the render colour as COLOR_0 (with no material; with one, it follows the material's nodes).
    # Asked for a second colour it fills COLOR_0 with white, so the sky light leaves as a custom attribute instead,
    # renamed COLOR_1 below. That attribute stores 8-bit sRGB, plenty for the soft sky light.
    me.color_attributes.remove(me.color_attributes['sky'])
    me.color_attributes.new('_SKY', 'BYTE_COLOR', 'CORNER').data.foreach_set('color', corners['sky'].ravel())
    for m, name in ((me, 'lamp'), (lens_ob.data, 'color')):
        m.materials.clear()
        m.color_attributes.render_color_index = m.color_attributes.find(name)
        m.color_attributes.active_color = m.color_attributes[name]

    # The exporter's meshopt position filter keeps 12 bits per point, relative to the point's largest coordinate:
    # 15 cm steps 300 m out. 16 bits make that 9 mm there and 2 mm by the tower.
    try:
        import io_scene_gltf2.io.exp.meshopt as meshopt
        meshopt.EXP_FILTER_BITS = 16
    except (ImportError, AttributeError):
        log('!! could not raise the meshopt position precision; check the kerbs')
    bpy.ops.object.select_all(action='DESELECT')
    for ob in (ground_ob, props_ob, lens_ob):
        ob.select_set(True)
    glb = os.path.join(MODELS, 'ground.glb')
    tmp = os.path.join(OUT, 'export.glb')
    bpy.ops.export_scene.gltf(
        filepath=tmp, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
        export_normals=False, export_texcoords=False, export_materials='NONE', export_vertex_color='ACTIVE',
        export_all_vertex_colors=False, export_attributes=True, export_extras=False,
        export_meshopt_compression_enable=True,
    )
    J, binary = read_glb(tmp)
    os.remove(tmp)

    # What the site will load: meshes, attributes, and that COLOR_0 is the lamp light and COLOR_1 the sky.
    found = {}
    for mesh in J['meshes']:
        for prim in mesh['primitives']:
            if '_SKY' in prim['attributes']:
                prim['attributes']['COLOR_1'] = prim['attributes'].pop('_SKY')
            found[mesh['name']] = prim['attributes']
            log(f"glb mesh {mesh['name']}: {J['accessors'][prim['indices']]['count'] // 3} triangles, "
                f"{J['accessors'][prim['attributes']['POSITION']]['count']} points; "
                + ', '.join(f"{a} {J['accessors'][i]['type']}/{J['accessors'][i]['componentType']}"
                            for a, i in prim['attributes'].items()))
    assert {n.split('-')[0] for n in found} >= {'ground', 'props', 'emissive'}, found.keys()
    assert {'COLOR_0', 'COLOR_1'} <= set(found['props']) and 'COLOR_2' not in found['props'], found['props']
    exported = {}
    for a in ('COLOR_0', 'COLOR_1'):
        acc = J['accessors'][found['props'][a]]
        view = J['bufferViews'][acc['bufferView']]
        assert acc['componentType'] == 5123 and acc['type'] == 'VEC4' and acc.get('normalized'), acc
        assert 'extensions' not in view, view
        rgba = np.frombuffer(binary, np.uint16, acc['count'] * 4, view.get('byteOffset', 0)).reshape(-1, 4)
        exported[a] = (rgba[:, :3] / 65535).mean(axis=0)
    # The exported means weigh shared points once, the baked ones every corner: close, not equal.
    log(f"COLOR_0 mean {exported['COLOR_0'].round(4).tolist()} (lamp {baked_mean['lamp'].round(4).tolist()}), "
        f"COLOR_1 mean {exported['COLOR_1'].round(4).tolist()} (sky {baked_mean['sky'].round(4).tolist()})")
    for a, right, wrong in (('COLOR_0', 'lamp', 'sky'), ('COLOR_1', 'sky', 'lamp')):
        assert abs(exported[a] - baked_mean[right]).sum() < abs(exported[a] - baked_mean[wrong]).sum(), a
    before = len(binary)
    binary = pack_colours(J, binary)
    write_glb(glb, J, binary)
    # GLTFLoader keeps POSITION/COLOR_0 as position/color and lowercases other names.
    sky_attr = 'color_1'
    face_attr = '_face' if '_FACE' in found['props'] else None
    log(f'ground.glb {os.path.getsize(glb) / 1024:.0f} KB (colours packed: data {before / 1024:.0f} -> '
        f'{len(binary) / 1024:.0f} KB); skyAttr {sky_attr}, faceAttr {face_attr}')

baked = {
    'version': int(time.time()),
    'K': round(K, 5),
    'Ks': round(Ks, 6),
    'skyConst': [round(float(v), 6) for v in SKY_CONST],
    'regions': {k: {'rect': r} for k, r in REGIONS.items()},
    'blend': L['blend'],
    'skyAttr': sky_attr,
    'faceAttr': face_attr,
    'paint': {'top': L['paintMap']['top'], 'bottom': L['paintMap']['bottom'], **PAINT},
    'slab': SLAB,
    'glows': GLOWS,
    'decal': L['decal'],
    'levels': L['levels'],
}
maps.write_atomic(BAKED, json.dumps(baked, indent=1).encode())
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'ground.blend'))

for f in sorted(os.listdir(MODELS)):
    if f.startswith('ground'):
        log(f'  {f:28} {os.path.getsize(os.path.join(MODELS, f)) / 1024:8.1f} KB')
log('timings: ' + ', '.join(f'{n} {t:.1f}s' for n, t in TIMES))
for kind, name, t in BAKES:
    log(f'  bake {kind:6} {name:40} {t:6.1f}s')
if QUICK:
    # A full bake: 4x the pixels and more samples on the maps, more samples on the props, more calibration passes;
    # denoising and encoding grow with the pixels.
    F = L['quality']['final']
    pixels_ratio = (F['scale'] / Q['scale']) ** 2
    est = time.time() - T0 + sum(t * (pixels_ratio - 1) for n, t in TIMES if n in ('denoise', 'encode maps'))
    for kind, name, t in BAKES:
        if kind == 'map':
            est += t * (pixels_ratio * F['samples'] / Q['samples'] - 1)
        elif kind == 'vertex':
            est += t * (F['vsamples'] / Q['vsamples'] - 1)
        else:
            est += t * (F['calib'] / Q['calib'] - 1)
    log(f'estimated full bake (no --quick): about {est / 60:.0f} min (scaled from these bake times)')
log('done')
