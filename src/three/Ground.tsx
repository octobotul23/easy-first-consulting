import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { media } from '../lib/demo';
import { lift } from '../state/elevator';
import { FLOOR_H } from './constants';
import { hdr } from './glass';
import bakedJson from './ground/baked.json';

/**
 * The ground around the tower: the podium and forecourt, the boulevard, the side streets and blocks, the
 * park behind the tower and the promenade along the canal, out to the quay 215 m behind the tower, where
 * the water of the video begins. Built and lit in Blender (scripts/ground/build.py): lamp light and sky
 * light are baked apart, into light maps for the ground and into two vertex colours of the palms, kerbs
 * and lamps, so the brightness setting scales the lamps without dimming the dusk, and the browser draws
 * all of it without a single real-time light.
 *
 * Seen from the street the quay is only a few pixels below the horizon, so almost no water shows; as the
 * lift climbs, the quay drops further below the horizon and more of the video's water opens up above it.
 */

type Rect = [number, number, number, number];
type Vec3 = [number, number, number];
interface Glow {
  p: Vec3;
  c: string;
  /** World size, metres. */
  s: number;
  /** 0: near the tower, always at full strength; 1: the park, the axis and the quay, which come up as the lift rises. */
  g: 0 | 1;
  /** Metres nearer the camera at which the glow is depth-tested, when it sits inside its lamp's own glass. */
  d?: number;
}
/** baked.json, version 2 (written by build.py). */
interface Baked {
  version: number;
  /** Lamp maps: linear light = sRGB-decoded texel × K. */
  K: number;
  /** Sky maps: linear light = sRGB-decoded texel × Ks. */
  Ks: number;
  /** Linear sky light outside both map rects. */
  skyConst: Vec3;
  regions: { near: { rect: Rect }; far: { rect: Rect } };
  /** Metres inside the near rect over which the far maps hand over to the near ones. */
  blend: number;
  /** The props' sky-only colour and face-direction attributes, as GLTFLoader names them. */
  skyAttr?: string | null;
  faceAttr?: string | null;
  paint: { top: Rect; bottom: Rect; white: string; yellow: string };
  /** The podium's granite grid: origin [x, z] and slab size [x, z]. */
  slab: { origin: [number, number]; size: [number, number] };
  glows: Glow[];
  decal?: { p: Vec3; d: number; color: string };
  levels: { podium: number; walk: number; road: number };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isList = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every(isNum);

/** baked.json when it is the v2 bake this file draws; null for an older one (the ground then stays a plain dark plane). */
function readBaked(json: unknown): Baked | null {
  const b = json as Partial<Baked> | null;
  const ok =
    !!b &&
    isNum(b.version) &&
    isNum(b.K) &&
    isNum(b.Ks) &&
    isList(b.skyConst, 3) &&
    isList(b.regions?.near?.rect, 4) &&
    isList(b.regions?.far?.rect, 4) &&
    isNum(b.blend) &&
    isList(b.paint?.top, 4) &&
    isList(b.paint?.bottom, 4) &&
    typeof b.paint?.white === 'string' &&
    typeof b.paint?.yellow === 'string' &&
    isList(b.slab?.origin, 2) &&
    isList(b.slab?.size, 2) &&
    Array.isArray(b.glows);
  if (!ok && import.meta.env.DEV) {
    console.warn('ground: src/three/ground/baked.json is not the v2 bake; run scripts/ground/build.py. The ground stays a plain dark plane.');
  }
  return ok ? (b as Baked) : null;
}
const BAKED = readBaked(bakedJson);

/** The ground mesh's extent (layout.json "bounds"): the plain plane covers the same, at podium level. */
const BOUNDS = { x0: -1000, z0: -215.4, x1: 1000, z1: 110 };

/**
 * Uniforms shared by every ground material: the brightness setting, a haze of its own and the horizon's
 * glow. The scene's fog fully covers anything 240 m away, which would paint the far ground a flat plum
 * next to the clear water of the video; this haze thickens gently with distance and never covers all of it.
 */
interface Shared {
  /** Scales the lamps only (the light maps' lamp half, the props' lamp colour, the glows), never the sky. */
  gLight: { value: number };
  /** The haze colour, in output (sRGB) values: it is mixed in after the colour conversion. */
  gFogColor: { value: THREE.Vector3 };
  /** Start (m), reach (m), most it ever covers (0 – 1). */
  gFog: { value: THREE.Vector3 };
  /** The horizon's glow that stone and asphalt catch at a grazing angle (linear). */
  gHorizon: { value: THREE.Color };
}

const FOG_GLSL = /* glsl */ `
  float gHaze( vec3 p ) {
    float d = max( distance( p, cameraPosition ) - gFog.x, 0.0 ) / gFog.y;
    return gFog.z * ( 1.0 - exp( -d * d ) );
  }
`;

type Shader = Parameters<THREE.Material['onBeforeCompile']>[0];

/** Replaces a chunk of three's shader; in development, says so when three no longer has that chunk. */
function swap(code: string, anchor: string, text: string, key: string) {
  if (import.meta.env.DEV && !code.includes(anchor)) {
    console.warn(`ground: the ${key} shader has no "${anchor}" (three.js changed its shaders), so it is drawn wrong`);
  }
  return code.replace(anchor, text);
}

/**
 * Adds the shared haze (and, if `lit`, the brightness setting) to a basic material. `extra` patches
 * more; what it adds after `#include <common>` lands before the haze, so it must not use it.
 */
function patch(m: THREE.MeshBasicMaterial, shared: Shared, key: string, lit = true, extra?: (s: Shader) => void) {
  m.fog = false;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, shared);
    s.vertexShader = swap(s.vertexShader, '#include <common>', '#include <common>\nvarying vec3 vGWorld;', key);
    s.vertexShader = swap(
      s.vertexShader,
      '#include <project_vertex>',
      '#include <project_vertex>\nvGWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;',
      key,
    );
    s.fragmentShader = swap(
      s.fragmentShader,
      '#include <common>',
      `#include <common>\nvarying vec3 vGWorld;\nuniform float gLight;\nuniform vec3 gFogColor;\nuniform vec3 gFog;\n${FOG_GLSL}`,
      key,
    );
    if (lit) s.fragmentShader = swap(s.fragmentShader, '#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= gLight;', key);
    s.fragmentShader = swap(s.fragmentShader, '#include <fog_fragment>', 'gl_FragColor.rgb = mix( gl_FragColor.rgb, gFogColor, gHaze( vGWorld ) );', key);
    extra?.(s);
  };
  m.customProgramCacheKey = () => `iris-ground-${key}`;
  return m;
}

