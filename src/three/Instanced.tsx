import { useLayoutEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';

export type V3 = [number, number, number];
/** One box or plane: position, size, optional rotation (Euler, radians). */
export interface Item {
  p: V3;
  s: V3;
  r?: V3;
}

export const BOX = new THREE.BoxGeometry(1, 1, 1);
export const PLANE = new THREE.PlaneGeometry(1, 1);

/** One instanced mesh for many boxes/planes that share a material (a few draw calls for the whole facade). */
export function Instanced({
  items,
  geometry = BOX,
  material,
  colors,
  meshRef,
  renderOrder,
}: {
  items: Item[];
  geometry?: THREE.BufferGeometry;
  material: THREE.Material;
  colors?: THREE.Color[];
  meshRef?: RefObject<THREE.InstancedMesh | null>;
  renderOrder?: number;
}) {
  const local = useRef<THREE.InstancedMesh>(null);
  const ref = meshRef ?? local;
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    items.forEach((it, i) => {
      q.setFromEuler(e.set(...(it.r ?? [0, 0, 0])));
      mesh.setMatrixAt(i, m.compose(p.set(...it.p), q, s.set(...it.s)));
      if (colors) mesh.setColorAt(i, colors[i]);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items, colors, ref]);
  if (!items.length) return null;
  return <instancedMesh key={items.length} ref={ref} args={[geometry, material, items.length]} renderOrder={renderOrder} />;
}
