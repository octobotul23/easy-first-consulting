/**
 * The site's camera, replayed outside the browser: the same positions as src/three/CameraRig.tsx (with the mouse
 * sway) and the same waterline as src/three/Backdrop.tsx. scripts/ground/check.mjs uses it to see where the
 * ground's lamps and palms land on screen before anything is baked.
 * If CameraRig or Backdrop change their numbers, change them here too.
 */
import * as THREE from 'three';

const FLOOR_H = 3.4;
const TOWER_W = 17;
const TOWER_D = 11;
const FRONT_Z = TOWER_D / 2;
const SHAFT_W = 3.1;
const SHAFT_D = 2.4;
const WING_W = (TOWER_W - SHAFT_W) / 2;
const WING_X = SHAFT_W / 2 + WING_W / 2;
const CABIN_W = 2.3;
const CABIN_D = 2.0;
const CABIN_Z = FRONT_Z - SHAFT_D + 0.16 + CABIN_D / 2;
const SIGN_Z = FRONT_Z + 0.15;
const FLOOR_SIGN_W = WING_W * 0.64;
const OFFICE_SIGN_W = WING_W * 0.86;
/** CameraRig: room on each side of the phone shot's pair, the pair's height, the tilt above the card. */
const VIEW_MARGIN = 0.5;
const VIEW_Y = 1.45;
const ABOVE_CARD = 0.18;
/** Backdrop.tsx: where the waterline sits in the video, how much bigger than the screen it is drawn, how far it rises. */
const HORIZON = 0.815;
const OVERSCAN = 1.25;
const RISE = 0.07;
/** index.css (.backdrop-video's mask): the video fades out from this fraction of its height down. The ground must
 * cover that row. */
const FADE = 0.96;
/** The top stop's level (the office). */
const TOP_LEVEL = 9;

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const mix = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const span = (a, b) => ({ mid: (a + b) / 2, half: (b - a) / 2 });
const FLOORS_VIEW = span(-WING_X - FLOOR_SIGN_W / 2, CABIN_W / 2);
const OFFICE_VIEW = span(-CABIN_W / 2, WING_X + OFFICE_SIGN_W / 2);

/** The site's PHONE_LAYOUT media query: '(max-width: 767px) and (orientation: portrait)'. */
export const isPhone = (W, H) => W <= 767 && H >= W;

/**
 * The camera for one state of the site: screen size, lift level, intro, doors, office, and the mouse sway
 * (sx, sy: the pointer from −1 to 1 across the window, as CameraRig eases it; 0 without a mouse).
 * The phone shot's swing to the right is taken as settled for the level (CameraRig eases it in time).
 */