/* ---------------------------------------------------------------- surface detail, drawn once */

const SIZE = 512;
/** Metres covered by one repeat of the pavers / asphalt / planting tile. */
const TILE_M = 3.2;
/** Granite slabs across (x) and along (z) one repeat of the stone tile. */
const STONE_SLABS = [4, 8] as const;

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth noise that repeats seamlessly across the tile (0 – 1). */
function noise(size: number, cells: number, rnd: () => number) {
  const g = Float32Array.from({ length: cells * cells }, rnd);
  const out = new Float32Array(size * size);
  const s = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells;
    const y0 = Math.floor(fy);
    const ty = s(fy - y0);
    const r0 = y0 * cells;
    const r1 = ((y0 + 1) % cells) * cells;
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const x0 = Math.floor(fx);
      const tx = s(fx - x0);
      const x1 = (x0 + 1) % cells;
      const a = g[r0 + x0] + (g[r0 + x1] - g[r0 + x0]) * tx;
      const b = g[r1 + x0] + (g[r1 + x1] - g[r1 + x0]) * tx;
      out[y * size + x] = a + (b - a) * ty;
    }
  }
  return out;
}

/**
 * Writes a brightness channel into byte channel `c` of `n`: scaled to a mean of exactly 1 (so the detail
 * never changes the baked tone), stored as value / 2, dithered so the mean survives the rounding.
 */
function store(out: Uint8Array, values: Float32Array, c: number, n: number, rnd: () => number) {
  let sum = 0;
  for (const v of values) sum += v;
  const k = (values.length / sum) * 127.5;
  for (let i = 0; i < values.length; i++) out[i * n + c] = Math.min(255, Math.floor(values[i] * k + rnd()));
}

