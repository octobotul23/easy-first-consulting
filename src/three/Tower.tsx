import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { Stop } from '../content/types';
import { getStops, lift } from '../state/elevator';
import {
  COLORS,
  EXTRA_LEVELS,
  FLOOR_H,
  FLOOR_SIGN_W,
  FRONT_Z,
  LANDING_Z,
  OFFICE_SIGN_W,
  SHAFT_D,
  SHAFT_W,
  SIGN_Z,
  SLAB_T,
  TOWER_D,
  TOWER_W,
  WING_W,
  WING_X,
} from './constants';
import { additive, glassMaterial, hdr } from './glass';
import { BOX, Instanced, PLANE, type Item, type V3 } from './Instanced';
import { glowTexture, gradientTexture, lineGlowTexture, lobbySignTexture, signTexture, splitLabel } from './textures';

const HALF_PI = Math.PI / 2;
const INNER_H = FLOOR_H - SLAB_T;
/**
 * Lift lobby on each service floor: a lit wall facing the lift doors, with the floor's sign.
 * The camera looks from the left, so the sign sits a little right of centre to show up
 * in the middle of the open doors.
 */
const LOBBY_Z = LANDING_Z - 2.3;
const LOBBY_SIGN_X = 0.5;
/** Depth of the three linear LED rows under each ceiling (front, middle, back of the floor). */
const ROWS = [FRONT_Z - 0.6, FRONT_Z - 3.4, FRONT_Z - 6.2];
/** Width of the building core seen behind the lift on half-walled floors. */
const CORE_W = WING_W * 0.42;

/**
 * A set of lights in one instanced mesh. Each instance has its colour (over-bright for light sources)
 * and its resting brightness; when the lift reaches its floor the brightness is multiplied, up to cap.
 */
interface Lit {
  items: Item[];
  level: number[];
  base: number[];
  tint: THREE.Color[];
  colors: THREE.Color[];
  gain: number;
  cap: number;
}
const lit = (gain: number, cap: number): Lit => ({ items: [], level: [], base: [], tint: [], colors: [], gain, cap });
const add = (t: Lit, it: Item, level: number, base: number, tint: THREE.Color) => {
  t.items.push(it);
  t.level.push(level);
  t.base.push(base);
  t.tint.push(tint);
};


/**
 * Inside walls: a thin wash of light under the ceiling, then ruby, plum and night down to the floor
 * (the contact shadow is in the gradient). The walls are no longer the light: the ceiling lines are.
 */
const WALL: [number, string][] = [
  [0, '#ffe7cf'],
  [0.04, '#f2b892'],
  [0.18, '#b0645a'],
  [0.45, '#5a2a3a'],
  [0.8, '#2a1420'],
  [1, '#150a11'],
];
/** The lit stone wall facing the lift on each service floor (it carries the floor's sign, in dark ink). */
const LOBBY_WALL: [number, string][] = [
  [0, '#fff4e8'],
  [0.15, '#f3e2cf'],
  [0.7, '#dcc3aa'],
  [1, '#a3826c'],
];

function createMaterials() {
  const wallTex = gradientTexture(WALL);
  const lobbyTex = gradientTexture(LOBBY_WALL);
  const glowTex = lineGlowTexture();
  const spotTex = glowTexture();
  return {
    wallTex,
    lobbyTex,
    glowTex,
    spotTex,
    slab: new THREE.MeshStandardMaterial({ color: COLORS.slab, roughness: 0.38, metalness: 0.1, envMapIntensity: 0.6 }),
    metal: new THREE.MeshStandardMaterial({ color: COLORS.metal, roughness: 0.34, metalness: 0.9 }),
    glass: glassMaterial({ tint: COLORS.glass, body: 0.16, edge: 0.9, reflect: 1.7 }),
    // Light sources: instance colours carry over-bright values; the tone mapping rolls them off to warm white.
    strip: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    ceiling: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    panel: new THREE.MeshBasicMaterial({ color: hdr(COLORS.led, 2.2) }),
    wall: new THREE.MeshBasicMaterial({ map: wallTex, dithering: true }),
    lobbyWall: new THREE.MeshBasicMaterial({ map: lobbyTex, dithering: true }),
    pools: additive(spotTex),
    neon: new THREE.MeshBasicMaterial({ color: hdr(COLORS.neon, 4) }),
    halo: additive(glowTex, COLORS.neonSoft, 0.5),
    haloWide: additive(glowTex, COLORS.neonWide, 0.22),
    floorWood: new THREE.MeshStandardMaterial({ color: '#3a2219', roughness: 0.22, metalness: 0, envMapIntensity: 0.8 }),
    furniture: new THREE.MeshStandardMaterial({ color: '#2a1d22', roughness: 0.6, metalness: 0.15 }),
    furnitureLight: new THREE.MeshStandardMaterial({ color: '#9a8070', roughness: 0.7 }),
    leaf: new THREE.MeshStandardMaterial({ color: '#2d4a32', roughness: 0.8 }),
  };
}
type TowerMaterials = ReturnType<typeof createMaterials>;

