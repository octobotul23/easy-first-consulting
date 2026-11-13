import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { drawSkyline, loadSkylineImage } from '../lib/skyline';
import { Ground as BakedGround } from './Ground';

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 cTop; uniform vec3 cMid; uniform vec3 cLow; uniform vec3 cHorizon;
  uniform vec3 cGround; uniform vec3 cSun; uniform vec3 sunDir;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(cHorizon, cLow, smoothstep(0.0, 0.07, h));
    col = mix(col, cMid, smoothstep(0.06, 0.3, h));
    col = mix(col, cTop, smoothstep(0.28, 0.85, h));
    col = mix(cGround, col, smoothstep(-0.012, 0.004, h));
    float s = max(dot(d, normalize(sunDir)), 0.0);
    col += cSun * (pow(s, 6.0) * 0.2 + pow(s, 60.0) * 0.4) * smoothstep(-0.08, 0.06, h);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Dubai sunset: deep plum overhead, magenta, then orange at the horizon. */
export function Sky() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        toneMapped: false,
        uniforms: {
          cTop: { value: new THREE.Color('#150920') },
          cMid: { value: new THREE.Color('#45194f') },
          cLow: { value: new THREE.Color('#8e2763') },
          cHorizon: { value: new THREE.Color('#e46a4c') },
          cGround: { value: new THREE.Color('#1c0d18') },
          cSun: { value: new THREE.Color('#ff9466') },
          sunDir: { value: new THREE.Vector3(-0.35, 0.03, -1) },
        },
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh material={material} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[600, 48, 24]} />
    </mesh>
  );
}

const RING_R = 170;
const RING_H = 62;
/**
 * With the ground on, the ring stands beyond the canal (the quay is 215 m behind the tower), at about 400 m,
 * scaled up so it covers the same part of the view. Out there the scene's fog would hide it completely, so
 * it carries the same share of haze it had at 170 m instead.
 */
const FAR_RING_SCALE = 2.35;
const FAR_HAZE = 0.7;

function hazed(m: THREE.MeshBasicMaterial | null, fog: string) {
  if (!m) return;
  const color = new THREE.Color(fog);
  const o = { r: 0, g: 0, b: 0 };
  color.getRGB(o, THREE.SRGBColorSpace);
  m.fog = false;
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <fog_fragment>',
      `gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( ${o.r.toFixed(4)}, ${o.g.toFixed(4)}, ${o.b.toFixed(4)} ), ${FAR_HAZE.toFixed(2)} );`,
    );
  };
  m.customProgramCacheKey = () => `iris-ring-haze-${fog}`;
  m.needsUpdate = true;
}

/** The blurred skyline as a ring around the scene, plus its reflection in the water. */
function Skyline({ image, blur, far, fog }: { image: string; blur: number; far: boolean; fog: string }) {
  const invalidate = useThree((s) => s.invalidate);
  const [source, setSource] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let alive = true;
    const drawn = () => drawSkyline(blur);
    if (image) {
      loadSkylineImage(image, blur).then((c) => alive && setSource(c ?? drawn()));
    } else {
      setSource(drawn());
    }
    return () => {
      alive = false;
    };
  }, [image, blur]);

  const texture = useMemo(() => {
    if (!source) return null;
    const t = new THREE.CanvasTexture(source);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(image ? 2 : 3, 1);
    return t;
  }, [source, image]);

  useEffect(() => {
    invalidate();
    return () => texture?.dispose();
  }, [texture, invalidate]);

  if (!texture) return null;
  const k = far ? FAR_RING_SCALE : 1;
  const haze = far ? (m: THREE.MeshBasicMaterial | null) => hazed(m, fog) : undefined;
  return (
    <group scale={k} key={far ? 'far' : 'near'}>
      <mesh position={[0, RING_H / 2 - 1.2, 0]} renderOrder={-9}>
        <cylinderGeometry args={[RING_R, RING_R, RING_H, 128, 1, true]} />
        <meshBasicMaterial ref={haze} map={texture} transparent side={THREE.BackSide} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* The same strip upside down and dimmed: city lights reflected in the water. */}
      <mesh position={[0, -RING_H / 2 - 1.2, 0]} scale={[1, -1, 1]} renderOrder={-9}>
        <cylinderGeometry args={[RING_R, RING_R, RING_H, 128, 1, true]} />
        <meshBasicMaterial
          ref={haze}
          map={texture}
          transparent
          opacity={0.38}
          color="#d58aa8"
          side={THREE.FrontSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/**
 * Plaza around the tower (the street camera stands on it). Beyond its edge there is only the
 * dark sky below the horizon and the mirrored skyline: it reads as the water of Business Bay.
 */
function Ground() {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]}>
        <circleGeometry args={[92, 96]} />
        <meshStandardMaterial color="#120a0f" roughness={0.5} metalness={0.25} envMapIntensity={0.2} />
      </mesh>
    </group>
  );
}

/** Radius (scene units) where the podium under the tower starts to fade, and where it is gone. */
const PODIUM_SOLID = 15;
const PODIUM_GONE = 34;

/**
 * With the video behind the tower: a dark polished podium around its foot that fades out, so the
 * water and the far shore of the video show beyond it, as at the edge of the Business Bay canal.
 */
function Podium() {
  const alpha = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    if (g) {
      const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      grad.addColorStop(0, '#fff');
      grad.addColorStop(PODIUM_SOLID / PODIUM_GONE, '#fff');
      grad.addColorStop(1, '#000');
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 256);
    }
    return new THREE.CanvasTexture(c);
  }, []);
  useEffect(() => () => alpha.dispose(), [alpha]);
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]} renderOrder={-1}>
      <circleGeometry args={[PODIUM_GONE, 96]} />
      {/* Matt dark stone: a glossy floor mirrors the orange light panels of the reflections as one flat sheet. */}
      <meshStandardMaterial
        color="#0e080c"
        roughness={0.82}
        metalness={0.05}
        envMapIntensity={0.1}
        alphaMap={alpha}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}

interface SurroundingsProps {
  image: string;
  blur: number;
  video?: boolean;
  /** The baked ground (plaza, road, palms, park, quay) instead of the plain dark floor. */
  ground?: boolean;
  groundLight?: number;
  /** The scene's fog colour. */
  fog: string;
  /** The video's dim setting (0 – 70 %): the baked ground's haze darkens with it. */
  dim?: number;
  /** The phone layout: the baked ground draws with its lighter shader. */
  phone?: boolean;
  /** Called once the baked ground has loaded or failed. Never called without the ground (nothing to wait for). */
  onGroundSettled?: () => void;
}

export function Surroundings({
  image,
  blur,
  video = false,
  ground = false,
  groundLight = 1,
  fog,
  dim = 0,
  phone = false,
  onGroundSettled,
}: SurroundingsProps) {
  const floor = ground ? (
    <BakedGround light={groundLight} fog={fog} video={video} dim={dim} phone={phone} onSettled={onGroundSettled} />
  ) : video ? (
    <Podium />
  ) : (
    <Ground />
  );
  if (video) return floor;
  return (
    <>
      <Sky />
      <Skyline image={image} blur={blur} far={ground} fog={fog} />
      {floor}
    </>
  );
}
