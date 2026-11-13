/**
 * The lift engine: turns the page's native scroll into lift motion.
 *
 * Each stop (lobby, floors, contact) is a <section>. In 3D mode a section is taller than
 * the screen and its panel is `position: sticky`, so the section has a "stop window"
 * (from its top reaching the top of the screen until its bottom reaches the bottom).
 * Inside a stop window the lift waits at that floor; between windows it travels.
 *
 * "Rise" (3D, panel: Settings → Scroll up to ride the lift up): the sections are laid out
 * bottom to top (lobby at the bottom of the page, Office 902 at the top) and the page starts
 * at the bottom, so scrolling up takes the lift up. The engine then works in a mirrored
 * coordinate, the distance scrolled up from the lobby, so everything below stays the same.
 *
 * One rAF loop computes the state; the 3D scene reads `lift` every frame, while React
 * components subscribe with useLift() and only re-render when a discrete value changes.
 */
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import { useSyncExternalStore } from 'react';
import type { Stop } from '../content/types';

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);

export type LiftMode = '3d' | 'flow';

export interface LiftState {
  /** Continuous stop index (0 = lobby). */
  pos: number;
  /** Continuous building level, eased between stops (what the cabin and camera follow). */
  level: number;
  /** 0 = doors closed … 1 = fully open. */
  door: number;
  /** Stop whose doors are (or were last) open, -1 = none. */
  doorStop: number;
  /** Nearest stop index. */
  current: number;
  /** Stop whose panel is shown, -1 = none (travelling). */
  openStop: number;
  /** Rounded level, for the floor display. */
  floor: number;
  dir: -1 | 0 | 1;
  heroVisible: boolean;
  /** 0 → 1 while the camera flies from the street into the lift. */
  intro: number;
  /** True while the lift wants its doors open (before any hold from the 3D camera). */
  doorWanted: boolean;
}

const state: LiftState = {
  pos: 0,
  level: 0,
  door: 0,
  doorStop: -1,
  current: 0,
  openStop: 0,
  floor: 0,
  dir: 0,
  heroVisible: true,
  intro: 0,
  doorWanted: false,
};

/** Read-only live state (read it inside animation frames). */
export const lift: Readonly<LiftState> = state;

let stops: Stop[] = [];
let triggers: ScrollTrigger[] = [];
let wins: { s: number; e: number }[] = [];
let mode: LiftMode = 'flow';
let reduced = false;
let smoothY = typeof window !== 'undefined' ? window.scrollY : 0;
let lastT = 0;
/** Rise mode: real scroll position of the lobby's window end (the bottom of the page). */
let rise = false;
let base = 0;
/** Real scroll ↔ the engine's coordinate (they are the same formula both ways). */
const toV = (y: number) => (rise ? base - y : y);
const toReal = (v: number) => (rise ? base - v : v);
/** Where the lift is (from the last frame whose layout matched the windows), to put it back after a resize. */
let anchor: { pos: number; dwell: number } | null = null;
/** Page height when the windows were measured. */
let winsHeight = 0;
let staleFor = 0;
/** Smoothed lift position, kept across a refresh. */
let seen: { pos: number; dwell: number } | null = null;
let configuring = false;
/** #floor in the address when the page was opened, read before anything rewrites it. */
let openedHash = typeof location !== 'undefined' ? location.hash : '';
let raf = 0;
let lastLevel = 0;
let stillFor = 0;
let prev = { pos: -1, level: -1, door: -1, wanted: false };
let tween: gsap.core.Tween | null = null;
/** Set by the 3D camera while it is inside Office 902: the doors stay open until it is back out. */
let hold = 0;
/** Set while a lift button animates the scroll: the cabin goes straight to the target floor. */
let express: { from: number; to: number; levelFrom: number; y0: number; y1: number; done: boolean } | null = null;

const discrete = new Set<() => void>();
const frame = new Set<() => void>();

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Doors open during this part of a stop window (as a fraction of it). */
const DOOR_FROM = 0.03;
const DOOR_UNTIL = 0.9;
/** Seconds the doors take to open. */
const DOOR_SECONDS = 0.8;
/**
 * 2D version: the cabin stays at a floor for this part of its section (doors open),
 * then travels to the next floor in the rest of it.
 */
const FLOW_PARK = 0.68;

