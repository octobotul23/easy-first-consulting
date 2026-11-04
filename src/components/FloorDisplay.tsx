import { useRef } from 'react';
import type { CommonContent } from '../content';
import { useLift } from '../state/elevator';

interface Props {
  /** Label for every level of the building (index = level). */
  labels: string[];
  common: CommonContent;
  variant?: 'full' | 'compact';
}

/** The lift's floor indicator: changing number, direction arrow, floor name. */
export function FloorDisplay({ labels, common, variant = 'full' }: Props) {
  const floor = useLift((s) => s.floor);
  const dir = useLift((s) => s.dir);
  const openStop = useLift((s) => s.openStop);
  const current = useLift((s) => s.current);
  // The number rolls in from below when going up, from above when going down.
  const lastDir = useRef<1 | -1>(1);
  if (dir !== 0) lastDir.current = dir;

  const digit = floor === 0 ? 'G' : String(floor);
  const status = dir === 1 ? common.goingUp : dir === -1 ? common.goingDown : (labels[floor] ?? '');
  const arrived = openStop >= 0 ? labels[floor] : '';

  return (
    <div className={`floor-display fd-${variant}`}>
      <div aria-hidden="true" className="fd-face">
        <svg className={`fd-arrow ${dir === 1 ? 'up' : dir === -1 ? 'down' : ''}`} viewBox="0 0 12 12" width="12" height="12">
          <path d="M6 1.5 11 9H1z" fill="currentColor" />
        </svg>
        <span className="fd-digit-wrap">
          <span key={`${digit}-${current}`} className={`fd-digit ${lastDir.current === -1 ? 'from-top' : ''}`}>
            {digit}
          </span>
        </span>
        {variant === 'full' && <span className="fd-label">{status}</span>}
      </div>
      {/* Screen readers hear the floor once the lift has arrived, not every floor passed. */}
      <p className="sr-only" aria-live="polite">
        {arrived ? `${floor === 0 ? common.lobbyLabel : `${common.floorWord} ${floor}`}: ${arrived}` : ''}
      </p>
    </div>
  );
}
