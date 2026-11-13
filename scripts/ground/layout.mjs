/**
 * The ground around the tower, v2 "Plinth and Necklace": the podium and its forecourt, the boulevard, the side
 * gardens, the back street, the park with its walks, plazas and palm groves, and the lit quay along the canal.
 * Writes src/three/ground/layout.json, which the Blender build (build.py) bakes into the ground and its props,
 * and which check.mjs projects through the site's camera before anything is baked.
 *
 *   node scripts/ground/layout.mjs && node scripts/ground/check.mjs
 *
 * Axes and units are the site's: metres, x to the right, y up, z towards the street camera; the tower stands on
 * the origin with its entrance facing +z. Points on the ground are [x, z]. Colours are sRGB.
 * Every position, height and colour comes from the ground v2 design; the tall things were placed against the
 * camera (text, lift panel, the phone's shore line), so run check.mjs after moving any of them.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../../src/three/ground/layout.json');

/** Ground levels: the lobby floor, the pavements / park / promenade, the carriageways behind 0.15 m kerbs. */
const PODIUM = 0;
const WALK = -0.45;
const ROAD = -0.6;
/** The ground runs this far to each side; lamps, palms and benches stop at FURNISHED (the far light map's edge). */
const X = 1000;
const FURNISHED = 300;
/** The tower: 17 × 11 m, entrance facade at z 5.5, the lift shaft a 3.1 × 2.4 m notch in the middle of it. */
const FRONT_Z = 5.5;
const SHAFT_X = 3.1 / 2;
const SHAFT_Z = FRONT_Z - 2.4;
/** The canal edge: the ground stops at the upstand's inner face; the upstand's far top edge hides the water. */
const QUAY = { inner: -215.4, z: -216, top: 0.05 };

const r2 = (n) => Math.round(n * 100) / 100;
const pt = (p) => p.map(r2);

/** Seeded random numbers (mulberry32), so every run writes the same plan. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The parts of [a, b] left after taking out the gaps [[g0, g1], ...]. */
function cut([a, b], gaps) {
  const out = [];
  let from = a;
  for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (g0 > from) out.push([from, Math.min(g0, b)]);
    from = Math.max(from, g1);
  }
  if (from < b) out.push([from, b]);
  return out;
}

