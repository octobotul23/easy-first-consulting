import { useRef, type KeyboardEvent } from 'react';
import type { CommonContent, Stop } from '../content';
import { goTo, useLift } from '../state/elevator';

interface Props {
  stops: Stop[];
  common: CommonContent;
}

/** The lift's button panel (9 at the top … G at the bottom). The current floor is lit. */
export function ElevatorButtons({ stops, common }: Props) {
  const current = useLift((s) => s.current);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // Top floor first, like a real lift panel.
  const ordered = stops.map((s, index) => ({ ...s, index })).reverse();

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, k: number) => {
    const last = ordered.length - 1;
    // Up/right = higher floor (on phones the panel is one row, G on the left).
    const up = e.key === 'ArrowUp' || e.key === 'ArrowRight';
    const down = e.key === 'ArrowDown' || e.key === 'ArrowLeft';
    const to = up ? k - 1 : down ? k + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
    if (to === null) return;
    e.preventDefault();
    refs.current[Math.max(0, Math.min(last, to))]?.focus();
  };

  return (
    <nav className="lift-panel" aria-label={common.liftPanel}>
      <p className="lift-panel-title" aria-hidden="true">
        {common.liftPanel}
      </p>
      <ul>
        {ordered.map((s, k) => {
          const name = s.level === 0 ? common.lobbyLabel : `${common.floorWord} ${s.level}`;
          return (
            <li key={s.key}>
              <button
                ref={(el) => {
                  refs.current[k] = el;
                }}
                type="button"
                className="lift-btn"
                aria-label={s.label && s.label !== name ? `${name}: ${s.label}` : name}
                aria-current={current === s.index ? 'location' : undefined}
                onClick={() => goTo(s.index)}
                onKeyDown={(e) => onKey(e, k)}
              >
                <span aria-hidden="true">{s.level === 0 ? 'G' : s.level}</span>
                <span className="lift-tip" aria-hidden="true">
                  {s.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
