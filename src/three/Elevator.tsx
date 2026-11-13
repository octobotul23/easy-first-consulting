import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { getStops, lift } from '../state/elevator';
import {
  CABIN_D,
  CABIN_H,
  CABIN_W,
  CABIN_Z,
  COLORS,
  EXTRA_LEVELS,
  FLOOR_H,
  LANDING_Z,
  SHAFT_W,
  SLAB_T,
} from './constants';
import { additive, glassMaterial, hdr } from './glass';
import { BOX, Instanced, PLANE, type Item } from './Instanced';
import { lineGlowTexture } from './textures';

const smooth = (t: number) => t * t * (3 - 2 * t);
type Panels = (THREE.Mesh | null)[];

/** Width of the door opening on each landing. */
export const DOOR_W = 1.8;
export const DOOR_H = 2.5;

function createMaterials() {
  const glow = lineGlowTexture();
  return {
    glow,
    rail: new THREE.MeshStandardMaterial({ color: '#5d4a55', metalness: 0.9, roughness: 0.3 }),
    shaftBack: new THREE.MeshStandardMaterial({ color: '#160c12', metalness: 0.3, roughness: 0.6 }),
    // Brushed champagne steel: reads as lift doors, not as dark holes in the floor.
    landingDoor: new THREE.MeshStandardMaterial({ color: '#b3a3ab', metalness: 1, roughness: 0.3, envMapIntensity: 1 }),
    cabinGlass: glassMaterial({ tint: '#a8507a', body: 0.1, edge: 0.75, reflect: 1.8, roughness: 0.03 }),
    doorGlass: glassMaterial({ tint: '#b45c84', body: 0.12, edge: 0.75, reflect: 2, roughness: 0.03 }),
    cabinMetal: new THREE.MeshStandardMaterial({ color: '#4a3842', metalness: 0.9, roughness: 0.28 }),
    cabinFloor: new THREE.MeshStandardMaterial({ color: '#1a0f14', metalness: 0.4, roughness: 0.2 }),
    lightPanel: new THREE.MeshBasicMaterial({ color: hdr('#ffe6d2', 2.4) }),
    neon: new THREE.MeshBasicMaterial({ color: hdr(COLORS.neon, 4) }),
    halo: additive(glow, COLORS.neonSoft, 0.5),
    haloWide: additive(glow, COLORS.neonWide, 0.22),
    landingGlow: new THREE.MeshBasicMaterial({ color: hdr(COLORS.warm, 1.6) }),
  };
}
export type LiftMaterials = ReturnType<typeof createMaterials>;

