import type { MouseEvent, ReactNode } from 'react';
import type { SiteContent } from '../content';
import { media } from '../lib/demo';
import { goTo, stopIndex } from '../state/elevator';

interface Props {
  content: SiteContent;
  /** Extra element on the right (the compact floor display in the 2D version). */
  aside?: ReactNode;
}

export function Header({ content, aside }: Props) {
  const { nav, floors, company } = content;
  const firstFloor = floors.find((f) => f.visible)?.id ?? 'contact';
  const about = floors.find((f) => f.id === 'vision-mission' && f.visible)?.id ?? firstFloor;

  const go = (key: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    const i = stopIndex(key);
    if (i < 0) return;
    e.preventDefault();
    goTo(i);
  };

  return (
    <header className="site-header">
      <div className="header-bar">
        <a href="#lobby" className="brand" onClick={go('lobby')}>
          <img src={media(company.logo)} alt={company.brand} width="125" height="33" />
        </a>
        <nav className="site-nav" aria-label="Main">
          <ul>
            <li>
              <a href={`#${firstFloor}`} onClick={go(firstFloor)} data-edit="nav.services">
                {nav.services}
              </a>
            </li>
            <li>
              <a href={`#${about}`} onClick={go(about)} data-edit="nav.about">
                {nav.about}
              </a>
            </li>
            <li>
              <a href="#contact" onClick={go('contact')} data-edit="nav.contact">
                {nav.contact}
              </a>
            </li>
          </ul>
        </nav>
      </div>
      {aside}
    </header>
  );
}