function readWindows() {
  const max = ScrollTrigger.maxScroll(window);
  const real = triggers.map((t) => {
    if (mode === '3d') return { s: t.start, e: Math.max(t.start, t.end) };
    const a = clamp(t.start, 0, max);
    return { s: a, e: a };
  });
  // Rise: mirrored, so the lobby's window starts at 0 and the windows still grow stop by stop.
  base = rise && real.length ? real[0].e : 0;
  wins = rise ? real.map((w) => ({ s: base - w.e, e: base - w.s })) : real;
  for (let i = 1; i < wins.length; i++) {
    if (wins[i].s < wins[i - 1].e) wins[i].s = wins[i - 1].e;
    if (wins[i].e < wins[i].s) wins[i].e = wins[i].s;
  }
}

/** The engine's coordinate of a lift position (the inverse of map()). */
function spotOf(a: { pos: number; dwell: number }): number {
  const n = wins.length;
  if (!n) return 0;
  if (a.dwell >= 0) {
    const w = wins[clamp(Math.round(a.pos), 0, n - 1)];
    return w.s + (w.e - w.s) * clamp(a.dwell, 0, 1);
  }
  const i = clamp(Math.floor(a.pos), 0, Math.max(0, n - 2));
  const p = wins[i];
  const w = wins[Math.min(n - 1, i + 1)];
  return p.e + (w.s - p.e) * clamp(a.pos - i, 0, 1);
}

/** Scrolls to a lift position (only if it is not there already). */
function place(a: { pos: number; dwell: number }) {
  const y = clamp(Math.round(toReal(spotOf(a))), 0, ScrollTrigger.maxScroll(window));
  if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
}

ScrollTrigger.addEventListener('refreshInit', () => {
  seen = wins.length ? map(smoothY) : null;
});
ScrollTrigger.addEventListener('refresh', () => {
  readWindows();
  winsHeight = document.documentElement.scrollHeight;
  if (configuring || mode !== '3d') return;
  // The page was measured again (resize, turning the phone): keep the lift where it was.
  // Needed above all when rising: the page is anchored at the bottom, but the browser keeps the top.
  if (anchor && !tween?.isActive()) place(anchor);
  if (seen) smoothY = spotOf(seen);
});

function map(y: number): { pos: number; dwell: number } {
  const n = wins.length;
  if (!n || y <= wins[0].s) return { pos: 0, dwell: 0 };
  for (let i = 0; i < n; i++) {
    const w = wins[i];
    if (y < w.s) {
      const p = wins[i - 1];
      return { pos: i - 1 + clamp((y - p.e) / Math.max(1, w.s - p.e), 0, 1), dwell: -1 };
    }
    if (y <= w.e) return { pos: i, dwell: w.e > w.s ? (y - w.s) / (w.e - w.s) : 0.5 };
  }
  return { pos: n - 1, dwell: 1 };
}

function levelAt(pos: number): number {
  const n = stops.length;
  const i0 = clamp(Math.floor(pos), 0, n - 1);
  const i1 = Math.min(n - 1, i0 + 1);
  const f = clamp(pos - i0, 0, 1);
  // Eased between stops: the cabin pulls away gently and slows down before each floor.
  const e = mode === '3d' ? easeInOut(f) : smooth(clamp((f - FLOW_PARK) / (1 - FLOW_PARK), 0, 1));
  return stops[i0].level + (stops[i1].level - stops[i0].level) * e;
}

