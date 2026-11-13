import { useEffect, useState } from 'react';

export interface Capabilities {
  webgl: boolean;
  small: boolean;
  reduced: boolean;
  /** ?mode=flow or ?mode=3d in the address forces a version (handy for testing). */
  forced: 'flow' | '3d' | null;
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const SMALL = '(max-width: 767px)';
const REDUCED = '(prefers-reduced-motion: reduce)';

function detect(webgl: boolean): Capabilities {
  const q = new URLSearchParams(location.search).get('mode');
  return {
    webgl,
    small: matchMedia(SMALL).matches,
    reduced: matchMedia(REDUCED).matches,
    forced: q === 'flow' || q === '3d' ? q : null,
  };
}

export function useCapabilities() {
  const [caps, setCaps] = useState<Capabilities>(() => detect(hasWebGL()));
  useEffect(() => {
    const queries = [matchMedia(SMALL), matchMedia(REDUCED)];
    const update = () => setCaps((c) => detect(c.webgl));
    queries.forEach((q) => q.addEventListener('change', update));
    return () => queries.forEach((q) => q.removeEventListener('change', update));
  }, []);
  return caps;
}

/** The phone layout of the 3D version (card at the bottom, one row of buttons). index.css uses the same query. */
export const PHONE_LAYOUT = '(max-width: 767px) and (orientation: portrait)';

/** True while the media query matches; follows resizing and turning the phone. */
export function useMediaQuery(query: string): boolean {
  const [on, setOn] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const q = matchMedia(query);
    const update = () => setOn(q.matches);
    update();
    q.addEventListener('change', update);
    return () => q.removeEventListener('change', update);
  }, [query]);
  return on;
}

/**
 * The full 3D tower when the device can draw it and the visitor did not ask for reduced motion;
 * on phones only while the panel's "on phones too" switch is on.
 */
export function wants3D(caps: Capabilities, enabled: boolean, onPhones: boolean): boolean {
  if (!caps.webgl) return false;
  if (caps.forced) return caps.forced === '3d';
  return enabled && (onPhones || !caps.small) && !caps.reduced;
}