const L = {
  version: 2,
  seed: 11,
  quality: {
    quick: { samples: 64, vsamples: 32, scale: 0.5, webp: 85, calib: 1 },
    final: { samples: 512, vsamples: 256, scale: 1, webp: 90, calib: 3 },
  },
  levels: { podium: PODIUM, walk: WALK, road: ROAD },
  /** The ground mesh [x0, z0, x1, z1]: nothing is drawn beyond the quay. */
  bounds: [-X, QUAY.inner, X, 110],
  /** Two baked rectangles: fine light near the tower, coarser light out to the canal. */
  regions: {
    near: { rect: [-54.5, -29.5, 54.5, 60], lightmap: [2048, 1680], sky: [512, 420], zones: [1024, 840] },
    far: { rect: [-300, -218, 300, 62], lightmap: [2048, 1024], sky: [512, 256], zones: [1024, 512] },
  },
  /** Metres inside the near rectangle over which the far light blends into the near light. */
  blend: 0.75,
  /**
   * Road paint: the boulevard (top half) and the back street (bottom half). The top reaches z 48.5 rather than 48
   * so the 1.2 m tactile band on the far pavement (z 47..48.2) fits whole.
   */
  paintMap: { size: [2048, 1024], top: [-64, 20, 64, 48.5], bottom: [-64, -27, 64, -15] },
  /** Albedo per surface class at tone 0, .25, .5, .75, 1. */
  palette: {
    pavers: ['#6d6560', '#6d6560', '#5a534e', '#4f4945', '#4f4945'], // 0 pavements, .5 opposite block, .75 neighbour blocks
    stone: ['#9c948c', '#b5aa9e', '#a8998c', '#3a3436', '#2a2427'], // 0 granite, .25 promenade, .5 limestone, .75 charcoal, 1 contact band
    // Asphalt at a weathered road's albedo (about 0.07 linear) and lawn at about 0.06: darker and the dusk sky
    // alone left them black, far under the 0.07 / 0.05 screen levels below.
    asphalt: ['#4f4a49', '#4f4a49', '#4f4a49', '#8c4436', '#8c4436'], // 0 asphalt, 1 the terracotta jogging track
    planting: ['#3a4a30', '#3a4a30', '#3a4a30', '#3a4a30', '#3a4a30'],
  },
  /** Prop colours (boxes name them in `m`). */
  albedo: {
    kerb: '#8f877d',
    granite: '#9c948c',
    limestone: '#a8998c',
    charcoal: '#3a3436',
    contact: '#2a2427',
    blackGranite: '#1c1719', // the upstand along the tower's facade
    bronze: '#5e4b55', // lanterns: the tower's own metal
    pole: '#3a3034', // street poles, dark bronze
    steel: '#8e8d8b', // brushed stainless anti-ram bollards
    hedge: '#33442a',
    bougainvillea: '#b8326e',
    trunk: '#6d5a45',
    frond: '#46632c',
    boot: '#3a2d23',
    teak: '#6e4a30',
    upstand: '#8f8579', // the quay upstand
    handrail: '#a9a7a3',
    tower: '#3f3f3f', // the bake proxy: albedo 0.05 (linear)
  },
  /**
   * The dusk sky: the only light where no lamp reaches. Its strength is a start value that the bake calibrates
   * so that unlit ground shows these screen levels (sRGB), measured on 1 m discs at `probes`.
   */
  sky: {
    // A muted mauve rather than the video's own magenta: as the only light on unlit stone, a saturated sky
    // turned pale paving hot pink and the lawns black (green has almost nothing to reflect in magenta light).
    zenith: '#18141f',
    horizon: '#4b3a42',
    strength: 1.0,
    target: { asphalt: [0.065, 0.075], pavers: [0.095, 0.105], planting: [0.045, 0.055] },
    probes: [
      { p: [-200, 27], surface: 'asphalt' },
      { p: [-200, 53], surface: 'pavers' },
      { p: [-120, -60], surface: 'planting' },
    ],
  },
  heights: [],
  surfaces: [],
  paint: [],
  quay: { ...QUAY, x: [-X, X], rail: { y: 0.65, r: 0.025 } },
  tower: {
    h: 58,
    /** Its footprint, exactly: the body and the two front wings either side of the lift notch. */
    parts: [
      [-8.5, -5.5, 8.5, SHAFT_Z],
      [-8.5, SHAFT_Z, -SHAFT_X, FRONT_Z],
      [SHAFT_X, SHAFT_Z, 8.5, FRONT_Z],
    ],
    /** The lift notch: podium granite in the ground (the lift stands in it), open in the bake proxy (a glass well). */
    notch: [-SHAFT_X, SHAFT_Z, SHAFT_X, FRONT_Z],
    canopy: { rect: [-4.75, FRONT_Z, 4.75, 8.3], y: [3.05, 3.35] },
    /** The lobby's lit glass, as glowing panels just in front of it (they face the right of a → b). */
    glow: [
      { a: [-SHAFT_X, FRONT_Z + 0.02], b: [SHAFT_X, FRONT_Z + 0.02], y: [0.2, 3.1], color: '#ffd9b0', strength: 6 },
      { a: [-8.5, FRONT_Z + 0.02], b: [-1.6, FRONT_Z + 0.02], y: [0.2, 3.1], color: '#ffcf9e', strength: 3.5 },
      { a: [1.6, FRONT_Z + 0.02], b: [8.5, FRONT_Z + 0.02], y: [0.2, 3.1], color: '#ffcf9e', strength: 3.5 },
    ],
    /** The lit floors above: every facade of the proxy glows faintly. */
    facade: { color: '#ffd2a1', strength: 0.25 },
  },
  /**
   * Light groups: every lit prop names one. Energies are start values; the bake scales each group until the
   * screen level (sRGB, as the site renders it) on its probes lands in `target`. glow = sprite size in metres.
   */
  groups: {
    pole: { light: 'SPOT', color: '#ffd1a3', energy: 700, cone: 140, blend: 0.4, glow: 0.6, target: { asphalt: [0.22, 0.26], pavers: [0.3, 0.38] } },
    canopy: { light: 'AREA', color: '#ffe2c4', energy: 400, size: [9.0, 2.4], target: { stone: [0.5, 0.55] } },
    lantern: { light: 'POINT', color: '#ffb46b', energy: 150, glow: 0.45, target: { pavers: [0.25, 0.28] } },
    bollard: { light: 'SPOT', color: '#ffb46b', energy: 12, cone: 170, glow: 0.22, target: { any: [0.24, 0.26] } },
    uplight: { light: 'SPOT', color: '#ff9a45', energy: 40, cone: 40, aim: 'up', target: { trunk: [0.35, 0.45] } },
    necklace: { light: 'SPOT', color: '#ffa757', energy: 150, cone: 140, glow: 0.5, target: { stone: [0.3, 0.35] } },
    cap: { light: 'SPOT', color: '#ffd2a1', energy: 4, cone: 60, aim: 'up', glow: 0.15 },
    led: { emit: true, color: '#ffd2a1' },
    rail: { emit: true, color: '#ffa757', strength: 3 },
  },
  probes: [],
  palms: [],
  poles: [],
  lanterns: [],
  bollards: [],
  lamps: [],
  boxes: [],
  strips: [],
  /** A soft magenta disc on the forecourt (the site fades it out as the lift rises). */
  decal: { p: [0, 0.01, 6.5], d: 4, color: '#ff2f6d' },
  /** Everything that stands up, for check.mjs: { kind, id, x, z, y0 (base), h (height), r (crown or glow radius) }. */
  tall: [],
};