/** Shaft, landing doors on every floor and the glass cabin that rides with the scroll. */
export function Elevator({ top }: { top: number }) {
  const roof = top + EXTRA_LEVELS + 1;
  const totalH = roof * FLOOR_H;
  const mats = useMemo(createMaterials, []);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  const cabin = useRef<THREE.Group>(null);
  const cabinLight = useRef<THREE.PointLight>(null);
  /** Door panels: the cabin's (front and back) and each landing's, left then right. */
  const cabinDoors = useRef<Panels>([]);
  const landingDoors = useRef<Record<number, Panels>>({});
  const openedLevel = useRef(-1);

  useFrame(() => {
    const g = cabin.current;
    if (!g) return;
    g.position.y = lift.level * FLOOR_H;
    const o = smooth(lift.door);
    if (cabinLight.current) cabinLight.current.intensity = 7 + o * 6;

    // Glass doors stack towards the corner posts: the outer edge stays, the inner edge opens.
    const outer = CABIN_W / 2 - 0.01;
    const inner = o * (CABIN_W / 2 - 0.16);
    cabinDoors.current.forEach((m, i) => {
      if (!m) return;
      const sx = i % 2 === 0 ? -1 : 1;
      m.position.x = (sx * (inner + outer)) / 2;
      m.scale.x = Math.max(0.001, outer - inner);
    });

    // Landing doors of the floor the lift is parked at.
    const level = lift.doorStop >= 0 ? (getStops()[lift.doorStop]?.level ?? -1) : -1;
    // Landing doors slide into the wall on either side of the opening.
    const slide = (lv: number, amount: number) =>
      landingDoors.current[lv]?.forEach((m, i) => {
        if (!m) return;
        const a = amount * (DOOR_W / 2 - 0.02);
        const b = DOOR_W / 2 + amount * 0.6;
        m.position.x = ((i === 0 ? -1 : 1) * (a + b)) / 2;
        m.scale.x = b - a;
      });
    if (openedLevel.current !== level) {
      slide(openedLevel.current, 0);
      openedLevel.current = level;
    }
    if (level >= 0) slide(level, o);
  });

  return (
    <group>
      {/* Guide rails and the shaft's back wall */}
      {[-1, 1].map((sx) => (
        <mesh key={sx} geometry={BOX} material={mats.rail} position={[sx * (CABIN_W / 2 + 0.2), totalH / 2, CABIN_Z]} scale={[0.1, totalH, 0.16]} />
      ))}
      <LandingWalls roof={roof} mats={mats} />
      {Array.from({ length: roof }, (_, l) => (
        <LandingDoors
          key={l}
          level={l}
          mats={mats}
          doorRef={(i, m) => {
            (landingDoors.current[l] ??= [])[i] = m;
          }}
        />
      ))}

      <group ref={cabin} position={[0, 0, CABIN_Z]}>
        <Cabin
          mats={mats}
          doorRef={(i, m) => {
            cabinDoors.current[i] = m;
          }}
        />
        <pointLight ref={cabinLight} position={[0, CABIN_H - 0.5, 0.2]} color="#ff9e86" intensity={7} distance={10} decay={1.6} />
      </group>
    </group>
  );
}

/** The wall at the back of the shaft on every floor, and the light over each door: two draw calls in all. */
function LandingWalls({ roof, mats }: { roof: number; mats: LiftMaterials }) {
  const items = useMemo(() => {
    const inner = FLOOR_H - SLAB_T;
    const side = (SHAFT_W - DOOR_W) / 2;
    const z = LANDING_Z;
    const walls: Item[] = [];
    const glow: Item[] = [];
    for (let l = 0; l < roof; l++) {
      const y0 = l * FLOOR_H;
      for (const sx of [-1, 1]) walls.push({ p: [sx * (DOOR_W / 2 + side / 2), y0 + inner / 2, z], s: [side, inner, 0.1] });
      walls.push({ p: [0, y0 + (DOOR_H + inner) / 2, z], s: [DOOR_W, inner - DOOR_H, 0.1] });
      glow.push({ p: [0, y0 + DOOR_H + 0.03, z + 0.07], s: [DOOR_W + 0.08, 0.035, 0.03] });
    }
    return { walls, glow };
  }, [roof]);
  return (
    <>
      <Instanced items={items.walls} material={mats.shaftBack} />
      <Instanced items={items.glow} material={mats.landingGlow} />
    </>
  );
}

/** The sliding doors of one landing (they move, so they stay separate meshes). */
function LandingDoors({ level, mats, doorRef }: { level: number; mats: LiftMaterials; doorRef: (i: number, m: THREE.Mesh | null) => void }) {
  return (
    <group position={[0, level * FLOOR_H, LANDING_Z]}>
      {[-1, 1].map((sx, i) => (
        <mesh
          key={`d${sx}`}
          ref={(m) => doorRef(i, m)}
          geometry={BOX}
          material={mats.landingDoor}
          position={[sx * (DOOR_W / 4), DOOR_H / 2, 0.02]}
          scale={[DOOR_W / 2 - 0.01, DOOR_H, 0.05]}
        />
      ))}
    </group>
  );
}