function tileTexture(data: Uint8Array, format: THREE.PixelFormat, aniso: number) {
  const t = new THREE.DataTexture(data, SIZE, SIZE, format);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

/**
 * The brightness detail of each surface class, no colour (the albedo maps hold the colour):
 * `pack` holds pavers (R), asphalt (G) and planting (B) over TILE_M metres; `stone` the granite slabs,
 * laid on the podium's grid.
 */
function detailTiles(aniso: number) {
  const rnd = random(7);
  const n = SIZE * SIZE;
  const fine = Float32Array.from({ length: n }, rnd);
  const brick = Float32Array.from({ length: 4096 }, rnd);
  const blot = noise(SIZE, 4, rnd);
  const leaf = noise(SIZE, 24, rnd);
  const tuft = noise(SIZE, 48, rnd);
  const grain = noise(SIZE, 8, rnd);
  const pavers = new Float32Array(n);
  const asphalt = new Float32Array(n);
  const planting = new Float32Array(n);
  const stone = new Float32Array(n);
  const bw = (SIZE / TILE_M) * 0.4;
  const bh = bw / 2;
  const sw = SIZE / STONE_SLABS[0];
  const sh = SIZE / STONE_SLABS[1];
  for (let y = 0, i = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++, i++) {
      const f = fine[i];
      // Concrete pavers, 40 × 20 cm in running bond, with sanded joints.
      const row = Math.floor(y / bh);
      const xs = (x + (row % 2) * (bw / 2)) % SIZE;
      const joint = y % bh < 2 || xs % bw < 2;
      const id = row * 97 + Math.floor(xs / bw);
      pavers[i] = joint ? 0.55 : (0.9 + brick[id] * 0.2) * (0.95 + f * 0.1) * (0.94 + blot[i] * 0.12);
      // Asphalt: grit with a few bright stones and dark pits, and worn patches.
      asphalt[i] = (f > 0.985 ? 1.5 : f < 0.02 ? 0.6 : 0.88 + f * 0.24) * (0.93 + blot[i] * 0.14);
      // Low planting and lawn: clumps of leaves with dark soil between them.
      const v = leaf[i] * 0.65 + tuft[i] * 0.35;
      planting[i] = v < 0.36 ? 0.55 + f * 0.15 : 0.8 + v * 0.45 + f * 0.12;
      // Flamed granite in stack bond (1.889 × 0.944 m slabs, joints on the facade's mullions): crystal
      // speckle, a soft grain, fine pale joints.
      const slabJoint = x % sw === 0 || x % sw === sw - 1 || y % sh === 0 || y % sh === sh - 1;
      const speck = f > 0.97 ? 1.25 : f < 0.05 ? 0.7 : 0.94 + f * 0.12;
      stone[i] = slabJoint ? 0.82 : speck * (0.95 + grain[i] * 0.1);
    }
  }
  const pack = new Uint8Array(n * 4).fill(255);
  store(pack, pavers, 0, 4, rnd);
  store(pack, asphalt, 1, 4, rnd);
  store(pack, planting, 2, 4, rnd);
  const slabs = new Uint8Array(n);
  store(slabs, stone, 0, 1, rnd);
  return { pack: tileTexture(pack, THREE.RGBAFormat, aniso), stone: tileTexture(slabs, THREE.RedFormat, aniso) };
}
type Tiles = ReturnType<typeof detailTiles>;

/* ---------------------------------------------------------------- the ground */

/** The detail tiles' size in GLSL. */
const TILE_GLSL = /* glsl */ `
  #define G_TILE ${TILE_M.toFixed(2)}
  #define G_SLABS vec2( ${STONE_SLABS[0].toFixed(1)}, ${STONE_SLABS[1].toFixed(1)} )
`;

const GROUND_PARS = /* glsl */ `
  ${TILE_GLSL}
  uniform sampler2D gNearLamp, gFarLamp, gNearSky, gFarSky, gNearZones, gFarZones, gNearAlbedo, gFarAlbedo, gTiles, gStone;
  uniform vec4 gNearRect, gFarRect, gSlab;
  uniform vec3 gSkyConst;
  uniform vec2 gK;
  uniform float gBlend;
  #ifndef GROUND_LITE
    uniform sampler2D gPaint;
    uniform vec4 gPaintTop, gPaintBottom;
    uniform vec3 gPaintWhite, gPaintYellow, gHorizon;
  #endif
  // How far p lies inside rect r (x0, z0, x1, z1), in metres; negative outside.
  float gInside( vec2 p, vec4 r ) {
    vec2 d = min( p - r.xy, r.zw - p );
    return min( d.x, d.y );
  }
  // A hash without sin(), which loses precision on some mobile GPUs: 0 – 1.
  float gHash( vec2 p ) {
    vec3 p3 = fract( p.xyx * 0.1031 );
    p3 += dot( p3, p3.yzx + 33.33 );
    return fract( ( p3.x + p3.y ) * p3.z );
  }
  // Smooth value noise, 0 – 1.
  float gNoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    f = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( gHash( i ), gHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( gHash( i + vec2( 0.0, 1.0 ) ), gHash( i + 1.0 ), f.x ), f.y );
  }
  // Reads the map laid over rect r at world point p. These reads sit in branches, where the GPU's own
  // derivatives (which pick the mip level) are undefined, so they get the world point's derivatives.
  vec4 gRead( sampler2D t, vec4 r, vec2 p, vec2 dx, vec2 dy ) {
    vec2 s = 1.0 / ( r.zw - r.xy );
    return textureGrad( t, ( p - r.xy ) * s, dx * s, dy * s );
  }
`;