export function camera({ W, H, phone = isPhone(W, H), level = 0, intro = 1, door = 0, office = 0, sx = 0, sy = 0 }) {
  const aspect = W / H;
  const back = Math.max(0, 1.5 - aspect) * 7;
  const y = level * FLOOR_H;
  const ii = easeInOut(Math.min(1, intro * 1.05));
  const dolly = smooth(door);
  const tall = phone ? 1 : smooth(clamp01((0.95 - aspect) / 0.35));
  const V = (x = 0, yy = 0, z = 0) => new THREE.Vector3(x, yy, z);
  const streetPos = V(-16.5, 1.6, FRONT_Z + 52 + back * 2);
  const streetLook = V(-16.5, 22, FRONT_Z);
  const ridePos = V(-5.4 + dolly * 1.6, y + 2.6 - dolly * 0.6, FRONT_Z + 21 + back - dolly * 6.5);
  const rideLook = V(-2.6 + dolly * 0.9, y + 1.55, CABIN_Z);
  if (tall > 0) {
    streetPos.lerp(V(-2.5, 1.2, FRONT_Z + 66), tall);
    streetLook.lerp(V(0.6, 19.5, FRONT_Z), tall);
  }
  if (phone) {
    const side = smooth(clamp01(level - (TOP_LEVEL - 1)));
    const mid = mix(FLOORS_VIEW.mid, OFFICE_VIEW.mid, side);
    const half = mix(FLOORS_VIEW.half, OFFICE_VIEW.half, side) + VIEW_MARGIN;
    const rideFov = 40 + tall * 2;
    const dist = Math.min(44, Math.max(18, half / (Math.tan(THREE.MathUtils.degToRad(rideFov / 2)) * aspect)));
    const camZ = SIGN_Z + dist;
    ridePos.set(mid, y + 2.4 - dolly * 0.3, camZ);
    rideLook.set(mid, y + VIEW_Y - dolly * ABOVE_CARD * (camZ - CABIN_Z), CABIN_Z);
  }
  const pos = V().lerpVectors(streetPos, ridePos, ii);
  const look = V().lerpVectors(streetLook, rideLook, ii);
  pos.y += Math.sin(ii * Math.PI) * 4;
  const t = easeInOut(office);
  if (t > 0) {
    const oy = level * FLOOR_H;
    const bz = (p0, p1, p2, s) => {
      const u = 1 - s;
      return V().addScaledVector(p0, u * u).addScaledVector(p1, 2 * u * s).addScaledVector(p2, s * s);
    };
    pos.copy(bz(pos.clone(), V(0, oy + 1.66, CABIN_Z + 2.4), V(-0.6, oy + 1.7, -0.4), t));
    look.copy(bz(look.clone(), V(0, oy + 1.6, -TOWER_D), V(-3.4, oy + 1.25, -TOWER_D / 2 - 8), t));
  }
  const sway = 1 - t * 0.7;
  pos.x += sx * 0.45 * sway;
  pos.y -= sy * 0.25 * sway;
  const cam = new THREE.PerspectiveCamera(47 - 7 * ii + tall * (3 - ii), aspect, 0.1, 1400);
  cam.position.copy(pos);
  cam.lookAt(look);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

/** Screen rows of the 3D horizon, of the video's waterline (the shore) and of the row where the video starts to fade. */
export function waterline(cam, W, H) {
  const p = new THREE.Vector3(cam.position.x, cam.position.y, cam.position.z - 1e5).project(cam);
  const horizon = ((1 - p.y) / 2) * H;
  const h = Math.max(H * OVERSCAN, ((W * 1.1) / 16) * 9);
  const rise = smooth(clamp01(cam.position.y / (TOP_LEVEL * FLOOR_H))) * RISE * H;
  const top = horizon - HORIZON * h + rise;
  return { horizon, shore: top + HORIZON * h, fade: top + FADE * h };
}

/** A point on screen, in pixels from the top left; `front` is false behind the camera or beyond its far plane. */
export function onScreen(cam, W, H, x, y, z) {
  const s = new THREE.Vector3(x, y, z).project(cam);
  return { x: ((s.x + 1) / 2) * W, y: ((1 - s.y) / 2) * H, front: s.z > -1 && s.z < 1 };
}

/** Pixels per metre at a distance from the camera. */
export const pxPerM = (cam, H, dist) => H / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) / dist;

/**
 * The screens the site is checked on: four laptops and monitors, an ultra-wide, two squarish ones, five phones,
 * and the browser windows people actually have on desktops: a maximised browser on a common screen (minus the
 * taskbar or menu bar and the browser's own bars) and a short window (under 640 px, where the lift panel turns
 * into two columns). Last, two phones held sideways: they get the computer layout, with the smaller title of
 * screens 500 px tall or less.
 */
export const SCREENS = [
  [1280, 800], [1440, 900], [1536, 864], [1920, 1080], [2560, 1080], [1280, 1024], [768, 1024],
  [360, 780], [375, 812], [390, 700], [390, 844], [430, 932],
  [1280, 689], [1366, 657], [1440, 789], [1536, 730], [1600, 789], [1920, 953], [2560, 1271], [1366, 600],
  [844, 390], [932, 430],
].map(([W, H]) => ({ name: `${W}x${H}`, W, H, phone: isPhone(W, H) }));
export const DESKTOPS = SCREENS.filter((s) => ['1280x800', '1440x900', '1536x864', '1920x1080'].includes(s.name));
/** Every screen that shows the desktop layout (the lift panel down the right edge). */
export const WIDE = SCREENS.filter((s) => !s.phone);
export const PHONES = SCREENS.filter((s) => s.phone);