// ---------------------------------------------------------------- heights (default: WALK; later entries win)
const height = (rect, y) => L.heights.push({ rect, y });
/** Carriageways: the boulevard both ways, the back street, and the two cross streets that run through both. */
const ROADS = [
  [-X, 22, X, 32.5],
  [-X, 36.5, X, 47],
  [-X, -25, X, -17],
  [-66, -29.5, -58, 47],
  [58, -29.5, 66, 47],
];
for (const r of ROADS) height(r, ROAD);
height([-26, -13, 26, 17], PODIUM);
// Front steps across the podium's width (risers at z 17.0, 17.4, 17.8) and the narrow back steps.
height([-26, 17.0, 26, 17.4], -0.15);
height([-26, 17.4, 26, 17.8], -0.3);
height([-6, -13.4, 6, -13.0], -0.15);
height([-6, -13.8, 6, -13.4], -0.3);
// Dropped kerbs at the zebra (x ±4): the pavement steps down 4 cm at a time over the 1.2 m tactile band to a 3 cm
// lip; the median refuge is cut through at that lip height.
height([-4, 20.8, 4, 21.2], -0.49);
height([-4, 21.2, 4, 21.6], -0.53);
height([-4, 21.6, 4, 22], -0.57);
height([-4, 32.5, 4, 36.5], -0.57);
height([-4, 47, 4, 47.4], -0.57);
height([-4, 47.4, 4, 47.8], -0.53);
height([-4, 47.8, 4, 48.2], -0.49);

// ---------------------------------------------------------------- surfaces (default: pavers tone 0; later entries win)
const surface = (shape, cls, tone = 0) => L.surfaces.push({ ...shape, cls, tone });
const PAVERS = 'pavers';
const STONE = 'stone';
const GRANITE = 0;
const PROMENADE = 0.25;
const LIMESTONE = 0.5;
const CHARCOAL = 0.75;
const CONTACT = 1;

// The city blocks either side, across the boulevard, and the planted median.
surface({ rect: [-X, -29.5, -69.5, 47] }, PAVERS, 0.75);
surface({ rect: [69.5, -29.5, X, 47] }, PAVERS, 0.75);
surface({ rect: [-X, 60, X, 110] }, PAVERS, 0.5);
surface({ rect: [-X, 32.5, X, 36.5] }, 'planting');
// Neighbour blocks: 6 × 6 m planting squares every 18 m.
for (const s of [-1, 1]) {
  for (let x = 78; x + 3 <= FURNISHED; x += 18) {
    for (const z of [-4, 14]) surface({ rect: [s > 0 ? x - 3 : -x - 3, z - 3, s > 0 ? x + 3 : -x + 3, z + 3] }, 'planting');
  }
}
// From the park to the water: lawn, the palm strip, the terracotta track, the pale granite promenade with
// charcoal bands running towards the water every 7.5 m.
surface({ rect: [-X, -188, X, -29.5] }, 'planting');
surface({ rect: [-X, -195, X, -188] }, 'planting');
surface({ rect: [-X, -197.5, X, -195] }, 'asphalt', 1);
surface({ rect: [-X, QUAY.inner, X, -197.5] }, STONE, PROMENADE);
for (let x = -FURNISHED + 3.75; x < FURNISHED; x += 7.5) surface({ rect: [r2(x - 0.3), QUAY.inner, r2(x + 0.3), -197.5] }, STONE, CHARCOAL);