const GROUND_COLOR = /* glsl */ `
  {
    vec2 gp = vGWorld.xz;
    vec2 gdx = dFdx( gp );
    vec2 gdy = dFdy( gp );
    // The sharp near maps take over inside their rect, over its last gBlend metres.
    float kN = smoothstep( 0.0, gBlend, gInside( gp, gNearRect ) );
    vec3 lamp = vec3( 0.0 );
    vec3 sky = gSkyConst;
    vec3 alb = vec3( 0.0 );
    vec3 zon = vec3( 0.0 );
    if ( kN < 1.0 ) {
      // Beyond the far rect only the sky's constant light is left; the far maps' light fades into it over
      // their last 3 m. The albedo and zones keep their edge pixels, so streets and park run on sideways.
      float f = smoothstep( 0.0, 3.0, gInside( gp, gFarRect ) );
      lamp = gRead( gFarLamp, gFarRect, gp, gdx, gdy ).rgb * f;
      sky = mix( gSkyConst, gRead( gFarSky, gFarRect, gp, gdx, gdy ).rgb * gK.y, f );
      alb = gRead( gFarAlbedo, gFarRect, gp, gdx, gdy ).rgb;
      zon = gRead( gFarZones, gFarRect, gp, gdx, gdy ).rgb;
    }
    if ( kN > 0.0 ) {
      lamp = mix( lamp, gRead( gNearLamp, gNearRect, gp, gdx, gdy ).rgb, kN );
      sky = mix( sky, gRead( gNearSky, gNearRect, gp, gdx, gdy ).rgb * gK.y, kN );
      alb = mix( alb, gRead( gNearAlbedo, gNearRect, gp, gdx, gdy ).rgb, kN );
      zon = mix( zon, gRead( gNearZones, gNearRect, gp, gdx, gdy ).rgb, kN );
    }
    #ifndef GROUND_LITE
      // Road paint: the mask's top half covers the boulevard, its bottom half the back street.
      bool upper = gp.y >= gPaintTop.y;
      vec4 pr = upper ? gPaintTop : gPaintBottom;
      if ( gInside( gp, pr ) > 0.0 ) {
        vec2 ps = vec2( 1.0, 0.5 ) / ( pr.zw - pr.xy );
        vec2 pm = textureGrad( gPaint, ( gp - pr.xy ) * ps + vec2( 0.0, upper ? 0.5 : 0.0 ), gdx * ps, gdy * ps ).rg;
        alb = mix( mix( alb, gPaintWhite, pm.r ), gPaintYellow, pm.g );
      }
    #endif
    // How much of each class: pavers, stone, asphalt, planting.
    vec4 w = vec4( max( 0.0, 1.0 - zon.r - zon.g - zon.b ), zon );
    // Brightness detail with a mean of 1 (stored halved). Each granite slab is a little lighter or darker.
    vec3 tile = texture2D( gTiles, gp / G_TILE ).rgb * 2.0;
    vec2 sq = ( gp - gSlab.xy ) / gSlab.zw;
    float st = texture2D( gStone, sq / G_SLABS ).r * 2.0 * ( 0.94 + 0.12 * gHash( floor( sq ) ) );
    float detail = dot( w, vec4( tile.r, st, tile.g, tile.b ) );
    // Wear and weathering in soft patches 8 – 30 m across: ±8 % brightness, ±3 % hue.
    float mv = gNoise( gp / 30.0 ) * 0.6 + gNoise( gp / 8.0 + 17.0 ) * 0.4;
    float mh = gNoise( gp / 18.0 + 53.0 ) * 2.0 - 1.0;
    vec3 vary = ( 0.92 + 0.16 * mv ) * vec3( 1.0 + 0.03 * mh, 1.0, 1.0 - 0.03 * mh );
    diffuseColor.rgb *= detail * alb * vary * ( lamp * gK.x * gLight + sky );
    #ifndef GROUND_LITE
      // Sky sheen: at a grazing angle stone and asphalt catch the horizon's glow (Schlick's Fresnel), never
      // more than 0.08.
      vec3 toEye = normalize( cameraPosition - vGWorld );
      float fres = 0.04 + 0.96 * pow( 1.0 - clamp( toEye.y, 0.0, 1.0 ), 5.0 );
      float ws = dot( w, vec4( 0.25, 0.5, 0.35, 0.0 ) );
      diffuseColor.rgb += min( ws * fres * gHorizon * ( 1.0 - gHaze( vGWorld ) ), vec3( 0.08 ) );
    #endif
  }
`;

/** The tower's light, the maps and the detail on the ground mesh. On phones (GROUND_LITE) no sheen and no paint. */
function groundMaterial(baked: Baked, maps: Maps, tiles: Tiles, shared: Shared, lite: boolean) {
  const key = lite ? 'ground-lite' : 'ground';
  const m = new THREE.MeshBasicMaterial({ polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2, dithering: true });
  if (lite) m.defines = { GROUND_LITE: '' };
  return patch(m, shared, key, false, (s) => {
    const { near, far } = baked.regions;
    Object.assign(s.uniforms, {
      gNearLamp: { value: maps.nearLamp },
      gFarLamp: { value: maps.farLamp },
      gNearSky: { value: maps.nearSky },
      gFarSky: { value: maps.farSky },
      gNearZones: { value: maps.nearZones },
      gFarZones: { value: maps.farZones },
      gNearAlbedo: { value: maps.nearAlbedo },
      gFarAlbedo: { value: maps.farAlbedo },
      gPaint: { value: maps.paint },
      gTiles: { value: tiles.pack },
      gStone: { value: tiles.stone },
      gNearRect: { value: new THREE.Vector4(...near.rect) },
      gFarRect: { value: new THREE.Vector4(...far.rect) },
      gSlab: { value: new THREE.Vector4(...baked.slab.origin, ...baked.slab.size) },
      gPaintTop: { value: new THREE.Vector4(...baked.paint.top) },
      gPaintBottom: { value: new THREE.Vector4(...baked.paint.bottom) },
      gPaintWhite: { value: new THREE.Color(baked.paint.white) },
      gPaintYellow: { value: new THREE.Color(baked.paint.yellow) },
      gSkyConst: { value: new THREE.Vector3(...baked.skyConst) },
      gK: { value: new THREE.Vector2(baked.K, baked.Ks) },
      gBlend: { value: Math.max(1e-3, baked.blend) },
    });
    s.fragmentShader = swap(s.fragmentShader, '#include <common>', `#include <common>\n${GROUND_PARS}`, key);
    s.fragmentShader = swap(s.fragmentShader, '#include <map_fragment>', GROUND_COLOR, key);
  });
}

