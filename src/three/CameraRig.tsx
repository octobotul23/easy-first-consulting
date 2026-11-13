import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { PHONE_LAYOUT, useMediaQuery } from '../hooks/useCapabilities';
import { getStops, holdDoors, lift, onLiftFrame } from '../state/elevator';
import { CABIN_W, CABIN_Z, FLOOR_H, FLOOR_SIGN_W, FRONT_Z, OFFICE_SIGN_W, SIGN_Z, TOWER_D, WING_X } from './constants';

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * What the phone shot keeps on screen side by side (x, scene units): the cabin and the floor's name.
 * Floors 1–8 have their name on the left wing, so the camera stands to the left; the top floor (Office 902)
 * has its name on the right wing, so the camera swings to the right on the way up to it.
 */
const span = (from: number, to: number) => ({ mid: (from + to) / 2, half: (to - from) / 2 });
const FLOORS_VIEW = span(-WING_X - FLOOR_SIGN_W / 2, CABIN_W / 2);
const OFFICE_VIEW = span(-CABIN_W / 2, WING_X + OFFICE_SIGN_W / 2);
/** Room left on each side of that pair. */
const VIEW_MARGIN = 0.5;
/** Height of the middle of the pair above the floor (between the cabin's middle and the sign's). */
const VIEW_Y = 1.45;
/**
 * Doors open: the camera tilts down so the pair sits in the middle of the strip above the card
 * (the card covers the bottom 47% of the screen, the menu the top 67 px; see index.css).
 * The value is the tangent of that tilt.
 */
const ABOVE_CARD = 0.18;
/** Phone: seconds the shot rests on the office's name, doors fully open, before walking into the office. */
const OFFICE_NAME_HOLD = 1.6;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Quadratic Bézier between p0 and p2, pulled towards p1. Writes into `out`. */
function bezier(out: THREE.Vector3, p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, t: number) {
  const u = 1 - t;
  out.set(
    u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z,
  );
  return out;
}

/**
 * Moves the camera from the lift's live state:
 *  - lobby: standing on the street, looking up at the tower at sunset;
 *  - first part of the ride: flying in to the glass cabin;
 *  - then riding up with it, the cabin a little right of centre so the panels on the left never cover it;
 *  - at each floor the camera moves closer while the doors are open;
 *  - on the top stop it walks through the open cabin into Office 902 and looks out of its window.
 * In the phone layout (upright, card at the bottom) the camera rides further back, so the cabin and the
 * floor's name on the glass fit on the screen together: from the left for floors 1–8, swinging to the right
 * for the top floor. At a floor it tilts down so both sit above the card. With the names on the glass
 * switched off (panel: Settings), the cabin simply stays centred.
 * Other tall screens (tablets) keep the card on the left, so only the street shot leans that way.
 */