// Side gardens with their 3 m paths, then the podium.
for (const s of [-1, 1]) {
  surface({ rect: s < 0 ? [-54.5, -13, -26, 17] : [26, -13, 54.5, 17] }, 'planting');
  surface({ rect: s < 0 ? [-54.5, 0.5, -26, 3.5] : [26, 0.5, 54.5, 3.5] }, PAVERS);
}
surface({ rect: [-26, -13, 26, 17] }, STONE, GRANITE);
// Around the tower: a 1 m dark contact band; the lift notch keeps the granite; honed charcoal under the canopy.
surface({ rect: [-9.5, -6.5, 9.5, 6.5] }, STONE, CONTACT);
surface({ rect: L.tower.notch }, STONE, GRANITE);
surface({ rect: L.tower.canopy.rect }, STONE, CHARCOAL);
// Limestone steps (front and back), the forecourt's charcoal band along the kerb, and the limestone carpet from
// the canopy over the steps to the kerb.
surface({ rect: [-26, 17, 26, 17.8] }, STONE, LIMESTONE);
surface({ rect: [-6, -13.8, 6, -13] }, STONE, LIMESTONE);
surface({ rect: [-54.5, 20.7, 54.5, 21.7] }, STONE, CHARCOAL);
surface({ rect: [-4.75, 8.3, 4.75, 22] }, STONE, LIMESTONE);
surface({ rect: [-4, 32.5, 4, 36.5] }, STONE, LIMESTONE); // the median refuge

// Park walks (3 m pavers), the granite plazas, and the limestone Bay Axis with charcoal edges, which runs
// through plaza E to the belvedere. The walks carry on through the palm strip to the track.
surface({ rect: [-69.5, -195, -66.5, -29.5] }, PAVERS);
surface({ rect: [66.5, -195, 69.5, -29.5] }, PAVERS);
surface({ seg: { a: [-17.5, -29.5], b: [-61, -143], w: 3 } }, PAVERS);
surface({ rect: [-160, -149.1, 60, -146.1] }, PAVERS);
surface({ circle: [-68, -150, 12] }, STONE, GRANITE);
surface({ rect: [10.6, -188, 17.4, -29.5] }, STONE, CHARCOAL);
surface({ circle: [14, -120, 12] }, STONE, GRANITE);
surface({ rect: [11, -188, 17, -29.5] }, STONE, LIMESTONE);
surface({ rect: [2, QUAY.inner, 26, -188] }, STONE, LIMESTONE); // the belvedere, through the strip and the track

// A 0.3 m granite kerb on the walk side of every kerb, then the carriageways over it: where two roads meet the
// band is painted over, so it only stays where a road meets a pavement, the median or the park.
for (const [x0, z0, x1, z1] of ROADS) {
  const bands = [[x0, z0 - 0.3, x1, z0], [x0, z1, x1, z1 + 0.3], [x0 - 0.3, z0, x0, z1], [x1, z0, x1 + 0.3, z1]];
  for (const b of bands) if (Math.abs(b[0]) < X && Math.abs(b[2]) < X) surface({ rect: b.map(r2) }, STONE, GRANITE);
}
for (const r of ROADS) surface({ rect: r }, 'asphalt');

// ---------------------------------------------------------------- road paint (0.2 m lines)
const line = (a, b, c, dash, w = 0.2) => L.paint.push({ a, b, w, c, ...(dash && { dash }) });
const block = (rect, c) => L.paint.push({ rect, c });
const DASH = [3, 6];
// Boulevard. Near carriageway (z 22..32.5, traffic -x): stop line at x +6, zebra over x ±4. Far carriageway
// (z 36.5..47, traffic +x): stop line at x -6. Lines stop at the crossing and at the cross streets (x ±58).
for (const z of [25.5, 29.0]) {
  line([58, z], [6, z], 'white', DASH);
  line([-4, z], [-58, z], 'white', DASH);
}
for (const z of [40.0, 43.5]) {
  line([-58, z], [-6, z], 'white', DASH);
  line([4, z], [58, z], 'white', DASH);
}
for (const [z, c] of [[22.3, 'white'], [46.7, 'white'], [32.2, 'yellow'], [36.8, 'yellow']]) {
  line([-58, z], [-4, z], c);
  line([4, z], [58, z], c);
}
// Zebra: ten 0.5 m bars at 1 m pitch per carriageway, starting 0.5 m from each kerb.
for (let i = 0; i < 10; i++) {
  block([-4, 22.5 + i, 4, 23 + i], 'white');
  block([-4, 37 + i, 4, 37.5 + i], 'white');
}
line([6, 22], [6, 32.5], 'white', null, 0.3);
line([-6, 36.5], [-6, 47], 'white', null, 0.3);
// Yellow tactile paving on the dropped kerbs at both ends of each half of the crossing.
for (const [z0, z1] of [[20.8, 22], [32.5, 33.7], [35.3, 36.5], [47, 48.2]]) block([-4, z0, 4, z1], 'yellow');
// Back street (z -17..-25): a centre dash, and zebras on the Bay Axis (x 11..17) and at the diagonal's start
// (x -20..-15), seven bars centred across the 8 m road.
for (const [a, b] of cut([-58, 58], [[-20.5, -14.5], [10.5, 17.5]])) line([a, -21], [b, -21], 'white', DASH);
for (const [x0, x1] of [[11, 17], [-20, -15]]) {
  for (let i = 0; i < 7; i++) block([x0, r2(-18.25 - i), x1, r2(-17.75 - i)], 'white');
}

