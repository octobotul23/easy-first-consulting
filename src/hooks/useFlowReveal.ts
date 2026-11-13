import { useEffect, useState, type RefObject } from 'react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/** In the 2D version: becomes true once the element scrolls into view (then stays true). */
export function useFlowReveal(ref: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) {
      setSeen(true);
      return;
    }
    const st = ScrollTrigger.create({ trigger: el, start: 'top 88%', once: true, onEnter: () => setSeen(true) });
    return () => st.kill();
  }, [enabled, ref]);
  return seen;
}
