import { Fragment } from 'react';
import { CONTACT_KEY, LOBBY_KEY, type SiteContent, type Stop } from '../content';
import { goTo, lift, type LiftMode } from '../state/elevator';
import { ContactFloor } from './ContactFloor';
import { FloorPanel } from './FloorPanel';
import { Lobby } from './Lobby';

interface Props {
  content: SiteContent;
  stops: Stop[];
  mode: LiftMode;
}

/**
 * All stops as real <section>s, in order. In 3D mode each section is taller than the
 * screen and its panel is sticky: the extra height is how long the lift waits there.
 */
export function Building({ content, stops, mode }: Props) {
  const is3d = mode === '3d';
  const floorVh = 100 + Math.max(0.6, Math.min(3, content.settings.floorScroll)) * 100;

  return (
    <>
      {stops.map((stop, i) => {
        const isLobby = stop.key === LOBBY_KEY;
        const isContact = stop.key === CONTACT_KEY;
        const floor = content.floors.find((f) => f.id === stop.key);
        const heightVh = isLobby ? 160 : isContact ? 190 : floorVh;

        const inner = isLobby ? (
          <Lobby content={content} mode={mode} />
        ) : isContact ? (
          <ContactFloor content={content} index={i} level={stop.level} mode={mode} />
        ) : floor ? (
          <FloorPanel floor={floor} level={stop.level} index={i} mode={mode} common={content.common} />
        ) : null;

        return (
          <Fragment key={stop.key}>
            {/* Extra scroll for the opening flight from the street into the lift. */}
            {is3d && i === 1 && <div aria-hidden="true" style={{ height: '90vh' }} />}
            <section
              id={stop.key}
              data-level={stop.level}
              aria-labelledby={`${stop.key}-title`}
              className={is3d ? 'stop-3d' : `stop-flow ${isLobby ? 'stop-lobby' : ''} ${isContact ? 'stop-contact' : ''}`}
              style={is3d ? { height: `${heightVh}vh` } : undefined}
              // Keyboard users tabbing into a floor that is not open get taken there.
              onFocusCapture={is3d ? () => lift.openStop !== i && goTo(i) : undefined}
            >
              {is3d ? <div className="stop-sticky">{inner}</div> : inner}
            </section>
          </Fragment>
        );
      })}
    </>
  );
}