type Kind = 'lobby' | 'floor' | 'hidden' | 'office' | 'extra';

/** Deterministic 0..1 noise per floor and wing, so the upper floors look randomly occupied. */
const noise = (l: number, w: number) => {
  const x = Math.sin(l * 12.9898 + w * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

interface Props {
  stops: Stop[];
  /** Name of every level (index = level). */
  labels: string[];
  /** Level of the contact office (the top stop). */
  top: number;
  officeSign: string;
  signs: boolean;
}

export function Tower({ stops, labels, top, officeSign, signs }: Props) {
  const roof = top + EXTRA_LEVELS + 1;
  const totalH = roof * FLOOR_H;

  const kinds = useMemo(() => {
    const served = new Set(stops.map((s) => s.level));
    return Array.from({ length: roof }, (_, l): Kind => {
      if (l === 0) return 'lobby';
      if (l === top) return 'office';
      if (l > top) return 'extra';
      return served.has(l) ? 'floor' : 'hidden';
    });
  }, [stops, roof, top]);

  /** How bright the warm interior light of each floor is, before the lift highlights it. */
  const baseLight = (l: number, wing: number) => {
    const k = kinds[l];
    if (k === 'lobby' || k === 'office') return 0.95;
    if (k === 'floor') return 0.8;
    if (k === 'hidden') return 0.3;
    const n = noise(l, wing);
    return n < 0.25 ? 0.08 : 0.18 + n * 0.32;
  };

  const mats = useMemo(createMaterials, []);
  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => m.dispose());
    },
    [mats],
  );

  /* ---------- Structure: slabs, spandrels, mullions, glass ---------- */
  const structure = useMemo(() => {
    const slabs: Item[] = [];
    const metal: Item[] = [];
    for (let l = 0; l <= roof; l++) {
      const y = l * FLOOR_H - SLAB_T / 2;
      for (const sx of [-1, 1]) slabs.push({ p: [sx * WING_X, y, 0], s: [WING_W, SLAB_T, TOWER_D] });
      slabs.push({ p: [0, y, -SHAFT_D / 2], s: [SHAFT_W, SLAB_T, TOWER_D - SHAFT_D] });
      // Core walls on both sides of the lift lobby: its lit wall shows only through the open lift doors.
      if (kinds[l] === 'floor' || kinds[l] === 'hidden') {
        for (const sx of [-1, 1]) {
          slabs.push({ p: [sx * (SHAFT_W / 2 + 0.06), l * FLOOR_H + INNER_H / 2, (LANDING_Z + LOBBY_Z) / 2], s: [0.12, INNER_H, LANDING_Z - LOBBY_Z] });
        }
      }
      if (l === 0) continue;
      // Dark bands where each slab meets the glass
      for (const sx of [-1, 1]) {
        metal.push({ p: [sx * WING_X, y, FRONT_Z + 0.05], s: [WING_W, SLAB_T + 0.06, 0.14] });
        metal.push({ p: [sx * (TOWER_W / 2 + 0.05), y, 0], s: [0.14, SLAB_T + 0.06, TOWER_D] });
        metal.push({ p: [sx * (SHAFT_W / 2 - 0.05), y, FRONT_Z - SHAFT_D / 2], s: [0.14, SLAB_T + 0.06, SHAFT_D] });
      }
      metal.push({ p: [0, y, -TOWER_D / 2 - 0.05], s: [TOWER_W, SLAB_T + 0.06, 0.14] });
    }
    // Vertical mullions
    const mull = (x: number, z: number) => metal.push({ p: [x, totalH / 2, z], s: [0.07, totalH, 0.11] });
    for (const sx of [-1, 1]) {
      const n = Math.round(WING_W / 1.75);
      for (let i = 0; i <= n; i++) mull(sx * (SHAFT_W / 2 + (WING_W * i) / n), FRONT_Z + 0.06);
      const nz = Math.round(TOWER_D / 1.85);
      for (let i = 1; i < nz; i++) {
        const z = -TOWER_D / 2 + (TOWER_D * i) / nz;
        metal.push({ p: [sx * (TOWER_W / 2 + 0.06), totalH / 2, z], s: [0.11, totalH, 0.07] });
      }
    }
    const nb = Math.round(TOWER_W / 1.9);
    for (let i = 0; i <= nb; i++) mull(-TOWER_W / 2 + (TOWER_W * i) / nb, -TOWER_D / 2 - 0.06);
    // Crown
    metal.push({ p: [0, totalH + 0.55, 0], s: [TOWER_W + 0.24, 1.1, TOWER_D + 0.24] });
    metal.push({ p: [0, totalH + 2.1, -1], s: [TOWER_W * 0.56, 2.2, TOWER_D * 0.55] });
    for (let i = -3; i <= 3; i++) metal.push({ p: [i * 1.6, totalH + 3.6, FRONT_Z - 1.6], s: [0.12, 5, 0.6] });
    // Entrance canopy over the lobby
    metal.push({ p: [0, FLOOR_H - 0.16, FRONT_Z + 1.4], s: [SHAFT_W + 6.4, 0.2, 2.8] });

    // Back to front: an instanced mesh is drawn in this order and never sorted, and the camera is always
    // in front of the tower (or inside the office), so the far panes must come first.
    const glass: Item[] = [
      { p: [0, totalH / 2, -TOWER_D / 2], s: [TOWER_W, totalH, 0.04] },
      { p: [-SHAFT_W / 2, totalH / 2, FRONT_Z - SHAFT_D / 2], s: [0.04, totalH, SHAFT_D] },
      { p: [SHAFT_W / 2, totalH / 2, FRONT_Z - SHAFT_D / 2], s: [0.04, totalH, SHAFT_D] },
      { p: [-TOWER_W / 2, totalH / 2, 0], s: [0.04, totalH, TOWER_D] },
      { p: [TOWER_W / 2, totalH / 2, 0], s: [0.04, totalH, TOWER_D] },
      { p: [-WING_X, totalH / 2, FRONT_Z], s: [WING_W, totalH, 0.04] },
      { p: [WING_X, totalH / 2, FRONT_Z], s: [WING_W, totalH, 0.04] },
    ];
    return { slabs, metal, glass };
  }, [roof, totalH, kinds]);

  /**
   * Which back wall a floor-wing has. Full: a lit wall across the wing (the left wing of every service
   * floor keeps one, a dark ground behind its name). Core: only the building core behind the lift.
   * None: the floor is open to the city behind the tower, as real towers are at night.
   */
  const backWall = (l: number, wing: number): 'full' | 'core' | 'none' => {
    const k = kinds[l];
    if (k === 'lobby') return 'full';
    if (k === 'office') return 'none';
    if (k === 'floor') return wing === 0 ? 'full' : 'core';
    const n = noise(l + 13, wing);
    return n < 0.35 ? 'full' : n < 0.75 ? 'core' : 'none';
  };

  /** Colour of the ceiling LEDs: neutral on the service floors, warmer or cooler floor by floor above. */
  const ledTint = (l: number, wing: number) => {
    const k = kinds[l];
    if (k !== 'extra' && k !== 'hidden') return hdr(COLORS.led, 2.6);
    const n = noise(l + 31, wing);
    if (n < 0.1) return hdr(COLORS.ledCool, 1.6);
    return hdr(n < 0.55 ? COLORS.led3000 : COLORS.led4000, 2.4);
  };

  /* ---------- Light: floor-edge strips, ceiling LED rows, walls, pools of light ---------- */
  const light = useMemo(() => {
    const strips = lit(2.4, 2.2);
    const ceil = lit(2.0, 2.2);
    const walls = lit(1.6, 2.0);
    const lobby = lit(0.6, 1.15);
    const pools = lit(2.4, 2.2);
    const white = new THREE.Color('#ffffff');
    const stripTint = hdr(COLORS.warm, 1.8);
    const floorPool = hdr(COLORS.wash, 0.32);
    const rowPool = hdr(COLORS.led, 0.22);
    const ceilWash = hdr(COLORS.wash, 0.2);
    const down: V3 = [-HALF_PI, 0, 0];
    const up: V3 = [HALF_PI, 0, 0];

    for (let l = 0; l < roof; l++) {
      const y0 = l * FLOOR_H;
      const k = kinds[l];
      for (const [wi, sx] of [-1, 1].entries()) {
        const b = baseLight(l, wi);
        const x = sx * WING_X;
        add(strips, { p: [x, y0 + 0.035, FRONT_Z - 0.12], s: [WING_W - 0.08, 0.05, 0.05] }, l, b, stripTint);
        // The office has its own ceiling panels: only the row by the window there.
        const tint = ledTint(l, wi);
        for (const z of k === 'office' ? ROWS.slice(0, 1) : ROWS) {
          add(ceil, { p: [x, y0 + INNER_H - 0.03, z], s: [WING_W - 0.7, 0.03, 0.12] }, l, b, tint);
        }
        if (k === 'office') continue;

        if (b > 0.15) {
          add(pools, { p: [x, y0 + 0.012, FRONT_Z - 3.0], s: [WING_W - 1.0, 7.0, 1], r: down }, l, b, floorPool);
          // The LED rows mirrored, blurred, in the polished floor
          for (const z of ROWS) add(pools, { p: [x, y0 + 0.014, z], s: [WING_W - 0.9, 0.45, 1], r: down }, l, b, rowPool);
          add(pools, { p: [x, y0 + INNER_H - 0.012, FRONT_Z - 3.0], s: [WING_W - 0.6, 7.5, 1], r: up }, l, b, ceilWash);
        }

        const back = backWall(l, wi);
        const wy = y0 + INNER_H / 2;
        const wz = -TOWER_D / 2 + 0.25;
        if (back === 'full') add(walls, { p: [x, wy, wz], s: [WING_W - 0.1, INNER_H, 1] }, l, b * 0.9, white);
        else if (back === 'core') add(walls, { p: [sx * (SHAFT_W / 2 + CORE_W / 2), wy, wz], s: [CORE_W, INNER_H, 1] }, l, b * 0.9, white);
      }
      if (k === 'floor' || k === 'hidden') {
        add(lobby, { p: [0, y0 + INNER_H / 2, LOBBY_Z], s: [SHAFT_W, INNER_H, 1] }, l, baseLight(l, 3) * 0.85, white);
      } else if (k !== 'office') {
        add(walls, { p: [0, y0 + INNER_H / 2, -TOWER_D / 2 + 0.3], s: [SHAFT_W + 0.1, INNER_H, 1] }, l, baseLight(l, 3) * 0.85, white);
      }
    }

    // Office 902: warm pools on the wooden floor under its ceiling panels
    const oy = top * FLOOR_H + 0.012;
    const ob = baseLight(top, 0);
    for (const sx of [-1, 1]) add(pools, { p: [sx * WING_X, oy, -0.4], s: [WING_W - 0.8, 7.5, 1], r: down }, top, ob, floorPool);
    add(pools, { p: [0, oy, -2], s: [SHAFT_W, 4.6, 1], r: down }, top, ob, floorPool);

    const sets = { strips, ceil, walls, lobby, pools };
    for (const t of Object.values(sets)) t.colors = t.tint.map((c, i) => c.clone().multiplyScalar(t.base[i]));
    return sets;
  }, [kinds, roof, top]);

  const stripRef = useRef<THREE.InstancedMesh>(null);
  const ceilRef = useRef<THREE.InstancedMesh>(null);
  const wallRef = useRef<THREE.InstancedMesh>(null);
  const lobbyRef = useRef<THREE.InstancedMesh>(null);
  const poolRef = useRef<THREE.InstancedMesh>(null);

  /* ---------- Signs ---------- */
  const signItems = useMemo(() => {
    if (!signs) return [];
    const out: { key: string; tex: THREE.Texture; p: V3; s: [number, number]; level: number }[] = [];
    for (let l = 1; l < top; l++) {
      if (kinds[l] !== 'floor' || !labels[l]) continue;
      const { texture, aspect } = signTexture(splitLabel(labels[l]), { align: 'center', plate: true });
      const w = FLOOR_SIGN_W;
      out.push({ key: `s${l}`, tex: texture, p: [-WING_X, l * FLOOR_H + 1.6, SIGN_Z], s: [w, w / aspect], level: l });
      const lobbyTex = lobbySignTexture(l, labels[l]);
      out.push({ key: `l${l}`, tex: lobbyTex, p: [LOBBY_SIGN_X, l * FLOOR_H + 1.5, LOBBY_Z + 0.03], s: [1.75, 0.875], level: l });
    }
    if (officeSign) {
      const { texture, aspect } = signTexture(splitLabel(officeSign, 26), { align: 'center', plate: true });
      const w = OFFICE_SIGN_W;
      out.push({ key: 'office', tex: texture, p: [WING_X, top * FLOOR_H + 1.75, SIGN_Z], s: [w, w / aspect], level: top });
    }
    return out;
  }, [signs, top, kinds, labels, officeSign]);
  useEffect(() => () => signItems.forEach((s) => s.tex.dispose()), [signItems]);
  const signMats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);

  /* ---------- Office 902: neon outline ---------- */
  const office = useMemo(() => {
    const y0 = top * FLOOR_H;
    const y1 = y0 + INNER_H;
    const neon: Item[] = [];
    const halo: Item[] = [];
    const wide: Item[] = [];
    const t = 0.07;
    /** A tight glow card on the tube, and a wide faint one a little further out: the magenta bleeding into the dusk. */
    const glow = (p: V3, out: V3, len: number, r?: V3) => {
      halo.push({ p, s: [len, 0.6, 1], r });
      wide.push({ p: [p[0] + out[0] * 0.04, p[1], p[2] + out[2] * 0.04], s: [len + 1.2, 2.6, 1], r });
    };
    for (const sx of [-1, 1]) {
      for (const y of [y0 + 0.04, y1 - 0.04]) {
        neon.push({ p: [sx * WING_X, y, FRONT_Z + 0.1], s: [WING_W, t, t] });
        glow([sx * WING_X, y, FRONT_Z + 0.14], [0, 0, 1], WING_W + 0.6);
        neon.push({ p: [sx * (TOWER_W / 2 + 0.1), y, 0], s: [t, t, TOWER_D] });
        glow([sx * (TOWER_W / 2 + 0.14), y, 0], [sx, 0, 0], TOWER_D + 0.6, [0, sx * HALF_PI, 0]);
      }
      for (const x of [TOWER_W / 2 + 0.1, SHAFT_W / 2 - 0.02]) {
        neon.push({ p: [sx * x, (y0 + y1) / 2, FRONT_Z + 0.1], s: [t, INNER_H, t] });
        glow([sx * x, (y0 + y1) / 2, FRONT_Z + 0.14], [0, 0, 1], INNER_H + 0.4, [0, 0, HALF_PI]);
      }
    }
    // Soft lit ceiling panels inside the office
    const panels: Item[] = [];
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) panels.push({ p: [sx * WING_X, y1 - 0.02, -3 + i * 2.6], s: [WING_W - 1.2, 0.02, 0.5] });
    panels.push({ p: [0, y1 - 0.02, -2], s: [SHAFT_W - 0.6, 0.02, 4] });
    return { neon, halo, wide, panels, y0 };
  }, [top]);

  /* ---------- The lift lights up the floor it is at ---------- */
  const last = useRef({ level: -1, door: -1, stop: -2 });
  // New light sets start at their resting colours: recompute the highlight on the next frame.
  useEffect(() => {
    last.current.level = -1;
  }, [light]);
  const col = useMemo(() => new THREE.Color(), []);
  useFrame(() => {
    const L = last.current;
    if (L.level === lift.level && L.door === lift.door && L.stop === lift.doorStop) return;
    L.level = lift.level;
    L.door = lift.door;
    L.stop = lift.doorStop;
    const openLevel = lift.doorStop >= 0 ? (getStops()[lift.doorStop]?.level ?? -1) : -1;
    const boost = (l: number) => Math.max(0, 1 - Math.abs(lift.level - l) * 1.4) * 0.16 + (l === openLevel ? lift.door * 0.45 : 0);
    // Relative: the floor you arrive at gets about twice as bright and rolls off to white, without clipping.
    const update = (mesh: THREE.InstancedMesh | null, set: Lit) => {
      if (!mesh) return;
      for (let i = 0; i < set.level.length; i++) {
        const k = Math.min(set.cap, 1 + boost(set.level[i]) * set.gain);
        mesh.setColorAt(i, col.copy(set.tint[i]).multiplyScalar(set.base[i] * k));
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    update(stripRef.current, light.strips);
    update(ceilRef.current, light.ceil);
    update(wallRef.current, light.walls);
    update(lobbyRef.current, light.lobby);
    update(poolRef.current, light.pools);
    signItems.forEach((s, i) => {
      const m = signMats.current[i];
      if (m) m.opacity = 0.78 + Math.min(1, boost(s.level) * 1.6) * 0.22;
    });
  });

  return (
    <group>
      <Instanced items={structure.slabs} material={mats.slab} />
      <Instanced items={structure.metal} material={mats.metal} />
      <Instanced items={light.walls.items} colors={light.walls.colors} geometry={PLANE} material={mats.wall} meshRef={wallRef} />
      <Instanced items={light.lobby.items} colors={light.lobby.colors} geometry={PLANE} material={mats.lobbyWall} meshRef={lobbyRef} />
      <Instanced items={light.strips.items} colors={light.strips.colors} material={mats.strip} meshRef={stripRef} />
      <Instanced items={light.ceil.items} colors={light.ceil.colors} material={mats.ceiling} meshRef={ceilRef} />
      {/* Additive light on floors and ceilings: drawn before the glass (it is behind it). */}
      <Instanced items={light.pools.items} colors={light.pools.colors} geometry={PLANE} material={mats.pools} meshRef={poolRef} />

      {signItems.map((s, i) => (
        <mesh key={s.key} position={s.p} scale={[s.s[0], s.s[1], 1]} geometry={PLANE} renderOrder={2}>
          <meshBasicMaterial
            ref={(m) => {
              signMats.current[i] = m;
            }}
            map={s.tex}
            transparent
            opacity={0.8}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}

      {/* Office 902 */}
      <Instanced items={office.neon} material={mats.neon} />
      <Instanced items={office.wide} geometry={PLANE} material={mats.haloWide} renderOrder={3} />
      <Instanced items={office.halo} geometry={PLANE} material={mats.halo} renderOrder={3} />
      <Instanced items={office.panels} material={mats.panel} />
      <OfficeInterior y={office.y0} mats={mats} />

      {/* Lobby canopy light */}
      <mesh position={[0, FLOOR_H - 0.27, FRONT_Z + 1.4]} scale={[SHAFT_W + 6, 0.02, 2.4]} geometry={BOX} material={mats.panel} />

      <Instanced items={structure.glass} material={mats.glass} renderOrder={1} />
    </group>
  );
}

/** Office 902: the room the doors open onto on the top stop. */
function OfficeInterior({ y, mats: m }: { y: number; mats: TowerMaterials }) {
  const items = useMemo(() => {
    const wood: Item[] = [{ p: [0, y + 0.005, -0.6], s: [TOWER_W - 0.2, 0.01, TOWER_D - 2.6] }];
    const dark: Item[] = [
      // Desk facing the window, with a low credenza and a sofa
      { p: [3.8, y + 0.76, -2.6], s: [2.6, 0.06, 1.1] },
      { p: [2.65, y + 0.38, -2.6], s: [0.08, 0.76, 1.0] },
      { p: [4.95, y + 0.38, -2.6], s: [0.08, 0.76, 1.0] },
      { p: [3.8, y + 0.55, -1.75], s: [0.62, 1.1, 0.12] },
      { p: [3.8, y + 0.26, -1.95], s: [0.62, 0.08, 0.62] },
      { p: [-4.6, y + 0.24, -3.2], s: [3.2, 0.48, 1.0] },
      { p: [-4.6, y + 0.62, -3.62], s: [3.2, 0.5, 0.2] },
      { p: [-4.6, y + 0.2, -1.8], s: [1.3, 0.4, 0.8] },
      { p: [0, y + 0.3, -4.6], s: [5.5, 0.6, 0.5] },
    ];
    const lightWood: Item[] = [
      { p: [-4.6, y + 0.52, -3.15], s: [3.0, 0.08, 0.9] },
      { p: [-4.6, y + 0.42, -1.8], s: [1.2, 0.04, 0.72] },
    ];
    const leaves: Item[] = [
      { p: [6.9, y + 0.9, -4.4], s: [0.9, 1.2, 0.9] },
      { p: [-7.0, y + 0.9, -4.4], s: [0.9, 1.2, 0.9] },
    ];
    const pots: Item[] = [
      { p: [6.9, y + 0.25, -4.4], s: [0.6, 0.5, 0.6] },
      { p: [-7.0, y + 0.25, -4.4], s: [0.6, 0.5, 0.6] },
    ];
    return { wood, dark, lightWood, leaves, pots };
  }, [y]);
  return (
    <group>
      <Instanced items={items.wood} material={m.floorWood} />
      <Instanced items={items.dark} material={m.furniture} />
      <Instanced items={items.lightWood} material={m.furnitureLight} />
      <Instanced items={items.pots} material={m.furniture} />
      <Instanced items={items.leaves} geometry={LEAF} material={m.leaf} />
    </group>
  );
}

const LEAF = new THREE.IcosahedronGeometry(0.5, 1);