// ---------------------------------------------------------------- props
const rnd = random(L.seed);
const mm = (v) => Math.round(v * 1000) / 1000;
/** One entry of the tall list; r is the crown's or the glow's radius (half the length for benches and hedges). */
const tall = (kind, id, [x, z], y0, h, r) => L.tall.push({ kind, id, x: r2(x), z: r2(z), y0, h: r2(h), r });
const box = (c, s, m, seg, ry = 0) => L.boxes.push({ c: c.map(mm), s: s.map(mm), ry: r2(ry), m, seg });
const strip = (a, b, group, strength, w = 0.04) => L.strips.push({ a, b, w, group, strength });

// Each lit prop names its light group, and its glow group g: the park, the axis and the quay dim their glows at
// street level (g 1); the street and the forecourt keep theirs (g 0).
function palm(p, h, { uplights = 1, r = 3.0 } = {}) {
  const q = pt(p);
  L.palms.push({ p: q, h, base: WALK, seed: Math.floor(rnd() * 1e6), uplights, group: 'uplight', g: 1 });
  tall('palm', `palm ${q}`, q, WALK, h, r);
}
function pole(p, h, arms, arm) {
  L.poles.push({ p, h, arms, arm, base: WALK, group: 'pole', g: 0 });
  // The shaft's top and each lamp head at the end of its arm.
  const id = `pole ${p}`;
  tall('pole', id, p, WALK, h, 0.6);
  for (const [dx, dz] of arms) tall('pole', id, [p[0] + dx * arm, p[1] + dz * arm], WALK, h, 0.6);
}
function lantern(p, g) {
  const q = pt(p);
  L.lanterns.push({ p: q, h: 4.5, base: WALK, group: 'lantern', g });
  tall('lantern', `lantern ${q}`, q, WALK, 4.5, 0.45);
}
function bollard(p, h, kind, g, base = WALK) {
  const q = pt(p);
  const group = { lit: 'bollard', cap: 'cap' }[kind];
  L.bollards.push({ p: q, h, base, kind, ...(group && { group }), g });
  if (h > 0) tall('bollard', `bollard ${q}`, q, base, h, kind === 'lit' ? 0.22 : 0.11);
}
function lamp(p) {
  L.lamps.push({ p, h: 3.5, base: WALK, group: 'necklace', g: 1 });
  tall('lamp', `lamp ${p}`, p, WALK, 3.5, 0.5);
}
/** A hedge along x (from x0 to x1 at z) or along z (from z0 to z1 at x); for check.mjs, a point every ≤ 6 m. */
function hedge(axis, [a, b], at, h, depth, base = WALK, seg = 1) {
  const len = b - a;
  const mid = (a + b) / 2;
  if (axis === 'x') box([mid, base + h / 2, at], [len, h, depth], 'hedge', seg);
  else box([at, base + h / 2, mid], [depth, h, len], 'hedge', seg);
  const n = Math.ceil(len / 6);
  for (let i = 0; i < n; i++) {
    const u = a + (len * (i + 0.5)) / n;
    tall('hedge', `hedge ${axis} ${r2(at)}`, axis === 'x' ? [u, at] : [at, u], base, h, r2(len / n / 2));
  }
}