/* ---------------------------------------------------------------- props: palms, kerbs, lamps, benches */

const PROPS_VERT_PARS = /* glsl */ `
  #ifdef GROUND_SKY
    attribute vec3 gSky;
    varying vec3 vGSky;
  #endif
  #ifdef GROUND_FACE
    attribute float gFace;
    varying float vGFace;
  #endif
`;
const PROPS_VERT = /* glsl */ `
  #ifdef GROUND_SKY
    vGSky = gSky;
  #endif
  #ifdef GROUND_FACE
    vGFace = gFace;
  #endif
`;
const PROPS_FRAG_PARS = /* glsl */ `
  ${TILE_GLSL}
  #ifdef GROUND_SKY
    varying vec3 vGSky;
  #endif
  #ifdef GROUND_FACE
    varying float vGFace;
    uniform sampler2D gStone;
    uniform vec4 gSlab;
  #endif
`;
/** After the vertex colour (the lamp light): the brightness setting, the sky light, the stone on the faces. */
const PROPS_COLOR = /* glsl */ `
  diffuseColor.rgb *= gLight;
  #ifdef GROUND_SKY
    diffuseColor.rgb += vGSky;
  #endif
  #ifdef GROUND_FACE
    {
      // Kerbs, risers and walls: the granite tile on faces towards ±z (1) runs along x, towards ±x (2) along z;
      // a joint at podium level (y 0), so no joint crosses a low wall.
      vec2 q = vGFace > 1.5 ? vec2( vGWorld.z - gSlab.y, vGWorld.y ) : vec2( vGWorld.x - gSlab.x, vGWorld.y );
      float st = texture2D( gStone, q / gSlab.zw / G_SLABS ).r * 2.0;
      diffuseColor.rgb *= mix( 1.0, st, step( 0.5, vGFace ) );
    }
  #endif
  // Fronds and thin parts are single-sided: their backs, seen from below, are in their own shade.
  if ( !gl_FrontFacing ) diffuseColor.rgb *= 0.35;
`;

function propsMaterial(baked: Baked, tiles: Tiles, shared: Shared, sky: boolean, face: boolean) {
  const key = `props${sky ? '-sky' : ''}${face ? '-face' : ''}`;
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const defines: Record<string, string> = {};
  if (sky) defines.GROUND_SKY = '';
  if (face) defines.GROUND_FACE = '';
  m.defines = defines;
  return patch(m, shared, key, false, (s) => {
    if (face) {
      Object.assign(s.uniforms, {
        gStone: { value: tiles.stone },
        gSlab: { value: new THREE.Vector4(...baked.slab.origin, ...baked.slab.size) },
      });
    }
    s.vertexShader = swap(s.vertexShader, '#include <common>', `#include <common>\n${PROPS_VERT_PARS}`, key);
    s.vertexShader = swap(s.vertexShader, '#include <color_vertex>', `#include <color_vertex>\n${PROPS_VERT}`, key);
    s.fragmentShader = swap(s.fragmentShader, '#include <common>', `#include <common>\n${PROPS_FRAG_PARS}`, key);
    s.fragmentShader = swap(s.fragmentShader, '#include <color_fragment>', `#include <color_fragment>\n${PROPS_COLOR}`, key);
  });
}

/* ---------------------------------------------------------------- loading */

/** The baked maps: file, and whether it holds colours (sRGB) or plain numbers. */
const MAP_FILES = {
  nearLamp: ['ground-near.webp', true],
  farLamp: ['ground-far.webp', true],
  nearSky: ['ground-near-sky.webp', true],
  farSky: ['ground-far-sky.webp', true],
  nearZones: ['ground-near-zones.png', false],
  farZones: ['ground-far-zones.png', false],
  nearAlbedo: ['ground-near-albedo.png', true],
  farAlbedo: ['ground-far-albedo.png', true],
  paint: ['ground-paint.png', false],
} as const;
type MapName = keyof typeof MAP_FILES;
type Maps = Record<MapName, THREE.Texture>;
const MAP_NAMES = Object.keys(MAP_FILES) as MapName[];

type Kind = 'ground' | 'props' | 'emissive';
const KINDS: Kind[] = ['ground', 'props', 'emissive'];
/** One mesh of ground.glb, with its place (the GLB's positions are quantised, so they stay in their own space). */
interface Part {
  kind: Kind;
  name: string;
  geometry: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
}

