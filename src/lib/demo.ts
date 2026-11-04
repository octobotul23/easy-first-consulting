/**
 * The demo build (`npm run demo`): the site and the admin panel work with no server, for
 * example as a static demo on ILUZ. The panel then keeps every save in this browser only.
 * `__DEMO__` is written into the code at build time (vite.config.ts): in the normal build it is
 * the literal `false`, so every demo branch, and the demo files, are left out of the bundles.
 */
/** Everything the demo keeps, under one prefix (a demo host serves many sites on one origin). */
const NS = 'easyfirst-consulting-demo:';
export const DEMO_KEYS = {
  state: `${NS}state`,
  session: `${NS}session`,
  imagePrefix: `${NS}img:`,
};

type Store = 'local' | 'session';
const area = (s: Store) => (s === 'local' ? localStorage : sessionStorage);

/** Browser storage can be missing or full (private windows, blocked site data): never throw. */
export function storageGet(s: Store, key: string): string | null {
  try {
    return area(s).getItem(key);
  } catch {
    return null;
  }
}
export function storageSet(s: Store, key: string, value: string): boolean {
  try {
    area(s).setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
export function storageRemove(s: Store, key: string) {
  try {
    area(s).removeItem(key);
  } catch {
    /* nothing to remove */
  }
}

/** An image uploaded in the demo panel: a short site-like address, so it passes the same rules. */
export const DEMO_IMAGE = /^\/uploads\/(demo-[a-f0-9]{16})\.(webp|png)$/;

/**
 * An image address as the page should use it. In the demo, uploaded images live in this
 * browser, and the site's own files sit next to the page (the demo may be served from a
 * sub-folder, as on ILUZ). In the normal build the address is used as it is.
 */
export function media(src: string): string {
  if (!__DEMO__ || !src) return src;
  const m = DEMO_IMAGE.exec(src);
  if (m) return storageGet('local', DEMO_KEYS.imagePrefix + m[1]) ?? src;
  return src.startsWith('/') && !src.startsWith('//') ? `.${src}` : src;
}

/** Where the panel, the site and the panel's preview are, seen from each other. */
export const ADMIN_HREF = __DEMO__ ? 'admin.html' : '/admin';
export const SITE_HREF = __DEMO__ ? './' : '/';
export const PREVIEW_SRC = __DEMO__ ? 'index.html?preview' : '/?preview';