// Palms (one model, solid fronds): two groves on a golden-angle spiral, the plaza corners, the gate to the
// belvedere, and a row along the quay. Each has an uplight (two for the gate palms).
function grove([cx, cz], seed) {
  for (let i = 0; i < 5; i++) {
    const a = seed + 2.39996 * i;
    const r = 2.0 * Math.sqrt(i + 0.6);
    palm([cx + Math.cos(a) * r, cz + Math.sin(a) * r], 8.5 + ((7 * i + 3 * seed) % 5) * 0.5);
  }
}
const PLAZA_W = [-68, -150];
const PLAZA_E = [14, -120];
const CORNERS = [[-8.5, -8.5], [8.5, -8.5], [-8.5, 8.5], [8.5, 8.5]];
grove([-50, -94], 1);
for (const [cx, cz] of [PLAZA_W, PLAZA_E]) for (const [dx, dz] of CORNERS) palm([cx + dx, cz + dz], 9.5);
grove([26, -162], 5);
for (const x of [2, 26]) palm([x, -191.5], 11, { uplights: 2, r: 3.2 });
// The quay row, every 12 m, except at the belvedere's gate (its two gate palms stand there) and in the phone
// shot's side gaps beside the tower (where the crowns would rise above the shore). It runs on behind the desktop
// lift panel: which stretch the panel covers depends on the window's size, and its frosted glass hides it.
for (let x = -294; x <= 294; x += 12) {
  const gap = [[-12, 36], [-60, -24], [36, 84]].some(([a, b]) => x >= a && x <= b);
  if (!gap) palm([x, -191.5], 9.5);
}

// Street poles, dark bronze tapered octagons. Boulevard: 10 m in the median, an arm over each carriageway
// (none at x -12, where it would stand in front of the tower). Back street: 6.5 m on the south pavement (at 7 m the
// x -54 head came within 7 px of the first screen's text on a 2560 x 1440 monitor), the arm
// reaching over the road. Cross streets: 9 m on the outer pavement and on the median's nose, the arm over the road.
for (const x of [-156, -120, -84, -48, 12, 48, 84, 120, 156]) pole([x, 34.5], 10, [[0, 1], [0, -1]], 2.5);
for (const x of [32, 54, 90, 120, 150]) for (const s of [-1, 1]) pole([s * x, -28.6], 6.5, [[0, 1]], 4);
for (const s of [-1, 1]) for (const z of [34.5, 8]) pole([s * 68, z], 9, [[-s, 0]], 2.5);

// Lanterns, 4.5 m, bronze with a hexagonal head: the garden paths, the plazas (9 m out on their axes), the west
// and east walks (1.5 m outside them), the cross walk (1.5 m south of it) and one side of the diagonal.
for (const x of [-46, -32, 32, 46]) lantern([x, 2], 0);
for (const [cx, cz] of [PLAZA_W, PLAZA_E]) for (const [dx, dz] of [[0, 9], [9, 0], [0, -9], [-9, 0]]) lantern([cx + dx, cz + dz], 1);
for (const z of [-38, -56, -74, -92, -110, -128, -164, -182]) lantern([-71, z], 1);
// The east walk keeps only the spots that stay clear of the desktop lift panel on every desktop screen and browser
// window (z -44 to -122 and beyond -152 fall behind it on some): it runs down the right edge of the screen, where
// the panel hides that stretch anyway, and phones do not see it.
for (const z of [-38, -128, -146]) lantern([71, z], 1);
for (const x of [-150, -130, -110, -90, -50, -10, 30]) lantern([x, -150.6], 1);
for (const p of [[-34.3, -66.4], [-41.6, -85.4], [-48.8, -104.3], [-56.1, -123.2]]) lantern(p, 1);

// Lit bollards (hooded light band): rings in the plazas, the diagonal's other side, staggered low ones along the
// Bay Axis (so it does not read as a runway), and the cross walk's north edge.
for (const [cx, cz] of [PLAZA_W, PLAZA_E]) {
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) * Math.PI) / 4;
    bollard([cx + Math.cos(a) * 6.5, cz + Math.sin(a) * 6.5], 1.0, 'lit', 1);
  }
}
{
  // Nine along the diagonal walk, opposite its lanterns: level with the design's points from (−17.5, −32) to
  // (−56.2, −130.7), but 1.8 m east of the walk's centre line (just off the 3 m walk) instead of on it.
  const [a, b] = [[-17.5, -29.5], [-61, -143]];
  const n = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u = [(b[0] - a[0]) / n, (b[1] - a[1]) / n];
  const east = [-u[1], u[0]];
  for (let i = 0; i < 9; i++) {
    const p = [-17.5 - (38.7 * i) / 8, -32 - (98.7 * i) / 8];
    const along = (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1];
    bollard([a[0] + u[0] * along + east[0] * 1.8, a[1] + u[1] * along + east[1] * 1.8], 1.0, 'lit', 1);
  }
}
for (const z of [-36, -68, -100, -140, -172]) bollard([10.6, z], 0.6, 'lit', 1);
for (const z of [-52, -84, -156, -184]) bollard([17.4, z], 0.6, 'lit', 1);
for (const x of [-150, -134, -118, -102, -86, -54, -38, -22, -6, 26, 42]) bollard([x, -145.6], 1.0, 'lit', 1);