interface Loaded {
  maps: Maps;
  parts: Part[];
}

function loadTexture(url: string) {
  return new Promise<THREE.Texture>((resolve, reject) => new THREE.TextureLoader().load(url, resolve, undefined, reject));
}

function loadModel(url: string) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return new Promise<THREE.Object3D>((resolve, reject) => loader.load(url, (g) => resolve(g.scene), undefined, reject));
}

function file(baked: Baked, name: string) {
  return `${media(`/models/${name}`)}?v=${baked.version}`;
}

/** What a mesh is, from its own name or a parent's (Blender object names: ground*, props*, emissive*). */
function kindOf(o: THREE.Object3D | null): Kind | null {
  for (; o; o = o.parent) {
    const name = o.name.toLowerCase();
    const kind = KINDS.find((k) => name.startsWith(k));
    if (kind) return kind;
  }
  return null;
}

/** Gives a loaded attribute the name the shader reads. */
function rename(g: THREE.BufferGeometry, from: string | null | undefined, to: string) {
  const a = from ? g.getAttribute(from) : undefined;
  if (!from || !a) return false;
  g.setAttribute(to, a);
  g.deleteAttribute(from);
  return true;
}

/** The meshes of ground.glb, sorted by kind; the loader's default materials are dropped. */
function sortMeshes(scene: THREE.Object3D, baked: Baked) {
  scene.updateMatrixWorld(true);
  const parts: Part[] = [];
  const unused = new Set<THREE.Material>();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of ([] as THREE.Material[]).concat(mesh.material)) unused.add(m);
    const kind = kindOf(mesh);
    if (!kind) {
      if (import.meta.env.DEV) console.warn(`ground: ground.glb has a mesh "${mesh.name}" that is not ground*, props* or emissive*; it is left out`);
      mesh.geometry.dispose();
      return;
    }
    if (kind === 'props') {
      if (!rename(mesh.geometry, baked.skyAttr, 'gSky') && import.meta.env.DEV) {
        console.warn(`ground: "${mesh.name}" has no sky colour "${baked.skyAttr}"; it shows lamp light only`);
      }
      rename(mesh.geometry, baked.faceAttr, 'gFace');
    }
    parts.push({ kind, name: mesh.name, geometry: mesh.geometry, matrix: mesh.matrixWorld.clone() });
  });
  unused.forEach((m) => m.dispose());
  return parts;
}

/** Redraws a map at half its size: phones keep a quarter of the memory. */
function halve(t: THREE.Texture) {
  const img = t.image as HTMLImageElement;
  const c = document.createElement('canvas');
  c.width = Math.max(1, img.width >> 1);
  c.height = Math.max(1, img.height >> 1);
  c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
  t.image = c;
  t.needsUpdate = true;
}

/** The hex colour as the output (sRGB) values three gives its own fog, so the haze matches the tower's fog. */
function outputColor(hex: string) {
  const c = new THREE.Color(hex);
  const o = { r: 0, g: 0, b: 0 };
  c.getRGB(o, THREE.SRGBColorSpace);
  return new THREE.Vector3(o.r, o.g, o.b);
}

/* ---------------------------------------------------------------- lamp glows and the decal */

/** Adds light only, never alpha (see additive() in glass.ts), so the video behind the canvas still shows. */
const ADD_LIGHT = {
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.SrcAlphaFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
} as const;

