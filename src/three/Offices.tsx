import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { DESK, DESK_FRAME, FLOOR_H, FRONT_Z, SHAFT_W, TOWER_D, TOWER_W, WING_W, WING_X } from './constants';
import { hdr } from './glass';
import { BOX, Instanced, PLANE, type Item, type V3 } from './Instanced';

/**
 * The people and furniture inside the tower: open-plan desks with glowing screens, meeting tables,
 * sofas, plants, and people at work (floors 1–8 and the floors above the office), and Office 902 with
 * the desk the camera walks up to. Everything is a few instanced meshes (one draw call each), built
 * once from a seeded random, so every visit shows the same busy building.
 */

export type Kind = 'lobby' | 'floor' | 'hidden' | 'office' | 'extra';

/** Deterministic 0..1 noise per floor and wing, so the upper floors look randomly occupied. */
export const noise = (l: number, w: number) => {
  const x = Math.sin(l * 12.9898 + w * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** How bright the warm interior light of a floor-wing is, before the lift highlights it. */
export function baseLightOf(k: Kind, l: number, wing: number) {
  if (k === 'lobby' || k === 'office') return 0.95;
  if (k === 'floor') return 0.8;
  if (k === 'hidden') return 0.3;
  const n = noise(l, wing);
  return n < 0.25 ? 0.08 : 0.18 + n * 0.32;
}

/**
 * Which back wall a floor-wing has. Full: a lit wall across the wing (the left wing of every service
 * floor keeps one, a dark ground behind its name). Core: only the building core behind the lift.
 * None: the floor is open to the city behind the tower, as real towers are at night.
 */
export function backWallOf(k: Kind, l: number, wing: number): 'full' | 'core' | 'none' {
  if (k === 'lobby') return 'full';
  if (k === 'office') return 'none';
  if (k === 'floor') return wing === 0 ? 'full' : 'core';
  const n = noise(l + 13, wing);
  return n < 0.35 ? 'full' : n < 0.75 ? 'core' : 'none';
}

/* ---------- Shapes and materials ---------- */

// Low-poly on purpose: a few hundred people, seen from the street.
const BODY = new THREE.CapsuleGeometry(0.17, 0.34, 2, 7);
const HEAD = new THREE.SphereGeometry(0.105, 8, 6);
const LEAF = new THREE.IcosahedronGeometry(0.5, 1);

/**
 * Furniture and people: their colour comes from each instance. The rooms are lit by their ceiling
 * lines, not by the sun outside, so each surface also gets a share of its own colour back as light,
 * more on the tops than on the sides: desks and heads read clearly from the street at dusk.
 */
function interiorMaterial(light: number) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.72, metalness: 0.05, envMapIntensity: 0.35 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uInterior = { value: light };
    s.fragmentShader = s.fragmentShader.replace('void main() {', 'uniform float uInterior;\nvoid main() {').replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * uInterior * ( 0.55 + 0.45 * max( normal.y, 0.0 ) );`,
    );
    if (import.meta.env.DEV && !s.fragmentShader.includes('uInterior * (')) console.warn('offices: the shader patch did not apply');
  };
  m.customProgramCacheKey = () => `iris-interior-${light}`;
  return m;
}

/* ---------- Palette (sRGB; dimmed per floor by its light) ---------- */

const TOPS = ['#e6ddd3', '#d6c7b6', '#a9825f', '#c9b39b'];
const FABRIC = ['#5a2a3a', '#4a4f5a', '#6f5a48', '#2f3540', '#7a3b40'];
const CHAIRS = ['#1f1a1e', '#2b2830', '#3a2a30', '#262a33'];
const CLOTHES = ['#e8e2dc', '#2a3550', '#5f5b66', '#1d1a1f', '#b39a80', '#6e2a3a', '#9fb4cc', '#f2efe9', '#3c4a3a', '#24364f'];
const SKIN = ['#e9c2a2', '#d09a78', '#a8714f', '#7a4a32', '#5a3624', '#f0cfb2'];
const HAIR = ['#16100d', '#2b1d15', '#4a3020', '#1a1a1a', '#8a6a45', '#5a4636'];
const SCREENS: [string, number][] = [
  ['#cfe0ff', 1.5],
  ['#ffe9d2', 1.3],
  ['#9fc0ff', 1.25],
  ['#dfe8ff', 1.6],
  ['#bfe7d8', 1.2],
];
const LEAVES = ['#2f5236', '#3a5a2e', '#28462f'];
const METAL = '#2a2226';
const BLACK = '#121013';
const WALNUT = '#4a2d20';
const POT = '#3b2a24';

/** Small seeded random (mulberry32): the same building on every visit. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Part {
  items: Item[];
  colors: THREE.Color[];
}
const part = (): Part => ({ items: [], colors: [] });

/** Everything the interiors draw, one instanced mesh per entry. */
interface Bag {
  boxes: Part;
  screens: Part;
  glow: Part;
  bodies: Part;
  heads: Part;
  leaves: Part;
}

/**
 * Builds rooms into a bag. `f` dims the colours of a dark floor (its lights are low); screens and lamps
 * keep more of their glow, as late at night in a real tower.
 */
function builder(bag: Bag, y0: number, f: number, rnd: () => number) {
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const c = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(f * k);
  const put = (pt: Part, p: V3, s: V3, col: THREE.Color, r?: V3) => {
    pt.items.push({ p, s, r });
    pt.colors.push(col);
  };
  const box = (p: V3, s: V3, col: THREE.Color, r?: V3) => put(bag.boxes, [p[0], y0 + p[1], p[2]], s, col, r);
  const glowK = Math.max(0.45, f);
  const screen = (p: V3, s: [number, number], facing: number, tilt = 0) => {
    const [hex, k] = pick(SCREENS);
    put(bag.screens, [p[0], y0 + p[1], p[2]], [s[0], s[1], 1], hdr(hex, k * glowK), facing > 0 ? [-tilt, 0, 0] : [tilt, Math.PI, 0]);
  };

  /** A head with hair on the back of it; `fx`, `fz` = where the face looks. */
  const head = (x: number, y: number, z: number, fx: number, fz: number) => {
    put(bag.heads, [x, y0 + y, z], [1, 1.08, 1], c(pick(SKIN)));
    put(bag.heads, [x - fx * 0.028, y0 + y + 0.028, z - fz * 0.028], [1.07, 1.02, 1.07], c(pick(HAIR)));
  };
  /** Someone sitting on a seat of the given height, facing along z (fz = ±1). */
  const seated = (x: number, z: number, fz: number, seat = 0.46) => {
    put(bag.bodies, [x, y0 + seat + 0.34, z], [1.1, 1, 0.78], c(pick(CLOTHES)), [0, fz > 0 ? 0 : Math.PI, 0]);
    head(x, seat + 0.81, z + fz * 0.03, 0, fz);
  };
  /** Someone standing, turned by `yaw` (0 = facing +z). */
  const standing = (x: number, z: number, yaw: number) => {
    put(bag.bodies, [x, y0 + 0.74, z], [1.05, 2.05, 0.75], c(pick(CLOTHES)), [0, yaw, 0]);
    head(x, 1.56, z, Math.sin(yaw), Math.cos(yaw));
  };
  /** An office chair whose back is on the `s` side (±1 along z). */
  const chair = (x: number, z: number, s: number, col = c(pick(CHAIRS))) => {
    box([x, 0.46, z], [0.5, 0.07, 0.48], col);
    box([x, 0.8, z + s * 0.25], [0.47, 0.55, 0.05], col);
    box([x, 0.24, z], [0.06, 0.4, 0.06], c(METAL));
    box([x, 0.03, z], [0.52, 0.03, 0.52], c(METAL));
  };
  const plant = (x: number, z: number, big = true) => {
    box([x, big ? 0.28 : 0.2, z], big ? [0.46, 0.56, 0.46] : [0.34, 0.4, 0.34], c(POT));
    put(bag.leaves, [x, y0 + (big ? 1.2 : 0.75), z], big ? [0.85, 1.3, 0.85] : [0.6, 0.65, 0.6], c(pick(LEAVES)), [0, rnd() * 3, 0]);
  };
  /** A sofa for 2–3 facing along z (fz), with a low table in front. */
  const lounge = (x: number, z: number, fz: number, people: number) => {
    const col = c(pick(FABRIC));
    box([x, 0.22, z], [2.1, 0.44, 0.85], col);
    box([x, 0.64, z - fz * 0.34], [2.1, 0.44, 0.18], col);
    for (const e of [-1, 1]) box([x + e * 0.98, 0.5, z], [0.16, 0.3, 0.85], col);
    box([x, 0.4, z + fz * 0.95], [1.0, 0.04, 0.55], c(WALNUT, 1.3));
    box([x, 0.2, z + fz * 0.95], [0.7, 0.36, 0.35], c(METAL));
    for (let i = 0; i < people; i++) seated(x + (i - (people - 1) / 2) * 0.68, z + fz * 0.05, fz, 0.44);
  };
  /** A desk for one; the person sits on the `s` side (±1 along z), the screen on the other. */
  const desk = (x: number, z: number, s: number, top: THREE.Color, busy: boolean) => {
    box([x, 0.74, z], [1.42, 0.035, 0.72], top);
    for (const e of [-1, 1]) box([x + e * 0.69, 0.37, z], [0.035, 0.72, 0.66], c(METAL));
    const mz = z - s * 0.2;
    box([x, 0.83, mz - s * 0.03], [0.05, 0.16, 0.05], c(METAL));
    box([x, 1.04, mz], [0.56, 0.33, 0.025], c(BLACK));
    if (busy || rnd() < 0.3) screen([x, 1.04, mz + s * 0.015], [0.52, 0.29], s);
    if (rnd() < 0.5) box([x + (rnd() < 0.5 ? -0.42 : 0.42), 0.765, z + s * 0.08], [0.3, 0.015, 0.22], c('#e9e4dc'));
    const cx = x + (rnd() - 0.5) * 0.16;
    const cz = z + s * (0.6 + rnd() * 0.12);
    chair(cx, cz, s);
    if (busy) seated(cx, cz - s * 0.04, -s);
  };
  /** Two rows of desks back to back with a low screen between them, along x. */
  const pod = (xs: number[], z: number, busy: number) => {
    const top = c(pick(TOPS));
    for (const x of xs) {
      desk(x, z + 0.37, 1, top, rnd() < busy);
      desk(x, z - 0.37, -1, top, rnd() < busy);
    }
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    box([(x0 + x1) / 2, 0.92, z], [x1 - x0 + 1.42, 0.32, 0.03], c(pick(FABRIC)));
  };
  /** A meeting table along x with chairs on both long sides. */
  const meeting = (x: number, z: number, busy: number, len = 3.2) => {
    box([x, 0.74, z], [len, 0.05, 1.15], c(WALNUT, 1.4));
    for (const e of [-1, 1]) box([x + e * (len / 2 - 0.6), 0.36, z], [0.12, 0.7, 0.5], c(METAL));
    const n = Math.max(2, Math.round(len / 1.05));
    for (let i = 0; i < n; i++) {
      const cx = x + (i - (n - 1) / 2) * 1.02;
      for (const s of [-1, 1]) {
        const cz = z + s * 0.85;
        chair(cx, cz, s);
        if (rnd() < busy) {
          seated(cx, cz - s * 0.04, -s);
          if (rnd() < 0.7) {
            box([cx, 0.775, z + s * 0.28], [0.32, 0.015, 0.22], c(BLACK));
            screen([cx, 0.88, z + s * 0.39], [0.31, 0.2], -s, 0.25);
          }
        }
      }
    }
  };

  return { box, screen, seated, standing, chair, plant, lounge, desk, pod, meeting, pick, c, rnd };
}

/** One wing of an ordinary floor: open-plan desks, a meeting table or a lounge, plants and people about. */
function furnishWing(bag: Bag, k: Kind, l: number, wing: number) {
  const sx = wing === 0 ? -1 : 1;
  const b = baseLightOf(k, l, wing);
  const f = Math.min(1.15, Math.max(0.3, b / 0.8));
  const rnd = seeded(l * 7919 + wing * 104729 + 17);
  const B = builder(bag, l * FLOOR_H, f, rnd);
  const X = (u: number) => sx * (SHAFT_W / 2 + u);
  // Late on a dark floor only a few are still at their desks.
  const busy = k === 'floor' ? 0.62 : b < 0.15 ? 0.08 : 0.4;
  const back = backWallOf(k, l, wing);
  const desks = [X(1.55), X(3.05), X(4.55)];
  const n = noise(l + 57, wing);
  // The left wing of a service floor carries the floor's name on the glass: always calm desks there.
  const layout = k === 'floor' && wing === 0 ? 0 : n < 0.5 ? 0 : n < 0.8 ? 1 : 2;

  if (layout === 0) {
    B.pod(desks, 2.05, busy);
    B.pod(desks, -1.55, busy);
  } else if (layout === 1) {
    B.meeting(X(3.2), 2.0, busy + 0.15);
    B.pod(desks, -1.4, busy);
  } else {
    B.pod(desks, 2.05, busy);
    B.lounge(X(3.2), -3.75, 1, rnd() < busy + 0.2 ? 2 : 0);
    B.plant(X(1.3), -3.9, false);
  }
  // A long low cabinet along a lit back wall, with plants on it.
  if (back === 'full') {
    B.box([X(WING_W / 2), 0.38, -TOWER_D / 2 + 0.55], [WING_W - 1.6, 0.76, 0.45], B.c(WALNUT, 1.2));
    B.plant(X(1.6), -TOWER_D / 2 + 0.55, false);
  }
  // Plants in the corners by the windows, and people talking by the glass.
  B.plant(X(WING_W - 0.45), FRONT_Z - 0.55);
  B.plant(X(WING_W - 0.5), -TOWER_D / 2 + 0.65);
  if (rnd() < busy + 0.15) {
    const u = WING_W - 1.0;
    B.standing(X(u), 3.55, sx > 0 ? Math.PI * 0.85 : -Math.PI * 0.85);
    B.standing(X(u - 0.65), 3.2, sx > 0 ? Math.PI * 0.35 : -Math.PI * 0.35);
  }
  if (rnd() < busy) B.standing(X(0.85 + rnd() * 0.4), 0.2, sx > 0 ? -Math.PI / 2 : Math.PI / 2);
}

/** Office 902: a meeting table, a lounge, a few desks, and the desk facing the lift. */
function furnishOffice(bag: Bag, top: number) {
  const y0 = top * FLOOR_H;
  const rnd = seeded(902);
  const B = builder(bag, y0, 1, rnd);
  // The desk facing the lift: walnut top, a front panel, a credenza and a tall chair behind it.
  const { x, z, w, d } = DESK;
  B.box([x, DESK.top - 0.025, z], [w, 0.05, d], B.c('#6b4630', 1.2));
  B.box([x, 0.4, z + d / 2 - 0.06], [w - 0.1, 0.62, 0.04], B.c(WALNUT));
  for (const e of [-1, 1]) B.box([x + e * (w / 2 - 0.05), 0.37, z], [0.06, 0.74, d - 0.05], B.c(WALNUT));
  // A low back: the window and the city stay in view over it.
  B.box([x, 0.52, z - 0.78], [0.6, 0.07, 0.56], B.c('#2a1d22'));
  B.box([x, 0.84, z - 1.04], [0.62, 0.58, 0.08], B.c('#2a1d22'));
  B.box([x, 0.27, z - 0.8], [0.07, 0.5, 0.07], B.c(METAL));
  B.box([x, 0.03, z - 0.8], [0.6, 0.03, 0.6], B.c(METAL));
  // On the desk: a lamp, a laptop, papers, a small plant.
  B.box([x - 0.78, DESK.top + 0.01, z - 0.1], [0.16, 0.02, 0.16], B.c('#c9a46a'));
  B.box([x - 0.78, DESK.top + 0.2, z - 0.1], [0.02, 0.38, 0.02], B.c('#c9a46a'));
  bag.glow.items.push({ p: [x - 0.78, y0 + DESK.top + 0.42, z - 0.1], s: [0.22, 0.13, 0.22] });
  bag.glow.colors.push(hdr('#ffc98f', 2.2));
  B.box([x + 0.55, DESK.top + 0.01, z - 0.05], [0.34, 0.015, 0.24], B.c('#2e2c33'));
  B.box([x + 0.55, DESK.top + 0.12, z - 0.17], [0.34, 0.22, 0.012], B.c('#2e2c33'), [-0.25, 0, 0]);
  B.box([x + 0.2, DESK.top + 0.008, z + 0.25], [0.24, 0.01, 0.18], B.c('#a89c90'));
  B.plant(x + 0.9, z + 0.05, false);
  // Two guest chairs, to the sides so the picture stays in view.
  for (const e of [-1, 1]) B.chair(x + e * 0.95, z + 1.15, 1, B.c('#5a2a3a'));
  // Credenza under the window, lamps on it.
  B.box([0, 0.36, -4.6], [4.2, 0.72, 0.5], B.c(WALNUT));
  for (const e of [-1, 1]) {
    bag.glow.items.push({ p: [e * 1.6, y0 + 0.98, -4.6], s: [0.26, 0.2, 0.26] });
    bag.glow.colors.push(hdr('#ffc98f', 1.8));
    B.box([e * 1.6, 0.8, -4.6], [0.06, 0.16, 0.06], B.c('#c9a46a'));
  }
  B.box([0.4, 0.8, -4.6], [0.5, 0.16, 0.24], B.c('#6e2a3a'));

  // Left wing: a meeting under way, and a sofa at the back.
  B.meeting(-WING_X, -0.55, 0.65);
  B.lounge(-WING_X, -4.35, 1, 1);
  B.box([-TOWER_W / 2 + 0.4, 0.38, 2.6], [0.45, 0.76, 3.2], B.c(WALNUT));
  B.plant(-TOWER_W / 2 + 0.45, 4.9);
  B.plant(-TOWER_W / 2 + 0.6, -4.9);
  // Right wing: four desks, two armchairs by the window, someone looking out.
  B.pod([WING_X - 0.78, WING_X + 0.78], -0.2, 0.75);
  for (const e of [-1, 1]) {
    const col = B.c('#6f5a48');
    const ax = TOWER_W / 2 - 1.3 + e * 0.55;
    B.box([ax, 0.22, 3.9], [0.75, 0.44, 0.75], col);
    B.box([ax, 0.62, 3.6], [0.75, 0.42, 0.16], col);
  }
  B.box([TOWER_W / 2 - 1.3, 0.3, 4.5], [0.5, 0.04, 0.5], B.c(WALNUT, 1.3));
  B.seated(TOWER_W / 2 - 1.85, 3.95, 1, 0.44);
  B.standing(TOWER_W / 2 - 2.6, -3.9, Math.PI);
  B.plant(TOWER_W / 2 - 0.45, -4.9);
  B.plant(TOWER_W / 2 - 0.5, 4.95);
  // By the lift doors.
  for (const e of [-1, 1]) B.plant(e * 2.25, 2.7);
}

interface Props {
  kinds: Kind[];
  top: number;
  /** The picture on the desk of Office 902 (an address the browser can load). */
  deskImage: string;
}

export function Offices({ kinds, top, deskImage }: Props) {
  const mats = useMemo(
    () => ({
      solid: interiorMaterial(0.55),
      screen: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  const bag = useMemo(() => {
    const b: Bag = { boxes: part(), screens: part(), glow: part(), bodies: part(), heads: part(), leaves: part() };
    kinds.forEach((k, l) => {
      if (k === 'floor' || k === 'hidden' || k === 'extra') for (const w of [0, 1]) furnishWing(b, k, l, w);
    });
    furnishOffice(b, top);
    return b;
  }, [kinds, top]);

  return (
    <group>
      <Instanced items={bag.boxes.items} colors={bag.boxes.colors} material={mats.solid} />
      <Instanced items={bag.bodies.items} colors={bag.bodies.colors} geometry={BODY} material={mats.solid} />
      <Instanced items={bag.heads.items} colors={bag.heads.colors} geometry={HEAD} material={mats.solid} />
      <Instanced items={bag.leaves.items} colors={bag.leaves.colors} geometry={LEAF} material={mats.solid} />
      <Instanced items={bag.screens.items} colors={bag.screens.colors} geometry={PLANE} material={mats.screen} />
      <Instanced items={bag.glow.items} colors={bag.glow.colors} material={mats.screen} />
      <DeskPicture y={top * FLOOR_H} src={deskImage} />
    </group>
  );
}

/**
 * The framed picture on the desk of Office 902 (panel: Settings). Any shape: it is fitted inside
 * DESK_FRAME's w × h and stands on the desk, leaning back a little, facing the lift.
 */
function DeskPicture({ y, src }: { y: number; src: string }) {
  const invalidate = useThree((s) => s.invalidate);
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!src) return;
    let alive = true;
    let loaded: THREE.Texture | null = null;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
      src,
      (t) => {
        if (!alive) {
          t.dispose();
          return;
        }
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        loaded = t;
        setTex(t);
        invalidate();
      },
      undefined,
      () => undefined,
    );
    return () => {
      alive = false;
      loaded?.dispose();
      setTex(null);
    };
  }, [src, invalidate]);

  const img = tex?.image as { width?: number; height?: number } | undefined;
  const aspect = img?.width && img?.height ? img.width / img.height : DESK_FRAME.w / DESK_FRAME.h;
  const w = aspect > DESK_FRAME.w / DESK_FRAME.h ? DESK_FRAME.w : DESK_FRAME.h * aspect;
  const h = w / aspect;
  const border = 0.045;
  const lean = -0.12;
  return (
    <group position={[DESK.x, y + DESK.top + 0.02 + (h + border) / 2, DESK_FRAME.z]} rotation={[lean, 0, 0]}>
      <mesh scale={[w + border, h + border, 0.025]} geometry={BOX}>
        <meshStandardMaterial color="#1c1116" roughness={0.4} metalness={0.6} />
      </mesh>
      {/* A thin gold edge, a dark mat (a logo with a clear background sits on it), the picture */}
      <mesh position={[0, 0, 0.013]} scale={[w + border * 0.45, h + border * 0.45, 1]} geometry={PLANE}>
        <meshStandardMaterial color="#c9a46a" roughness={0.35} metalness={0.8} />
      </mesh>
      <mesh position={[0, 0, 0.0138]} scale={[w, h, 1]} geometry={PLANE}>
        <meshBasicMaterial color="#1e1218" />
      </mesh>
      {tex && (
        <mesh position={[0, 0, 0.0146]} scale={[w, h, 1]} geometry={PLANE}>
          {/* Keyed by the picture: a new map needs a new material (its shader is built for it). */}
          <meshBasicMaterial key={tex.uuid} map={tex} transparent toneMapped />
        </mesh>
      )}
      {/* The stand behind it */}
      <mesh position={[0, -h * 0.12, -0.11]} rotation={[0.45, 0, 0]} scale={[0.05, h * 0.8, 0.015]} geometry={BOX}>
        <meshStandardMaterial color="#1c1116" roughness={0.5} metalness={0.5} />
      </mesh>
    </group>
  );
}