// The forecourt (on the podium): brushed-stainless anti-ram bollards either side of the carpet, flush retractable
// caps with LED rings across it, and four limestone benches, two each side of x ±11. No trees on the podium.
for (const s of [-1, 1]) for (let x = 6; x <= 13.5; x += 1.5) bollard([s * x, 12.6], 0.9, 'steel', 0, PODIUM);
for (let x = -3.75; x <= 3.76; x += 1.5) bollard([x, 12.6], 0, 'cap', 0, PODIUM);
for (const s of [-1, 1]) {
  for (const x of [8.6, 13.4]) {
    box([s * x, PODIUM + 0.225, 15], [3.6, 0.45, 0.6], 'limestone', 0.5);
    tall('bench', `bench ${s * x},15`, [s * x, 15], PODIUM, 0.45, 1.8);
  }
}

// Planters (also the anti-ram line): granite-clad, 0.6 m, a 0.35 m clipped hedge with bougainvillea in flower.
for (const s of [-1, 1]) {
  const cx = s * 18;
  box([cx, 0.3, 9], [8, 0.6, 5], 'granite', 0.5);
  box([cx, 0.775, 9], [7.6, 0.35, 4.6], 'hedge', 0.5);
  for (let i = 0; i < 7; i++) {
    const fx = cx + (rnd() - 0.5) * 6.8;
    const fz = 9 + (rnd() - 0.5) * 3.8;
    box([fx, 0.93, fz], [0.3 + rnd() * 0.2, 0.1, 0.25 + rnd() * 0.15], 'bougainvillea', 1, rnd() * Math.PI);
  }
  tall('planter', `planter ${cx},9`, [cx, 9], PODIUM, 0.98, 4);
}

// The podium's 0.45 m walls (sides and back) carry a 0.3 m granite coping that overhangs 4 cm, with a shadow-gap
// LED under it; the walls themselves come from the heights.
for (const s of [-1, 1]) {
  box([s * 25.89, -0.005, 1.98], [0.3, 0.07, 30.04], 'granite', 0.5);
  box([s * 16.02, -0.005, -12.89], [20.04, 0.07, 0.3], 'granite', 0.5);
  strip([s * 26.02, -0.06, -13], [s * 26.02, -0.06, 17], 'led', 4, 0.03);
  strip([s * 26, -0.06, -13.02], [s * 6, -0.06, -13.02], 'led', 4, 0.03);
}
// Black granite upstand, 0.30 × 0.12 m, along the facade; open across the entrance (x ±4.75).
for (const s of [-1, 1]) {
  box([s * 6.685, 0.15, FRONT_Z + 0.06], [3.87, 0.3, 0.12], 'blackGranite', 0.5);
  box([s * 8.56, 0.15, -0.06], [0.12, 0.3, 11.12], 'blackGranite', 0.5);
}
box([0, 0.15, -5.56], [17, 0.3, 0.12], 'blackGranite', 0.5);

// LED lines: along the carpet, under each step's nosing.
for (const s of [-1, 1]) strip([s * 4.9, 0.005, 8.6], [s * 4.9, 0.005, 16.6], 'led', 2);
for (const [z, y] of [[17.0, 0], [17.4, -0.15], [17.8, -0.3]]) strip([-26, r2(y - 0.02), z + 0.005], [26, r2(y - 0.02), z + 0.005], 'led', 6, 0.03);

// Hedges: 0.8 m in the median (inside x ±54.5, open at the refuge and around the poles), 0.6 m round the side
// gardens on their pavement edges (open at the path), 0.6 m along the palm strip (open at the walks and the
// belvedere).
for (const [a, b] of cut([-54, 54], [[-5, 5], [-48.8, -47.2], [11.2, 12.8], [47.2, 48.8]])) hedge('x', [a, b], 34.5, 0.8, 1.2);
for (const s of [-1, 1]) {
  const [a, b] = s < 0 ? [-54.3, -26.2] : [26.2, 54.3];
  hedge('x', [a, b], 16.5, 0.6, 0.6);
  hedge('x', [a, b], -12.5, 0.6, 0.6);
  for (const span of cut([-12.2, 16.2], [[0.5, 3.5]])) hedge('z', span, s * 54, 0.6, 0.6);
}
for (const span of cut([-FURNISHED, FURNISHED], [[-69.5, -66.5], [2, 26], [66.5, 69.5]])) hedge('x', span, -188.3, 0.6, 0.6);