function tick(t: number) {
  raf = requestAnimationFrame(tick);
  if (!stops.length) return;
  const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 1 / 60;
  lastT = t;

  const y = toV(window.scrollY);
  // Remember where the lift is, but only while the page still has the height its windows were measured at.
  if (mode === '3d') {
    const h = document.documentElement.scrollHeight;
    if (h === winsHeight) {
      anchor = map(y);
      staleFor = 0;
    } else if ((staleFor += dt) > 1.5) winsHeight = h; // changed, and no new measuring followed: take the page as it is
  }
  const k = mode === '3d' && !reduced ? 6.5 : 40;
  smoothY += (y - smoothY) * (1 - Math.exp(-dt * k));
  if (Math.abs(y - smoothY) < 0.25) smoothY = y;

  let { pos, dwell } = map(smoothY);
  let level: number;

  if (express) {
    const span = express.y1 - express.y0;
    const p = Math.abs(span) < 1 ? 1 : clamp((smoothY - express.y0) / span, 0, 1);
    if (express.done && Math.abs(y - smoothY) < 2) {
      express = null;
      level = levelAt(pos);
    } else {
      pos = express.from + (express.to - express.from) * p;
      level = express.levelFrom + (stops[express.to].level - express.levelFrom) * p;
      dwell = -1;
    }
  } else {
    level = levelAt(pos);
  }

  // Doors: open while parked inside a stop window, closed while travelling.
  let target = 0;
  let cand = -1;
  if (mode === '3d' && dwell >= 0 && !express) {
    const i = Math.round(pos);
    const last = i === stops.length - 1;
    if (i > 0 && dwell >= DOOR_FROM && (last || dwell <= DOOR_UNTIL)) {
      target = 1;
      cand = i;
    }
  } else if (mode === 'flow') {
    // 2D: open during the parked part of each section (the cabin there is just a drawing).
    const i = clamp(Math.floor(pos), 0, stops.length - 1);
    if (i === stops.length - 1 || pos - i < FLOW_PARK - 0.08) {
      target = 1;
      cand = i;
    }
  }
  if (target === 1 && state.doorStop !== -1 && state.doorStop !== cand && state.door > 0) target = 0;
  state.doorWanted = target === 1;
  if (target === 0 && hold > 0.001 && state.doorStop >= 0) target = 1;
  const rate = reduced ? 1000 : 1 / DOOR_SECONDS;
  if (state.door < target) {
    if (state.door === 0) state.doorStop = cand;
    state.door = Math.min(1, state.door + rate * dt);
  } else if (state.door > target) {
    state.door = Math.max(0, state.door - rate * 1.25 * dt);
  }
  if (state.door === 0 && target === 0) state.doorStop = -1;

  // The cabin never leaves with open doors: it waits for them, then catches up smoothly.
  if (mode === '3d' && state.doorStop >= 0 && state.door > 0) {
    const g = smooth(state.door);
    const at = stops[state.doorStop];
    pos = state.doorStop + (pos - state.doorStop) * (1 - g);
    level = at.level + (level - at.level) * (1 - g);
  }

  state.pos = pos;
  state.level = level;
  state.intro = clamp(pos, 0, 1);

  // 2D: the next floor becomes current once the cabin is halfway there.
  const current = clamp(mode === '3d' ? Math.round(pos) : Math.floor(pos + (1 - FLOW_PARK) / 2), 0, stops.length - 1);
  const floor = Math.round(level);
  const dl = level - lastLevel;
  lastLevel = level;
  let dir = state.dir;
  if (Math.abs(dl) > 0.0006) {
    dir = dl > 0 ? 1 : -1;
    stillFor = 0;
  } else if ((stillFor += dt) > 0.2) dir = 0;
  const heroVisible = mode === '3d' ? pos < 0.08 : true;
  const openStop = mode === '3d' ? (state.door > 0.45 ? state.doorStop : pos < 0.08 ? 0 : -1) : current;

  const changed =
    current !== state.current ||
    floor !== state.floor ||
    dir !== state.dir ||
    heroVisible !== state.heroVisible ||
    openStop !== state.openStop;
  state.current = current;
  state.floor = floor;
  state.dir = dir;
  state.heroVisible = heroVisible;
  state.openStop = openStop;
  if (changed) discrete.forEach((f) => f());

  if (
    Math.abs(prev.pos - pos) > 1e-5 ||
    Math.abs(prev.level - level) > 1e-5 ||
    Math.abs(prev.door - state.door) > 1e-5 ||
    prev.wanted !== state.doorWanted
  ) {
    prev = { pos, level, door: state.door, wanted: state.doorWanted };
    frame.forEach((f) => f());
  }
}

/** (Re)binds the lift to the rendered sections. Call after layout changes mode or stops. */
export function configureLift(
  next: Stop[],
  els: (HTMLElement | null)[],
  nextMode: LiftMode,
  opts: { rise?: boolean } = {},
) {
  // Where the lift is now, to bring it back there in the new layout.
  const had = triggers.length > 0;
  const sameKind = had && mode === nextMode;
  const keep = !had ? null : mode === '3d' ? (anchor ?? map(toV(window.scrollY))) : { pos: state.current, dwell: 0 };
  const keepStop = keep ? clamp(Math.round(keep.pos), 0, Math.max(0, next.length - 1)) : 0;
  triggers.forEach((t) => t.kill());
  tween?.kill();
  express = null;
  mode = nextMode;
  rise = nextMode === '3d' && !!opts.rise;
  setRiseKeys(rise);
  const pairs = next.map((s, i) => [s, els[i]] as const).filter(([, el]) => !!el);
  stops = pairs.map(([s]) => s);
  triggers = pairs.map(([, el]) =>
    ScrollTrigger.create({
      trigger: el as HTMLElement,
      start: nextMode === '3d' ? 'top top' : 'top 45%',
      end: nextMode === '3d' ? 'bottom bottom' : 'bottom 45%',
    }),
  );
  configuring = true;
  ScrollTrigger.refresh();
  configuring = false;
  readWindows();
  winsHeight = document.documentElement.scrollHeight;
  if (nextMode === '3d') {
    if (keep && sameKind) place(keep); // same version: exactly where it was
    else if (keep) goTo(keepStop, { instant: true }); // the other version: the same floor
    else if (rise) place({ pos: 0, dwell: 0 }); // first time: in the lobby, at the bottom of the page
  } else if (keep && !sameKind) goTo(keepStop, { instant: true });
  smoothY = toV(window.scrollY);
  anchor = null;
  state.door = 0;
  state.doorStop = -1;
  prev = { pos: -1, level: -1, door: -1, wanted: false };
  if (!raf) raf = requestAnimationFrame(tick);
  discrete.forEach((f) => f());
}

