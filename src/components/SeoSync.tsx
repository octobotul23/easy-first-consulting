import { useEffect } from 'react';
import { CONTACT_KEY, LOBBY_KEY, type SiteContent, type Stop } from '../content';
import { setMeta } from '../lib/boot';
import { useLift } from '../state/elevator';

/** Title, description and #address follow the floor the visitor is on. */
export function SeoSync({ content, stops }: { content: SiteContent; stops: Stop[] }) {
  const openStop = useLift((s) => s.openStop);

  useEffect(() => {
    if (openStop < 0) return;
    const key = stops[openStop]?.key;
    if (!key) return;
    const seo =
      key === LOBBY_KEY
        ? content.lobby.seo
        : key === CONTACT_KEY
          ? content.contact.seo
          : (content.floors.find((f) => f.id === key)?.seo ?? content.lobby.seo);
    document.title = seo.title;
    setMeta('meta[name="description"]', 'content', seo.description);
    setMeta('meta[property="og:title"]', 'content', seo.title);
    setMeta('meta[property="og:description"]', 'content', seo.description);
    const url = key === LOBBY_KEY ? location.pathname + location.search : `#${key}`;
    if ((key === LOBBY_KEY ? '' : `#${key}`) !== location.hash) history.replaceState(null, '', url);
  }, [openStop, stops, content]);

  return null;
}
