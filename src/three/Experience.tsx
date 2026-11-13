import { memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { buildStops, contactLevel, levelLabels, type SiteContent } from '../content';
import { PHONE_LAYOUT, useMediaQuery } from '../hooks/useCapabilities';
import { media } from '../lib/demo';
import { loadSkylineImage } from '../lib/skyline';
import { getStops, lift } from '../state/elevator';
import { BackdropFollow, VideoBackdrop } from './Backdrop';
import { CameraRig } from './CameraRig';
import { Elevator } from './Elevator';
import { Sky, Surroundings } from './Surroundings';
import { Tower } from './Tower';

/**
 * Renderer settings. Neutral tone mapping keeps the brand colours (ACES turned the plum brown and
 * the neon orange) and rolls the over-bright lights off to a warm white instead of clipping.
 * The canvas is transparent and premultiplied, so the video shows through wherever nothing is drawn.
 */
const SCREEN_DPR = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
/** Sharpest drawing size (pixels per CSS pixel). Above 1.5 the eye sees no difference, the graphics card does. */
const MAX_DPR = Math.min(SCREEN_DPR, 1.5);
/** Smallest drawing size the scene may drop to on slow graphics, to keep 60 frames a second. */
const MIN_DPR = Math.min(MAX_DPR, 0.7);

const GL = {
  // Smoothed edges cost every pixel four samples; on sharp screens (1.5× and more) the edges are already fine.
  antialias: SCREEN_DPR < 1.5,
  powerPreference: 'high-performance',
  alpha: true,
  premultipliedAlpha: true,
  stencil: false,
  toneMapping: THREE.NeutralToneMapping,
} as const;

/** Where the waterline sits in the still picture of the video, from its top (see Backdrop.tsx). */
const POSTER_HORIZON = 0.815;
const CITY_R = 50;
const CITY_H = 60;

interface Props {
  content: SiteContent;
  onReady: () => void;
  onFail: () => void;
  /** Called once if this device draws the tower too slowly (the site then shows the 2D version). */
  onSlow?: () => void;
}

/**
 * Times the frames while the camera moves. The scene draws nothing while everything is still, so
 * only a frame that follows a moving one counts: that one was asked for straight away, and its
 * wait is the real time a frame takes here. If the typical frame takes longer than 50 ms (under
 * 20 frames a second), the device is too slow for the 3D tower. Mounted after CameraRig, so it
 * sees the camera where this frame puts it.
 */
function SlowGuard({ onSlow }: { onSlow: () => void }) {
  const camera = useThree((s) => s.camera);
  const m = useRef({ last: 0, key: '', moving: false, gaps: [] as number[], total: 0, done: false });
  useFrame(() => {
    const s = m.current;
    if (s.done) return;
    const now = performance.now();
    const gap = now - s.last;
    s.last = now;
    const { x, y, z } = camera.position;
    const key = `${x.toFixed(3)} ${y.toFixed(3)} ${z.toFixed(3)}`;
    const wasMoving = s.moving;
    s.moving = key !== s.key;
    s.key = key;
    if (!wasMoving || document.hidden || gap <= 0 || gap > 2500) return;
    s.gaps.push(gap);
    s.total += gap;
    // At least 12 frames (a hitch or two while things load stays a minority), then 40 or 3 s.
    if (s.gaps.length < 12 || (s.gaps.length < 40 && s.total < 3000)) return;
    s.done = true;
    const sorted = [...s.gaps].sort((a, b) => a - b);
    if (sorted[sorted.length >> 1] > 50) onSlow();
  });
  return null;
}

/**
 * Keeps the ride at the screen's full frame rate (60 frames a second, more on faster screens). It times the
 * frames while the camera moves, as SlowGuard does, in groups of 24. When the typical frame of two groups in a
 * row takes longer than 18 ms (under about 55 a second), the graphics card is the limit: the scene is drawn
 * with 20 % fewer pixels per side, down to MIN_DPR. After 8 smooth groups it tries one step sharper again, but
 * never back to a size that was already too slow.
 */
function AdaptiveResolution() {
  const camera = useThree((s) => s.camera);
  const setDpr = useThree((s) => s.setDpr);
  const m = useRef({ last: 0, key: '', moving: false, gaps: [] as number[], dpr: MAX_DPR, ceiling: MAX_DPR, slow: 0, good: 0 });
  useFrame(() => {
    const s = m.current;
    const now = performance.now();
    const gap = now - s.last;
    s.last = now;
    const { x, y, z } = camera.position;
    const key = `${x.toFixed(3)} ${y.toFixed(3)} ${z.toFixed(3)}`;
    const wasMoving = s.moving;
    s.moving = key !== s.key;
    s.key = key;
    if (!wasMoving || document.hidden || gap <= 0 || gap > 250) return;
    s.gaps.push(gap);
    if (s.gaps.length < 24) return;
    const median = [...s.gaps].sort((a, b) => a - b)[12];
    s.gaps.length = 0;
    if (median > 18) {
      s.good = 0;
      if (++s.slow < 2 || s.dpr <= MIN_DPR) return;
      s.slow = 0;
      s.ceiling = s.dpr;
      s.dpr = Math.max(MIN_DPR, Math.round(s.dpr * 80) / 100);
      setDpr(s.dpr);
    } else {
      s.slow = 0;
      if (++s.good < 8) return;
      s.good = 0;
      const next = Math.min(MAX_DPR, Math.round(s.dpr * 110) / 100);
      if (next >= s.ceiling - 0.001) return;
      s.dpr = next;
      setDpr(next);
    }
  });
  return null;
}

/** Waits for the web fonts, so the signs on the glass are drawn with Inter, not a fallback. */
function useFontsReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    const fonts = document.fonts;
    if (!fonts) {
      setReady(true);
      return;
    }
    Promise.all([fonts.load('500 76px "Inter Variable"'), fonts.load('500 250px "Cormorant Garamond"')])
      .catch(() => null)
      .then(() => alive && setReady(true));
    const t = setTimeout(() => alive && setReady(true), 2500);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, []);
  return ready;
}