const GLOW_VERT = /* glsl */ `
  attribute vec3 gColor;
  attribute vec3 gInfo;
  uniform float gPx;
  uniform float gLight;
  uniform vec3 gFog;
  varying vec3 vC;
  ${FOG_GLSL}
  void main() {
    vec4 world = modelMatrix * vec4( position, 1.0 );
    vec4 mv = viewMatrix * world;
    // Drawn as if gInfo.z metres nearer, along the line of sight: the same spot on screen, but in front of the
    // lamp's own glass, which would otherwise hide it.
    float dist = max( length( mv.xyz ), 0.001 );
    gl_Position = projectionMatrix * vec4( mv.xyz * max( 0.05, 1.0 - gInfo.z / dist ), 1.0 );
    float px = gInfo.x * gPx / max( -mv.z, 0.1 );
    gl_PointSize = min( px, 512.0 );
    float d = distance( world.xyz, cameraPosition );
    // The far group (park, axis, quay) comes up to full strength as the lift rises above the trees.
    float gain = gInfo.y > 0.5 ? mix( 0.35, 1.0, smoothstep( 3.0, 20.0, cameraPosition.y ) ) : 1.0;
    // A glow smaller than about two pixels only flickers: it fades away instead.
    vC = gColor * 0.6 * gLight * gain * clamp( 80.0 / d, 0.3, 1.0 ) * ( 1.0 - gHaze( world.xyz ) ) * smoothstep( 1.0, 2.0, px );
  }
`;
const GLOW_FRAG = /* glsl */ `
  varying vec3 vC;
  void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float d = dot( q, q );
    if ( d >= 1.0 ) discard;
    float a = ( exp( -d * 7.0 ) * 0.55 + exp( -d * 60.0 ) ) * ( 1.0 - d );
    gl_FragColor = vec4( vC, a );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Every lamp's glow in one draw: world size (gInfo.x), group (gInfo.y) and depth push (gInfo.z) per point. */
function Glows({ glows, shared }: { glows: Glow[]; shared: Shared }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(glows.length * 3);
    const col = new Float32Array(glows.length * 3);
    const info = new Float32Array(glows.length * 3);
    glows.forEach((l, i) => {
      pos.set(l.p, i * 3);
      const c = hdr(l.c, 1.6);
      col.set([c.r, c.g, c.b], i * 3);
      info.set([l.s, l.g ? 1 : 0, l.d ?? 0], i * 3);
    });
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('gColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('gInfo', new THREE.BufferAttribute(info, 3));
    return g;
  }, [glows]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: GLOW_VERT,
        fragmentShader: GLOW_FRAG,
        uniforms: { gPx: { value: 1 }, gLight: shared.gLight, gFog: shared.gFog },
        ...ADD_LIGHT,
      }),
    [shared],
  );
  // Pixels covered by one metre at one metre's distance, so the glows keep their real size; the lens
  // narrows as the lift ride starts, so it is measured on every frame drawn.
  useFrame(({ gl, camera }) => {
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 47;
    material.uniforms.gPx.value = gl.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)));
  });
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  if (!glows.length) return null;
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={2} />;
}

const DECAL_VERT = /* glsl */ `
  varying vec2 vQ;
  void main() {
    vQ = uv * 2.0 - 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;
const DECAL_FRAG = /* glsl */ `
  uniform vec3 gTint;
  uniform float gOpacity;
  varying vec2 vQ;
  void main() {
    float a = ( 1.0 - smoothstep( 0.35, 1.0, length( vQ ) ) ) * gOpacity;
    gl_FragColor = vec4( gTint, a );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** A soft magenta glow on the podium in front of the lift, from the cabin's light; it fades as the cabin climbs. */
function Decal({ decal }: { decal: NonNullable<Baked['decal']> }) {
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(decal.d, decal.d);
    g.rotateX(-Math.PI / 2);
    g.translate(...decal.p);
    return g;
  }, [decal]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: DECAL_VERT,
        fragmentShader: DECAL_FRAG,
        uniforms: { gTint: { value: new THREE.Color(decal.color) }, gOpacity: { value: 0 } },
        ...ADD_LIGHT,
      }),
    [decal],
  );
  // Read on every frame drawn: the cabin only moves while frames are being drawn.
  useFrame(() => {
    material.uniforms.gOpacity.value = 0.12 * (1 - THREE.MathUtils.smoothstep(lift.level * FLOOR_H, 0, 10.2));
  });
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return <mesh geometry={geometry} material={material} renderOrder={1} />;
}

/* ---------------------------------------------------------------- the whole ground */

interface Props {
  /** The brightness setting of the lamps (1 = as baked). */
  light?: number;
  /** The scene's fog colour: without the video, the haze over the far ground takes it on. */
  fog: string;
  /** The Dubai video is behind the scene: the haze takes the colour of its water instead. */
  video?: boolean;
  /** The video's dim setting (0 – 70 %): the haze and the horizon's glow darken with it. */
  dim?: number;
  /** The phone layout: the lighter shader (no sheen, no paint) and, when the maps load, half-size lamp maps. */
  phone?: boolean;
  /** Called once when the ground has loaded, or could not load (it then stays a plain dark plane). */
  onSettled?: () => void;
}

export function Ground({ light = 1, fog, video = false, dim = 0, phone = false, onSettled }: Props) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(!BAKED);
  // The map size is chosen once, when the maps load; turning the phone later only changes the shader.
  const halfMaps = useRef(phone);
  const settled = useRef(false);

  const shared = useMemo<Shared>(
    () => ({
      gLight: { value: 1 },
      gFogColor: { value: new THREE.Vector3() },
      gFog: { value: new THREE.Vector3(40, 330, 0.85) },
      gHorizon: { value: new THREE.Color() },
    }),
    [],
  );
  useEffect(() => {
    // The video's dim overlay is rgb(18 9 15) over the picture, so the colours taken from the video darken
    // the same way, mixed in sRGB as the browser mixes that overlay.
    const t = video ? THREE.MathUtils.clamp(dim, 0, 70) / 100 : 0;
    const dark = outputColor('#12090f');
    shared.gLight.value = THREE.MathUtils.clamp(light, 0.3, 3);
    shared.gFogColor.value.copy(video ? outputColor('#6a4a40').lerp(dark, t) : outputColor(fog));
    const h = outputColor('#7a5444').lerp(dark, t);
    shared.gHorizon.value.setRGB(h.x, h.y, h.z, THREE.SRGBColorSpace);
    invalidate();
  }, [shared, light, fog, video, dim, invalidate]);

  useEffect(() => {
    const baked = BAKED;
    if (!baked) return;
    let alive = true;
    const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy());
    Promise.allSettled([loadModel(file(baked, 'ground.glb')), ...MAP_NAMES.map((n) => loadTexture(file(baked, MAP_FILES[n][0])))]).then(
      ([model, ...results]) => {
        const textures = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
        const parts = model.status === 'fulfilled' ? sortMeshes(model.value, baked) : [];
        const complete = textures.length === MAP_NAMES.length && parts.some((p) => p.kind === 'ground');
        if (!alive || !complete) {
          textures.forEach((t) => t.dispose());
          parts.forEach((p) => p.geometry.dispose());
          if (!alive) return;
          if (import.meta.env.DEV) {
            const errors = [model, ...results].flatMap((r) => (r.status === 'rejected' ? [r.reason] : []));
            console.warn('ground: could not load', errors.length ? errors : 'ground.glb has no ground* mesh');
          }
          setFailed(true);
          return;
        }
        const maps = Object.fromEntries(MAP_NAMES.map((n, i) => [n, textures[i]])) as Maps;
        for (const n of MAP_NAMES) {
          maps[n].colorSpace = MAP_FILES[n][1] ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          maps[n].anisotropy = aniso;
        }
        if (halfMaps.current) {
          halve(maps.nearLamp);
          halve(maps.farLamp);
        }
        setLoaded({ maps, parts });
      },
    );
    return () => {
      alive = false;
    };
  }, [gl]);

  useEffect(() => {
    if (settled.current || !(loaded || failed)) return;
    settled.current = true;
    invalidate();
    onSettled?.();
  }, [loaded, failed, invalidate, onSettled]);

  // Until the baked ground arrives (or if it cannot), a plain dark plane: the tower never floats. Unlit: the
  // panel's ground light brightens the baked lamps, and a flat plane has none.
  const plain = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(BOUNDS.x1 - BOUNDS.x0, BOUNDS.z1 - BOUNDS.z0, 16, 6);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate((BOUNDS.x0 + BOUNDS.x1) / 2, 0, (BOUNDS.z0 + BOUNDS.z1) / 2);
    return { geometry, material: patch(new THREE.MeshBasicMaterial({ color: '#1a1114' }), shared, 'plain', false) };
  }, [shared]);

  const tiles = useMemo(() => (loaded ? detailTiles(Math.min(8, gl.capabilities.getMaxAnisotropy())) : null), [loaded, gl]);

  const ground = useMemo(
    () => (BAKED && loaded && tiles ? groundMaterial(BAKED, loaded.maps, tiles, shared, phone) : null),
    [loaded, tiles, shared, phone],
  );

  // One material per part that is not the ground: props by the attributes they carry, the lamp heads and LED lines.
  const others = useMemo(() => {
    if (!BAKED || !loaded || !tiles) return null;
    const baked = BAKED;
    const made = new Map<string, THREE.Material>();
    const get = (key: string, build: () => THREE.Material) => {
      if (!made.has(key)) made.set(key, build());
      return made.get(key) as THREE.Material;
    };
    const list = loaded.parts.map((p) => {
      if (p.kind === 'ground') return null;
      if (p.kind === 'emissive') {
        return get('emissive', () =>
          patch(new THREE.MeshBasicMaterial({ vertexColors: true, color: hdr('#ffffff', 2.4), side: THREE.DoubleSide }), shared, 'emissive'),
        );
      }
      const sky = !!p.geometry.getAttribute('gSky');
      const face = !!p.geometry.getAttribute('gFace');
      return get(`props-${sky}-${face}`, () => propsMaterial(baked, tiles, shared, sky, face));
    });
    return { list, all: [...made.values()] };
  }, [loaded, tiles, shared]);

  useEffect(
    () => () => {
      plain.geometry.dispose();
      plain.material.dispose();
    },
    [plain],
  );
  useEffect(
    () => () => {
      tiles?.pack.dispose();
      tiles?.stone.dispose();
    },
    [tiles],
  );
  useEffect(
    () => () => {
      if (!loaded) return;
      for (const n of MAP_NAMES) loaded.maps[n].dispose();
      for (const p of loaded.parts) p.geometry.dispose();
    },
    [loaded],
  );
  useEffect(() => () => ground?.dispose(), [ground]);
  useEffect(() => () => others?.all.forEach((m) => m.dispose()), [others]);

  const ready = BAKED && loaded && ground && others;
  return (
    <group>
      {!ready && <mesh geometry={plain.geometry} material={plain.material} />}
      {ready &&
        loaded.parts.map((p, i) => (
          <mesh key={`${p.name}-${i}`} geometry={p.geometry} material={others.list[i] ?? ground} matrix={p.matrix} matrixAutoUpdate={false} />
        ))}
      {ready && <Glows glows={BAKED.glows} shared={shared} />}
      {ready && BAKED.decal && <Decal decal={BAKED.decal} />}
    </group>
  );
}
