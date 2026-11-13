import * as THREE from 'three';

/**
 * Materials shared by the tower and the lift: architectural glass, light-only glows and
 * over-bright ("HDR") colours for light sources.
 */

/** A light colour made brighter than white; the tone mapping (Neutral) rolls it off to a warm white core. */
export const hdr = (c: THREE.ColorRepresentation, k: number) => new THREE.Color(c).multiplyScalar(k);

export interface GlassLook {
  tint: THREE.ColorRepresentation;
  /** How much of the glass itself shows when looked at straight on (0 – 1). */
  body: number;
  /** How much more it covers at glancing angles (Fresnel): side walls read as mirrors. */
  edge: number;
  /** Strength of the reflections. */
  reflect: number;
  roughness?: number;
}

/**
 * Glass whose reflection is added on top of what is behind it, not dimmed with its transparency
 * (three's plain transparent material multiplies the reflection by the opacity, so 15 % glass also
 * reflects only 15 %: the facade looked like an open shelf). The output is premultiplied, so where
 * nothing is behind the glass the canvas stays partly transparent and the video shows through.
 * Thin boxes, front faces only: each pane is drawn once.
 */
export function glassMaterial({ tint, body, edge, reflect, roughness = 0.05 }: GlassLook) {
  const m = new THREE.MeshStandardMaterial({
    color: tint,
    metalness: 0,
    roughness,
    envMapIntensity: reflect,
    transparent: true,
    opacity: body,
    premultipliedAlpha: true,
    depthWrite: false,
    side: THREE.FrontSide,
    dithering: true,
  });
  m.onBeforeCompile = (s) => {
    s.uniforms.uEdge = { value: edge };
    s.fragmentShader = s.fragmentShader.replace('void main() {', 'uniform float uEdge;\nvoid main() {').replace(
      '#include <opaque_fragment>',
      /* glsl */ `
        float nv = saturate( dot( geometryNormal, geometryViewDir ) );
        float cover = clamp( diffuseColor.a + ( 1.0 - diffuseColor.a ) * uEdge * pow( 1.0 - nv, 5.0 ), 0.0, 1.0 );
        vec3 premul = totalDiffuse * diffuseColor.a + totalSpecular + totalEmissiveRadiance;
        // Straight colour here: tone mapping and fog act on it, then premultiplied_alpha_fragment multiplies by cover.
        gl_FragColor = vec4( premul / max( cover, 1e-3 ), cover );
      `,
    );
    if (import.meta.env.DEV && !s.fragmentShader.includes('uEdge * pow')) console.warn('glass: the shader patch did not apply');
  };
  m.customProgramCacheKey = () => `iris-glass-${edge}`;
  return m;
}

/**
 * A glow that only adds light: it never changes the canvas's alpha. With three's AdditiveBlending a glow
 * also writes its own alpha, and over the transparent canvas that darkens the video behind it.
 */
export function additive(map: THREE.Texture, color: THREE.ColorRepresentation = '#fff', opacity = 1) {
  return new THREE.MeshBasicMaterial({
    map,
    color,
    opacity,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    dithering: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
}