/**
 * Calls onReady once the first frame with everything loaded has been drawn. It asks for that frame
 * itself: the scene only draws on demand, and the frame that loading asked for may already be gone.
 */
function Ready({ onReady }: { onReady: () => void }) {
  const done = useRef(false);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [invalidate]);
  useFrame(() => {
    if (done.current) return;
    done.current = true;
    requestAnimationFrame(onReady);
  });
  return null;
}

/** The brightness setting of the panel, as the renderer's exposure. */
function Exposure({ value }: { value: number }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    gl.toneMappingExposure = Math.min(1.4, Math.max(0.7, value || 1.1));
    invalidate();
  }, [gl, value, invalidate]);
  return null;
}

/**
 * Reflections for the glass, rendered once into a cube: the still picture of the Dubai video wrapped
 * around (mirrored three times, so it has no seam), the sunset sky above and below it, and a few soft
 * light panels. Without a picture, only the sunset studio of light panels.
 * Memoised: the environment is captured again whenever its children change, and Experience
 * re-renders while it fades in. The picture is loaded into state (not Suspense): a failed download
 * then only leaves the light panels, instead of sending the visitor to the 2D site.
 */
const Reflections = memo(function Reflections({ poster }: { poster: string }) {
  const invalidate = useThree((s) => s.invalidate);
  const [city, setCity] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let alive = true;
    let tex: THREE.Texture | null = null;
    setCity(null);
    if (poster) {
      loadSkylineImage(poster, 2, 1024).then((c) => {
        if (!alive || !c) return;
        tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.MirroredRepeatWrapping;
        tex.repeat.set(3, 1);
        setCity(tex);
        invalidate();
      });
    }
    return () => {
      alive = false;
      tex?.dispose();
    };
  }, [poster, invalidate]);
  const k = city ? 0.5 : 1;
  // The waterline of the picture at the height of the cube camera.
  const cityY = CITY_H / 2 - (1 - POSTER_HORIZON) * CITY_H;
  return (
    <Environment resolution={256} frames={1}>
      <Sky />
      {city && (
        <mesh position={[0, cityY, 0]}>
          <cylinderGeometry args={[CITY_R, CITY_R, CITY_H, 48, 1, true]} />
          <meshBasicMaterial map={city} side={THREE.BackSide} toneMapped={false} fog={false} />
        </mesh>
      )}
      <Lightformer form="rect" intensity={2.4 * k} color="#ff8a4c" position={[0, 2, -40]} scale={city ? [60, 3, 1] : [90, 8, 1]} />
      <Lightformer form="rect" intensity={1.5 * k} color="#d6247a" position={[-40, 12, 0]} rotation-y={Math.PI / 2} scale={[60, 16, 1]} />
      <Lightformer form="rect" intensity={0.9} color="#6b1f4e" position={[0, 40, 0]} rotation-x={Math.PI / 2} scale={[80, 80, 1]} />
      <Lightformer form="rect" intensity={1.2 * k} color="#ffb98a" position={[40, 6, 10]} rotation-y={-Math.PI / 2} scale={[40, 5, 1]} />
      {/* Behind the camera: the front glass reflects this direction, so it would hide the city. */}
      {!city && <Lightformer form="rect" intensity={0.7} color="#ff5f8f" position={[0, 8, 40]} rotation-y={Math.PI} scale={[60, 10, 1]} />}
    </Environment>
  );
});