// The necklace: 3.5 m lamps every 12 m along the promenade, and granite-and-teak benches facing the water.
// Like the quay palms, the row runs on behind the desktop lift panel: a gap would break it as seen from the upper
// floors, and the panel's dark frosted glass hides what is behind it (scripts/ground/check.mjs accepts the row).
for (let x = -FURNISHED; x <= FURNISHED; x += 12) lamp([x, -213]);
for (let x = 6 - 24 * 12; x <= 294; x += 24) {
  box([x, WALK + 0.185, -211], [2.4, 0.37, 0.55], 'granite', 0.6);
  box([x, WALK + 0.41, -211], [2.4, 0.08, 0.55], 'teak', 0.6);
  tall('bench', `bench ${x},-211`, [x, -211], WALK, 0.45, 1.2);
}
// The quay upstand (0.5 m, top y 0.05) with a 50 mm stainless handrail floating at 0.65 m (no posts: they would
// shimmer) and an LED strip under it. Finer pieces where the lamps light them.
for (const [a, b] of [[-X, -FURNISHED], [-FURNISHED, FURNISHED], [FURNISHED, X]]) {
  const seg = a === -FURNISHED ? 0.5 : 2;
  box([(a + b) / 2, (WALK + QUAY.top) / 2, (QUAY.inner + QUAY.z) / 2], [b - a, QUAY.top - WALK, QUAY.inner - QUAY.z], 'upstand', seg);
  box([(a + b) / 2, L.quay.rail.y, (QUAY.inner + QUAY.z) / 2], [b - a, 0.05, 0.05], 'handrail', seg);
}
strip([-X, 0.62, -215.7], [X, 0.62, -215.7], 'rail', 3, 0.03);

// ---------------------------------------------------------------- calibration probes (1 m discs)
// Each where its group clearly dominates: away from the tower's glow and from every other group's light.
// The canopy is the exception: it is calibrated last, on top of the lobby's spill, as the cap of the forecourt.
const probe = (group, p, surf) => L.probes.push({ group, p, surface: surf });
probe('pole', [-48, 27.5], 'asphalt'); // boulevard, the near carriageway
probe('pole', [-48, 48.5], 'pavers'); // the camera-side pavement, beyond the far carriageway
probe('pole', [-90, -21], 'asphalt'); // back street
// The canopy's cap goes where its pool reads brightest: on the limestone just past the charcoal under it, which
// reflects a tenth as much. Calibrated on the charcoal, the pool would burn the carpet white.
probe('canopy', [0, 8.8], 'stone');
// Both 2.25 m from their lantern: at different distances the falloff alone puts one over the target, one under.
probe('lantern', [-34.25, 2], 'pavers'); // garden path
probe('lantern', [-68.75, -92], 'pavers'); // west walk
probe('bollard', [-118, -146.4], 'any'); // cross walk
probe('bollard', [11.2, -68], 'any'); // Bay Axis
probe('uplight', [-150, -191.5], 'trunk'); // quay palms
probe('uplight', [210, -191.5], 'trunk');
probe('necklace', [-120, -211.5], 'stone'); // promenade, clear of the charcoal bands and the benches
probe('necklace', [204, -211.5], 'stone');

// ---------------------------------------------------------------- write
// The counts the design fixes: a mismatch means a list above was edited by mistake.
const count = (list, f = () => true) => list.filter(f).length;
const expect = {
  palms: [count(L.palms), 59],
  poles: [count(L.poles), 23],
  lanterns: [count(L.lanterns), 34],
  'lit bollards': [count(L.bollards, (b) => b.kind === 'lit'), 45],
  'anti-ram bollards': [count(L.bollards, (b) => b.kind === 'steel'), 12],
  caps: [count(L.bollards, (b) => b.kind === 'cap'), 6],
  'necklace lamps': [count(L.lamps), 51],
};
const wrong = Object.entries(expect).filter(([, [n, want]]) => n !== want);
if (wrong.length) throw new Error(`layout: ${wrong.map(([k, [n, want]]) => `${n} ${k} (expected ${want})`).join(', ')}`);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(L, null, 1));
const kinds = L.tall.reduce((a, t) => ((a[t.kind] = (a[t.kind] ?? 0) + 1), a), {});
console.log(
  `layout v2: ${Object.entries(expect).map(([k, [n]]) => `${n} ${k}`).join(', ')}; ${L.boxes.length} boxes, ` +
    `${L.strips.length} LED strips, ${L.heights.length} heights, ${L.surfaces.length} surfaces, ${L.paint.length} paint marks, ` +
    `${L.probes.length} probes; tall: ${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')} -> ${OUT}`,
);