/** Glass cabin: neon rims top and bottom like the reference, lit ceiling, glass doors at the front. */
function Cabin({ mats, doorRef }: { mats: LiftMaterials; doorRef: (i: number, m: THREE.Mesh | null) => void }) {
  const w = CABIN_W;
  const h = CABIN_H;
  const d = CABIN_D;
  const t = 0.06;
  const rims: { p: [number, number, number]; s: [number, number, number]; r?: number }[] = [];
  for (const y of [0.1, h - 0.06]) {
    rims.push({ p: [0, y, d / 2], s: [w, t, t] });
    rims.push({ p: [0, y, -d / 2], s: [w, t, t] });
    rims.push({ p: [-w / 2, y, 0], s: [t, t, d] });
    rims.push({ p: [w / 2, y, 0], s: [t, t, d] });
  }
  return (
    <group>
      <mesh geometry={BOX} material={mats.cabinFloor} position={[0, 0.06, 0]} scale={[w, 0.12, d]} />
      <mesh geometry={BOX} material={mats.cabinMetal} position={[0, h - 0.05, 0]} scale={[w, 0.1, d]} />
      <mesh geometry={BOX} material={mats.lightPanel} position={[0, h - 0.11, 0]} scale={[w - 0.4, 0.02, d - 0.4]} />
      {/* Corner posts */}
      {[
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ].map(([sx, sz]) => (
        <mesh key={`${sx}${sz}`} geometry={BOX} material={mats.cabinMetal} position={[(sx * w) / 2, h / 2, (sz * d) / 2]} scale={[0.07, h, 0.07]} />
      ))}
      {/* Side glass */}
      {[-1, 1].map((sx) => (
        <mesh key={`g${sx}`} geometry={BOX} material={mats.cabinGlass} position={[(sx * w) / 2, h / 2, 0]} scale={[0.02, h - 0.2, d - 0.08]} renderOrder={4} />
      ))}
      {/* Handrails */}
      {[-1, 1].map((sx) => (
        <mesh key={`h${sx}`} geometry={BOX} material={mats.cabinMetal} position={[sx * (w / 2 - 0.12), 0.95, 0]} scale={[0.04, 0.04, d - 0.4]} />
      ))}
      {/* Neon rims and their glow */}
      {rims.map((r, i) => (
        <mesh key={`r${i}`} geometry={BOX} material={mats.neon} position={r.p} scale={r.s} />
      ))}
      {[0.1, h - 0.06].map((y) => (
        <group key={`hl${y}`}>
          <mesh geometry={PLANE} material={mats.haloWide} position={[0, y, d / 2 + 0.09]} scale={[w + 1.9, 1.8, 1]} renderOrder={5} />
          <mesh geometry={PLANE} material={mats.halo} position={[0, y, d / 2 + 0.05]} scale={[w + 0.7, 0.45, 1]} renderOrder={5} />
        </group>
      ))}
      <CabinDoors mats={mats} side={1} doorRef={(i, m) => doorRef(i, m)} />
      <CabinDoors mats={mats} side={-1} doorRef={(i, m) => doorRef(2 + i, m)} />
    </group>
  );
}

/** A pair of sliding glass doors (front = 1, back = -1): the cabin opens on both sides. */
function CabinDoors({ mats, side, doorRef }: { mats: LiftMaterials; side: 1 | -1; doorRef: (i: number, m: THREE.Mesh | null) => void }) {
  const w = CABIN_W;
  const h = CABIN_H;
  const z = (side * CABIN_D) / 2;
  return (
    <group position={[0, 0, z]}>
      {[-1, 1].map((sx, i) => (
        <mesh
          key={sx}
          ref={(m) => doorRef(i, m)}
          geometry={BOX}
          material={mats.doorGlass}
          position={[(sx * w) / 4, h / 2, side * 0.025]}
          scale={[w / 2 - 0.02, h - 0.2, 0.02]}
          renderOrder={4}
        />
      ))}
    </group>
  );
}