export default function Experience({ content, onReady, onFail, onSlow }: Props) {
  const fontsReady = useFontsReady();
  const [shown, setShown] = useState(false);
  const stops = useMemo(() => buildStops(content), [content]);
  const labels = useMemo(() => levelLabels(content), [content]);
  const top = contactLevel(content);
  const officeSign = `${content.nav.contact} – ${content.contact.label}`;
  const { settings } = content;
  // The Dubai video behind the tower (or its still picture); without either, the drawn sky and skyline.
  const video = settings.backdropVideo && !!(settings.backdropSrc || settings.backdropPoster);
  const frameRef = useRef<HTMLDivElement>(null);
  const fog = video ? '#3b1733' : '#3d1636';
  const phone = useMediaQuery(PHONE_LAYOUT);
  // The scene appears once the baked ground is in (so it does not pop in under the tower), or after 4 s.
  // Derived, not stored: if the ground is switched off (the panel's preview) while it is still loading, the scene
  // must not keep waiting for it.
  const ground = settings.groundShow !== false;
  const [groundLoaded, setGroundLoaded] = useState(false);
  const groundSettled = !ground || groundLoaded;
  useEffect(() => {
    if (groundSettled) return;
    const t = setTimeout(() => setGroundLoaded(true), 4000);
    return () => clearTimeout(t);
  }, [groundSettled]);

  return (
    <div className={`scene ${shown ? 'is-ready' : ''}`} aria-hidden="true">
      {video && (
        <VideoBackdrop
          src={settings.backdropSrc}
          srcPhone={settings.backdropSrcPhone}
          poster={settings.backdropPoster}
          dim={settings.backdropDim}
          play={shown}
          frameRef={frameRef}
        />
      )}
      <Canvas
        dpr={MAX_DPR}
        frameloop="demand"
        // Transparent, so the video shows behind the tower; with the drawn sky the background colour fills it.
        gl={GL}
        camera={{ fov: 47, near: 0.1, far: 1400, position: [-16.5, 1.6, 57.5] }}
        onCreated={(state) => {
          const { gl } = state;
          // Development only: lets the test scripts read the lift and the scene.
          if (import.meta.env.DEV) Object.assign(window, { __lift: { lift, getStops }, __r3f: state });
          gl.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            onFail();
          });
        }}
      >
        {!video && <color attach="background" args={['#12090F']} />}
        {/* With the video, the top of the tower fades into the plum dusk of its sky. */}
        <fog attach="fog" args={video ? [fog, 40, 240] : [fog, 45, 300]} />
        <Exposure value={settings.sceneBrightness} />
        {/* Dusk: a dim plum sky light, a low orange sun behind the city, a faint magenta fill. */}
        <hemisphereLight args={['#a07a9a', '#12090F', 0.4]} />
        <directionalLight position={[-30, 18, -40]} intensity={0.8} color="#ff9a5c" />
        <directionalLight position={[25, 30, 30]} intensity={0.25} color="#c98ab0" />
        <Suspense fallback={null}>
          <Reflections poster={video && settings.glassReflections && settings.backdropPoster ? media(settings.backdropPoster) : ''} />
          <Surroundings
            image={media(settings.skylineImage)}
            blur={settings.skylineBlur}
            video={video}
            ground={ground}
            groundLight={settings.groundLight}
            fog={fog}
            dim={settings.backdropDim}
            phone={phone}
            onGroundSettled={() => setGroundLoaded(true)}
          />
          {fontsReady && (
            <>
              <Tower stops={stops} labels={labels} top={top} officeSign={officeSign} signs={settings.floorSigns} />
              <Elevator top={top} />
              {groundSettled && (
                <Ready
                  onReady={() => {
                    setShown(true);
                    onReady();
                  }}
                />
              )}
              {shown && <AdaptiveResolution />}
              {onSlow && shown && <SlowGuard onSlow={onSlow} />}
            </>
          )}
          <CameraRig signs={settings.floorSigns} />
          {video && <BackdropFollow frameRef={frameRef} />}
        </Suspense>
      </Canvas>
    </div>
  );
}
