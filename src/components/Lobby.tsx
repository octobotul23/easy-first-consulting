import type { CSSProperties } from 'react';
import type { SiteContent } from '../content';
import { useMediaQuery } from '../hooks/useCapabilities';
import { IN_PREVIEW } from '../lib/preview';
import { goTo, useLift, type LiftMode } from '../state/elevator';

interface Props {
  content: SiteContent;
  mode: LiftMode;
}

const delay = (i: number) => ({ '--i': i }) as CSSProperties;
/** Phones and tablets (a finger, not a mouse). */
const TOUCH = '(hover: none) and (pointer: coarse)';

/** Ground floor: the title over the tower seen from the street. */
export function Lobby({ content, mode }: Props) {
  const visible = useLift((s) => s.heroVisible);
  const { lobby } = content;
  // In the panel's phone preview (a mouse, but a phone-sized page) the phone text is shown too.
  const finger = useMediaQuery(TOUCH);
  const narrow = useMediaQuery('(max-width: 767px)');
  const touch = finger || (narrow && IN_PREVIEW);
  // Scrolling up rides up (3D): "scroll up" on computers, "swipe down" on touch screens.
  const rise = mode === '3d' && content.settings.scrollUp;
  const hint = !rise ? 'scrollHint' : touch ? 'swipeDownHint' : 'scrollUpHint';
  // "Redefining Growth. Powering Opportunities." → one sentence per line, the second one in gradient italic.
  const lines = lobby.title.split(/(?<=[.!?])\s+/).filter(Boolean);

  return (
    <div className={`lobby lobby-${mode} ${visible ? 'is-open' : ''}`}>
      <div className="lobby-inner">
        <p className="reveal eyebrow" style={delay(0)} data-edit="lobby.eyebrow">
          {lobby.eyebrow}
        </p>
        <h1 id="lobby-title" className="hero-title" data-edit="lobby.title">
          {lines.map((line, i) => (
            <span key={i} className={`reveal line line-${i + 1}`} style={delay(i + 1)}>
              {line}
            </span>
          ))}
        </h1>
        <p className="reveal hero-sub" style={delay(lines.length + 1)} data-edit="lobby.subtitle">
          {lobby.subtitle}
        </p>
      </div>
      <a
        href={`#${content.floors.find((f) => f.visible)?.id ?? 'contact'}`}
        className={`scroll-hint reveal${rise && touch ? ' hint-down' : ''}`}
        style={delay(lines.length + 2)}
        onClick={(e) => {
          e.preventDefault();
          goTo(1);
        }}
      >
        <span className="rail" aria-hidden="true" />
        <span data-edit={`lobby.${hint}`}>{lobby[hint]}</span>
      </a>
    </div>
  );
}