/** Keeps the doors open (0 = no hold). Used by the camera while it walks into Office 902. */
export function holdDoors(v: number) {
  hold = v;
}

export function refreshLift() {
  ScrollTrigger.refresh();
}

export function setReducedMotion(v: boolean) {
  reduced = v;
}

export function liftMode(): LiftMode {
  return mode;
}

export function getStops(): Stop[] {
  return stops;
}

export function stopIndex(key: string): number {
  return stops.findIndex((s) => s.key === key);
}

/** Takes the lift straight to a stop (used by the lift buttons, the menu and #links). */
export function goTo(index: number, opts: { instant?: boolean } = {}) {
  const trig = triggers[index];
  if (!trig) return;
  readWindows();
  const w = wins[index];
  const last = index === stops.length - 1;
  let y: number;
  if (index === 0) y = toReal(0);
  else if (mode === '3d') y = toReal(w.s + (w.e - w.s) * (last ? 0.45 : 0.28));
  else y = (trig.trigger as HTMLElement).getBoundingClientRect().top + window.scrollY - 72;
  y = clamp(Math.round(y), 0, ScrollTrigger.maxScroll(window));
  tween?.kill();
  if (opts.instant || reduced) {
    express = null;
    window.scrollTo(0, y);
    smoothY = toV(y);
    // Right away, not on the next frame: a re-measure in between would otherwise put the lift back.
    if (mode === '3d') anchor = map(smoothY);
    return;
  }
  const dist = Math.abs(index - state.pos);
  if (mode === '3d') {
    express = { from: state.pos, to: index, levelFrom: state.level, y0: toV(window.scrollY), y1: toV(y), done: false };
  }
  tween = gsap.to(window, {
    duration: mode === '3d' ? Math.min(3.4, 1.2 + dist * 0.3) : Math.min(1.4, 0.6 + dist * 0.1),
    ease: 'power2.inOut',
    scrollTo: { y, autoKill: true },
    onComplete: () => {
      if (express) express.done = true;
    },
    onInterrupt: () => {
      express = null;
    },
  });
}

/** On load: a #floor in the address jumps straight there. */
export function jumpToHash() {
  // The address the page was opened with: by now the #floor may already show the lobby (SeoSync).
  const key = decodeURIComponent((openedHash || location.hash).slice(1));
  openedHash = '';
  const i = key ? stopIndex(key) : -1;
  // No #floor: stay put (when rising, configureLift has already put the page at the lobby, at the bottom).
  if (i > 0) goTo(i, { instant: true });
}

/** True while scrolling up rides the lift up (3D, panel setting on). */
export function rising(): boolean {
  return rise;
}

/**
 * Rise mode keys: Space goes on up the tower (Shift+Space back down), Home = lobby, End = Office 902.
 * The arrow and Page keys already match: up = up.
 */
function onRiseKey(e: KeyboardEvent) {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const t = e.target instanceof Element ? e.target : null;
  if (t?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
  if (e.key === ' ') {
    if (t?.closest('button, a[href], summary, [role="button"], [role="link"]')) return;
    e.preventDefault();
    window.scrollBy({ top: (e.shiftKey ? 1 : -1) * window.innerHeight * 0.85, behavior: reduced ? 'auto' : 'smooth' });
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    goTo(e.key === 'Home' ? 0 : stops.length - 1);
  }
}
let riseKeys = false;
function setRiseKeys(on: boolean) {
  if (on === riseKeys || typeof window === 'undefined') return;
  riseKeys = on;
  if (on) window.addEventListener('keydown', onRiseKey);
  else window.removeEventListener('keydown', onRiseKey);
}

function subscribe(cb: () => void) {
  discrete.add(cb);
  return () => {
    discrete.delete(cb);
  };
}

/** React hook: re-renders only when the selected (primitive) value changes. */
export function useLift<T extends string | number | boolean>(sel: (s: LiftState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => sel(state),
    () => sel(state),
  );
}

/** Called on every frame in which the lift moved (3D invalidation, 2D cabin). */
export function onLiftFrame(cb: () => void) {
  frame.add(cb);
  return () => {
    frame.delete(cb);
  };
}
