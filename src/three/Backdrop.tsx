import { useEffect, useMemo, useRef, type CSSProperties, type RefObject } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { media } from '../lib/demo';
import { getStops } from '../state/elevator';
import { FLOOR_H } from './constants';

/**
 * The moving Dubai video behind the 3D tower.
 *
 * It is an ordinary <video> under a transparent canvas, not a texture in the scene: the browser
 * decodes and shows it on its own, so the 3D scene still draws only while something moves.
 * BackdropFollow (inside the canvas) places it each time the camera moves, as if the city were very
 * far away: the far shore of the video stays on the 3D horizon whether the camera looks up at the
 * tower from the street or straight out of the lift, and it slides sideways when the camera turns.
 * Riding up, the city sinks a little below the horizon, so the climb is felt in the background too.
 */

/** Height of the far shore (the waterline) in the video, as a share of its height from the top. */
const HORIZON = 0.815;
/** The video is drawn this much taller than the screen, so there is room to follow the camera. */
const OVERSCAN = 1.25;
/** How far the city sinks below the horizon at the top floor, as a share of the screen's height. */
const RISE = 0.07;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

export interface BackdropProps {
  src: string;
  srcPhone: string;
  poster: string;
  /** 0 – 70 (%). */
  dim: number;
  /** Start the video (once the 3D scene is on screen, so it never slows down the tower's loading). */
  play: boolean;
  frameRef: RefObject<HTMLDivElement | null>;
}

/** Visitors who save mobile data or asked for less motion keep the still picture. */
function stillOnly(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !!c?.saveData || matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function VideoBackdrop({ src, srcPhone, poster, dim, play, frameRef }: BackdropProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Chosen once: turning the phone must not start a second download.
  const file = useMemo(() => (matchMedia('(max-width: 767px)').matches && srcPhone ? srcPhone : src), [src, srcPhone]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !play || !file || stillOnly()) return;
    v.muted = true;
    v.defaultMuted = true;
    const start = () => void v.play().catch(() => undefined); // blocked (e.g. low-power mode): the picture stays
    const url = media(file);
    // Demo build: the file is read whole and played from memory. Demo hosts (ILUZ) send files only in one
    // piece, and Safari plays a video file only from a server that sends it in pieces (Range requests).
    let blobUrl = '';
    const ctl = new AbortController();
    if (__DEMO__ && url.startsWith('./')) {
      fetch(url, { signal: ctl.signal })
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then((b) => {
          blobUrl = URL.createObjectURL(b);
          v.src = blobUrl;
          start();
        })
        .catch(() => undefined); // not found or stopped: the picture stays
    } else {
      v.src = url;
      start();
    }
    // Some browsers pause muted videos in hidden tabs and do not resume them.
    const onVisible = () => !document.hidden && v.paused && start();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      ctl.abort();
      v.pause();
      v.removeAttribute('src');
      v.load();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [play, file]);

  return (
    <div className="backdrop" style={{ '--dim': clamp(dim, 0, 70) / 100 } as CSSProperties}>
      <div className="backdrop-frame" ref={frameRef}>
        <video
          ref={videoRef}
          className="backdrop-video"
          poster={poster ? media(poster) : undefined}
          muted
          loop
          playsInline
          preload="none"
          disablePictureInPicture
          disableRemotePlayback
          aria-hidden="true"
          tabIndex={-1}
        />
      </div>
    </div>
  );
}

/** Inside the canvas: moves the video with the camera (mounted after CameraRig, so it sees this frame's camera). */
export function BackdropFollow({ frameRef }: { frameRef: RefObject<HTMLDivElement | null> }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const p = useMemo(() => new THREE.Vector3(), []);
  const last = useRef('');

  useFrame(() => {
    const el = frameRef.current;
    if (!el) return;
    const { width: W, height: H } = size;
    // Cover the screen with room to spare; very wide windows are covered by width instead.
    const h = Math.max(H * OVERSCAN, ((W * 1.1) / 16) * 9);
    const w = (h / 9) * 16;
    // A point far away straight ahead of the street camera (−z), at eye height: it sits on the horizon.
    camera.updateMatrixWorld();
    p.set(camera.position.x, camera.position.y, camera.position.z - 1e5).project(camera);
    const sx = ((p.x + 1) / 2) * W;
    const sy = ((1 - p.y) / 2) * H;
    // The column of the video that sits in front of the street camera: a little left of its middle, so the
    // Burj Khalifa stays on screen beside the tower on phones and stands behind the title on computers.
    const focus = clamp(0.38 + 0.06 * (W / Math.max(1, H)), 0.4, 0.48);
    const top = (getStops().at(-1)?.level ?? 9) * FLOOR_H;
    const rise = smooth(clamp(camera.position.y / Math.max(1, top), 0, 1)) * RISE * H;
    const x = clamp(sx - focus * w, W - w, 0);
    const y = sy - HORIZON * h + rise;
    const key = `${w.toFixed(0)} ${h.toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)}`;
    if (key === last.current) return;
    last.current = key;
    el.style.width = `${w.toFixed(0)}px`;
    el.style.height = `${h.toFixed(0)}px`;
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
  });
  return null;
}