export function CameraRig({ signs = true }: { signs?: boolean }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const phoneLayout = useMediaQuery(PHONE_LAYOUT);
  const invalidate = useThree((s) => s.invalidate);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const pointer = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  /** 0 = outside the lift … 1 = inside Office 902. */
  const office = useRef(0);
  /** Phone shot: 0 = from the left (floor names) … 1 = from the right (the office's name). −1 = not set yet. */
  const side = useRef(-1);
  /** Seconds the top stop's doors have been fully open (for OFFICE_NAME_HOLD). */
  const held = useRef(0);
  const v = useMemo(
    () => ({
      streetPos: new THREE.Vector3(),
      streetLook: new THREE.Vector3(),
      ridePos: new THREE.Vector3(),
      rideLook: new THREE.Vector3(),
      tall: new THREE.Vector3(),
      pos: new THREE.Vector3(),
      look: new THREE.Vector3(),
      a: new THREE.Vector3(),
      b: new THREE.Vector3(),
    }),
    [],
  );

  // The layout can switch just after the resize was drawn (turning the phone): draw again.
  useEffect(() => invalidate(), [phoneLayout, invalidate]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      pointer.current.tx = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.ty = (e.clientY / window.innerHeight) * 2 - 1;
      invalidate();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    const off = onLiftFrame(() => invalidate());
    return () => {
      window.removeEventListener('pointermove', onMove);
      off();
      holdDoors(0);
    };
  }, [invalidate]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const p = pointer.current;
    const k = 1 - Math.exp(-dt * 2.6);
    p.x += (p.tx - p.x) * k;
    p.y += (p.ty - p.y) * k;
    let settling = Math.abs(p.tx - p.x) > 0.001 || Math.abs(p.ty - p.y) > 0.001;

    // Into the office only once the top stop's doors are open; back out first when leaving.
    // On a phone (with the names on the glass) the shot first rests on the office's name for a moment.
    const lastStop = getStops().length - 1;
    const atTop = lift.doorStop === lastStop && lift.doorWanted && lift.door > 0.35;
    const holdFor = phoneLayout && signs ? OFFICE_NAME_HOLD : 0;
    held.current = atTop && lift.door >= 1 ? held.current + dt : atTop ? held.current : 0;
    const resting = atTop && holdFor > 0 && held.current < holdFor;
    if (resting) settling = true; // keep drawing, so the hold's clock keeps running
    const wantOffice = atTop && !resting ? 1 : 0;
    const o0 = office.current;
    office.current += (wantOffice - o0) * (1 - Math.exp(-dt * (wantOffice ? 1.5 : 3.2)));
    if (Math.abs(wantOffice - office.current) < 0.002) office.current = wantOffice;
    else settling = true;
    // Doors stay open while the camera is still in the office (or in the doorway).
    holdDoors(office.current > 0.04 ? 1 : 0);

    // Phone shot: from the left up to the floor below the top, then over to the right during the last floor.
    // Follows the lift, eased in time so a fast scroll or a tap on the top button still swings smoothly.
    const topLevel = getStops()[lastStop]?.level ?? 0;
    const sideWant = smooth(clamp01(lift.level - (topLevel - 1)));
    if (side.current < 0) side.current = sideWant;
    side.current += (sideWant - side.current) * (1 - Math.exp(-dt * 3.5));
    if (Math.abs(sideWant - side.current) < 0.001) side.current = sideWant;
    else settling = true;

    // Narrow windows: step back a little so the tower still fits.
    const back = Math.max(0, 1.5 - aspect) * 7;
    const y = lift.level * FLOOR_H;
    const intro = easeInOut(Math.min(1, lift.intro * 1.05));
    const dolly = smooth(lift.door);

    // Street shot: 0 on wide screens … 1 in the phone layout (and on screens narrower than 0.6 × height).
    const tall = phoneLayout ? 1 : smooth(clamp01((0.95 - aspect) / 0.35));
    // Ride: the phone framing only where the card sits at the bottom; elsewhere it is on the left.
    const rideTall = phoneLayout ? 1 : 0;

    // Street: far enough to see the whole tower, which stands to the right of the title.
    v.streetPos.set(-16.5, 1.6, FRONT_Z + 52 + back * 2);
    v.streetLook.set(-16.5, 22, FRONT_Z);
    v.ridePos.set(-5.4 + dolly * 1.6, y + 2.6 - dolly * 0.6, FRONT_Z + 21 + back - dolly * 6.5);
    v.rideLook.set(-2.6 + dolly * 0.9, y + 1.55, CABIN_Z);
    if (tall > 0) {
      // The whole tower in the middle of the screen, its lit office floor above the title.
      v.streetPos.lerp(v.tall.set(-2.5, 1.2, FRONT_Z + 66), tall);
      v.streetLook.lerp(v.tall.set(0.6, 19.5, FRONT_Z), tall);
    }
    if (rideTall > 0 && signs) {
      // Riding: the cabin and the floor's name side by side, far enough back for both to fit the screen's width.
      const s = side.current;
      const mid = mix(FLOORS_VIEW.mid, OFFICE_VIEW.mid, s);
      const half = mix(FLOORS_VIEW.half, OFFICE_VIEW.half, s) + VIEW_MARGIN;
      const rideFov = 40 + tall * 2; // the fov below once the ride has started
      const dist = Math.min(44, Math.max(18, half / (Math.tan(THREE.MathUtils.degToRad(rideFov / 2)) * aspect)));
      const camZ = SIGN_Z + dist;
      // Doors open: tilted so the pair moves up above the card.
      v.ridePos.lerp(v.tall.set(mid, y + 2.4 - dolly * 0.3, camZ), rideTall);
      v.rideLook.lerp(v.tall.set(mid, y + VIEW_Y - dolly * ABOVE_CARD * (camZ - CABIN_Z), CABIN_Z), rideTall);
    } else if (rideTall > 0) {
      // No names on the glass: the cabin in the middle. Doors open: closer, and tilted so it moves up above the card.
      v.ridePos.lerp(v.tall.set(-1.3, y + 2.6 - dolly * 0.3, FRONT_Z + 26 - dolly * 4), rideTall);
      v.rideLook.lerp(v.tall.set(0, y + 1.4 - dolly * 3.8, CABIN_Z), rideTall);
    }

    v.pos.lerpVectors(v.streetPos, v.ridePos, intro);
    v.look.lerpVectors(v.streetLook, v.rideLook, intro);
    // Rising arc on the way in, instead of a straight line through the plaza.
    v.pos.y += Math.sin(intro * Math.PI) * 4;

    const t = easeInOut(office.current);
    if (t > 0) {
      // Curve: from the ride position, through the open cabin, into the office facing the window.
      const oy = lift.level * FLOOR_H;
      v.a.set(0, oy + 1.66, CABIN_Z + 2.4);
      v.b.set(-0.6, oy + 1.7, -0.4);
      bezier(v.pos, v.pos.clone(), v.a, v.b, t);
      const la = v.a.clone().set(0, oy + 1.6, -TOWER_D);
      const lb = v.a.clone().set(-3.4, oy + 1.25, -TOWER_D / 2 - 8);
      bezier(v.look, v.look.clone(), la, lb, t);
    }

    const sway = 1 - t * 0.7;
    v.pos.x += p.x * 0.45 * sway;
    v.pos.y -= p.y * 0.25 * sway;
    camera.position.copy(v.pos);
    camera.lookAt(v.look);
    const fov = 47 - 7 * intro + tall * (3 - intro);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    if (settling) invalidate();
  });

  return null;
}
