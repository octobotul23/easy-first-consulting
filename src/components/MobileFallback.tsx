import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { CommonContent, SceneSettings, Stop } from '../content';
import { media } from '../lib/demo';
import { drawSkyline, loadSkylineImage } from '../lib/skyline';
import { goTo, lift, onLiftFrame, useLift } from '../state/elevator';

interface Props {
  stops: Stop[];
  /** Level of the top stop (Office 902): the height of the shaft. */
  top: number;
  common: CommonContent;
  settings: SceneSettings;
}

/** Height of the cabin drawing in px; must match --cab-h in the CSS. */
const CAB_H = { small: 30, large: 38 };

/**
 * The 2D version of the lift (phones, reduced motion, no WebGL):
 * a sunset sky with the skyline behind the page, and a glass shaft in the left margin
 * whose cabin rides up as the visitor scrolls. Each floor number is a button.
 */
export function MobileFallback({ stops, top, common, settings }: Props) {
  return (
    <>
      <FlowSky image={media(settings.skylineImage)} blur={settings.skylineBlur} />
      <Shaft stops={stops} top={top} common={common} />
    </>
  );
}

/** Fixed backdrop: sky gradient (CSS) and the same skyline drawing the 3D scene uses. */
function FlowSky({ image, blur }: { image: string; blur: number }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let alive = true;
    let made = '';
    const toUrl = (c: HTMLCanvasElement) =>
      c.toBlob((b) => {
        if (!alive || !b) return;
        made = URL.createObjectURL(b);
        setUrl(made);
      });
    // Drawn after the first paint, so it never delays the text.
    const t = setTimeout(() => {
      if (image) loadSkylineImage(image, blur).then((c) => alive && toUrl(c ?? drawSkyline(blur)));
      else toUrl(drawSkyline(blur));
    }, 60);
    return () => {
      alive = false;
      clearTimeout(t);
      if (made) URL.revokeObjectURL(made);
    };
  }, [image, blur]);

  return (
    <div className="flow-sky" aria-hidden="true">
      <div className="flow-skyline" style={url ? { backgroundImage: `url(${url})` } : undefined} />
    </div>
  );
}

function Shaft({ stops, top, common }: { stops: Stop[]; top: number; common: CommonContent }) {
  const current = useLift((s) => s.current);
  const track = useRef<HTMLDivElement>(null);
  const cabin = useRef<HTMLDivElement>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // The cabin follows the lift's level on every frame, straight in the DOM (no re-render).
  useEffect(() => {
    const t = track.current;
    const c = cabin.current;
    if (!t || !c) return;
    let travel = 0;
    const measure = () => {
      const cab = window.matchMedia('(min-width: 768px)').matches ? CAB_H.large : CAB_H.small;
      travel = Math.max(0, t.clientHeight - cab);
      draw();
    };
    const draw = () => {
      const f = top > 0 ? Math.min(1, Math.max(0, lift.level / top)) : 0;
      c.style.transform = `translate3d(0, ${(-f * travel).toFixed(1)}px, 0)`;
      c.classList.toggle('is-open', lift.door > 0.5);
      c.classList.toggle('is-moving', lift.dir !== 0);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(t);
    measure();
    const off = onLiftFrame(draw);
    return () => {
      ro.disconnect();
      off();
    };
  }, [top]);

  // Top floor first in the reading order, like a real lift panel.
  const ordered = stops.map((s, index) => ({ ...s, index })).reverse();
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, k: number) => {
    const last = ordered.length - 1;
    const to =
      e.key === 'ArrowUp' ? k - 1 : e.key === 'ArrowDown' ? k + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
    if (to === null) return;
    e.preventDefault();
    refs.current[Math.max(0, Math.min(last, to))]?.focus();
  };

  return (
    <nav className="shaft" aria-label={common.liftPanel}>
      <div className="shaft-track" ref={track}>
        {/* One slab line per level, including floors the lift skips */}
        <div className="shaft-slabs" aria-hidden="true">
          {Array.from({ length: top + 1 }, (_, l) => (
            <span key={l} style={{ '--f': top ? l / top : 0 } as CSSProperties} />
          ))}
        </div>
        <div className="shaft-cabin" ref={cabin} aria-hidden="true">
          <span className="cab-door cab-l" />
          <span className="cab-door cab-r" />
        </div>
        <ul className="shaft-stops">
          {ordered.map((s, k) => {
            const name = s.level === 0 ? common.lobbyLabel : `${common.floorWord} ${s.level}`;
            return (
              <li key={s.key} style={{ '--f': top ? s.level / top : 0 } as CSSProperties}>
                <button
                  ref={(el) => {
                    refs.current[k] = el;
                  }}
                  type="button"
                  className="shaft-stop"
                  aria-label={s.label && s.label !== name ? `${name}: ${s.label}` : name}
                  aria-current={current === s.index ? 'location' : undefined}
                  onClick={() => goTo(s.index)}
                  onKeyDown={(e) => onKey(e, k)}
                >
                  <span aria-hidden="true">{s.level === 0 ? 'G' : s.level}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
