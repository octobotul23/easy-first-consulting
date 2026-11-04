import { useEffect, useState } from 'react';
import { defaultContent, mergeContent, readInjectedContent, type SiteContent } from '../content';
import { DEMO_KEYS } from '../lib/demo';
import { readDemoContent } from '../lib/demo-content';
import { IN_PREVIEW, postToPanel } from '../lib/preview';

/**
 * The site's content: defaults from the data files, with the changes saved in the
 * admin panel applied on top. The Node server puts the saved changes into the page
 * itself; on static hosting there are none and the defaults are used. In the demo
 * build, the changes come from the demo panel, kept in this browser.
 */
export function useSiteContent(): SiteContent {
  const [content, setContent] = useState<SiteContent>(() =>
    mergeContent(defaultContent, __DEMO__ && !IN_PREVIEW ? readDemoContent() : readInjectedContent()),
  );

  useEffect(() => {
    // Admin preview: the panel sends unsaved changes to the page shown in its frame.
    if (IN_PREVIEW) {
      const onMessage = (e: MessageEvent) => {
        if (e.origin !== location.origin || e.data?.type !== 'easyfirst:preview') return;
        setContent(mergeContent(defaultContent, e.data.content));
      };
      window.addEventListener('message', onMessage);
      postToPanel({ type: 'easyfirst:preview-ready' });
      return () => window.removeEventListener('message', onMessage);
    }
    // Demo: a save in the panel (another tab) shows up here at once.
    if (__DEMO__) {
      const onStorage = (e: StorageEvent) => {
        if (e.key === DEMO_KEYS.state) setContent(mergeContent(defaultContent, readDemoContent()));
      };
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    }
    // Development (npm run dev): ask the Node server directly, if it is running.
    if (import.meta.env.DEV && !document.getElementById('site-content')) {
      fetch('/api/content')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d?.content && setContent(mergeContent(defaultContent, d.content)))
        .catch(() => {});
    }
  }, []);

  return content;
}