/**
 * The states the camera passes through: the street, the fly-in, the ride (every quarter floor, doors shut),
 * each floor with its doors open, and the walk into the office from the top stop.
 * The fly-in is the trip from G to floor 1: src/state/elevator.ts drives intro and level from the same scroll
 * position (intro = pos, level = easeInOut(pos) × the first stop's level, which is 1 with the default floors), and
 * scrolling can stop anywhere on it. Above floor 1 the fly-in is over (intro 1).
 */
export const STATES = [
  { name: 'street', level: 0, intro: 0 },
  ...Array.from({ length: 19 }, (_, i) => {
    const p = (i + 1) / 20;
    return { name: `fly ${p}`, level: easeInOut(p), intro: p };
  }),
  ...Array.from({ length: 33 }, (_, i) => ({ name: `ride L${1 + i / 4}`, level: 1 + i / 4 })),
  ...Array.from({ length: 9 }, (_, i) => ({ name: `open L${i + 1}`, level: i + 1, door: 1 })),
  ...[0.25, 0.5, 0.75, 1].map((office) => ({ name: `office ${office}`, level: TOP_LEVEL, door: 1, office })),
];

/** The mouse in the middle, at the four edges and in the four corners of the window. */
export const SWAYS = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

/**
 * Screen boxes [x0, y0, x1, y1] that nothing tall may enter, in the pixels of the 3D canvas, for a window W × H
 * with a scroll bar `sb` px wide (0 for overlay scroll bars). The canvas (.scene, position fixed) stops at the
 * scroll bar, so it is W − sb wide: project the camera onto that width too.
 * - The first screen's text (index.css: .lobby, .hero-title and the max-height 500px rules), worked out from its CSS and checked live on
 *   1440 × 900 (x 86–854, bottom 747), 1280 × 800 (x 77–759), 1920 × 953 (bottom 791), 1366 × 600 (bottom 496)
 *   and the phones held sideways, 844 × 390 (x 51–549, bottom 306) and 932 × 430 (x 56–554, bottom 346).
 * - The lift panel (index.css: .lift-panel), measured live: 89.5 × 508.8 px (110 × 254 in two columns on windows
 *   640 px tall or less), centred down the right edge, clamp(14px, 2.2vw, 34px) from the scroll bar. vw counts the
 *   scroll bar, so the gap follows W, not W − sb. (index.css keeps the panel's title from widening it.)
 */
export function zones(W, H, sb = 0) {
  const right = Math.min(34, Math.max(14, 0.022 * W));
  const Wc = W - sb;
  const [pw, ph] = H <= 640 ? [110, 254] : [89.5, 508.8];
  const clamp = (lo, v, hi) => Math.min(hi, Math.max(lo, v));
  // The text stands on the bottom padding and starts at the left padding (.lobby). Its widest line is the
  // title's second one, 8.35 em of the title's size (8.29-8.33 em measured), or on small titles the line above it
  // (about 500 px with its rule) or the paragraph under it (.hero-sub, at most 540 px); never wider than
  // .lobby-inner (780 px). Screens 500 px tall or less (phones held sideways) take a smaller title, a 470 px
  // paragraph and an 84 px bottom padding. The top moves with the wrapping of the title, and does not matter:
  // anything tall must stay under the text, so the box runs up to the top of the screen.
  const tx = clamp(20, 0.06 * W, 112);
  const short = H <= 500;
  const title = short ? clamp(32, 0.094 * H, 60) : clamp(46, 0.064 * W, 106);
  const wide = Math.min(780, Math.max(8.35 * title, 500, short ? 470 : 540));
  return {
    text: [tx, 0, tx + wide, H - (short ? 84 : clamp(104, 0.17 * H, 180))],
    panel: [Wc - right - pw, H / 2 - ph / 2, Wc - right, H / 2 + ph / 2],
  };
}
/** Scroll-bar widths to check: Windows' classic bar, and overlay bars (macOS, iPad) that take no room. */
export const SCROLLBARS = [15, 0];

/** The tower's box (from just under the ground to the roof), which hides what stands behind it. */
export const TOWER = { x0: -TOWER_W / 2, x1: TOWER_W / 2, z0: -TOWER_D / 2, z1: FRONT_Z, y0: -1, h: 58 };
export { THREE };
