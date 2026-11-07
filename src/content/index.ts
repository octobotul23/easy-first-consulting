import { company } from '../config/company.ts';
import { scene } from '../config/scene.ts';
import { common, contact, floors, lobby, nav } from './floors.ts';
import type { SiteContent, Stop } from './types.ts';

export type * from './types.ts';

export const defaultContent: SiteContent = {
  lobby,
  floors,
  contact,
  nav,
  common,
  company,
  settings: scene,
};

/** The building always has a lobby (0), one level per floor entry, and the contact office on top. */
export const CONTACT_KEY = 'contact';
export const LOBBY_KEY = 'lobby';

export function contactLevel(content: SiteContent): number {
  return content.floors.length + 1;
}

/** Where the lift stops, bottom to top. Hidden floors keep their level but get no stop. */
export function buildStops(content: SiteContent): Stop[] {
  const stops: Stop[] = [{ key: LOBBY_KEY, level: 0, label: content.common.lobbyLabel }];
  content.floors.forEach((f, i) => {
    if (f.visible) stops.push({ key: f.id, level: i + 1, label: f.label });
  });
  stops.push({ key: CONTACT_KEY, level: contactLevel(content), label: content.contact.label });
  return stops;
}

/** Label for every level of the building, including floors the lift skips. */
export function levelLabels(content: SiteContent): string[] {
  return [content.common.lobbyLabel, ...content.floors.map((f) => f.label), content.contact.label];
}

/* ---------- Saved changes on top of the defaults ---------- */

type Json = unknown;
const isObj = (v: Json): v is Record<string, Json> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Blank items used when the admin adds an entry to a list that is empty by default. */
export const ITEM_TEMPLATES: Record<string, Json> = {
  facts: { label: '', items: [] },
  blocks: { heading: '', text: '' },
  people: { id: '', role: '', name: '', email: '', bio: '' },
  items: '',
  points: '',
  address: '',
};

/**
 * Applies saved changes over the defaults. Only keys that exist in the defaults are read,
 * and each value must have the same type as its default, so a damaged or old save
 * can never break the page — it just falls back to the default for that field.
 */
export function mergeContent<T>(base: T, over: Json, key = ''): T {
  if (over === undefined || over === null) return base;
  if (Array.isArray(base)) {
    if (!Array.isArray(over)) return base;
    const template = base[0] ?? ITEM_TEMPLATES[key];
    if (template === undefined) return base;
    if (isObj(template) && 'id' in template) {
      // Lists of things with an id (floors, people): keep the saved order, match by id.
      const byId = new Map(base.map((b) => [(b as { id: string }).id, b]));
      const out = over
        .filter((o): o is Record<string, Json> => isObj(o) && typeof o.id === 'string' && o.id !== '')
        .map((o) => mergeContent(byId.get(o.id as string) ?? template, o, key));
      if (key === 'floors') {
        // Floors are the building itself: never lose one, even if a save is missing it.
        for (const b of base) if (!out.some((o) => (o as { id: string }).id === (b as { id: string }).id)) out.push(b);
      }
      return out as T;
    }
    return over.map((o) => mergeContent(template, o, key)).filter((v) => v !== undefined) as T;
  }
  if (isObj(base)) {
    if (!isObj(over)) return base;
    const out: Record<string, Json> = { ...base };
    for (const k of Object.keys(base)) if (k in over) out[k] = mergeContent(base[k], over[k], k);
    return out as T;
  }
  if (typeof over !== typeof base) return base;
  if (typeof over === 'number' && !Number.isFinite(over)) return base;
  return over as T;
}

/** Saved content injected by the Node server into index.html (absent on static hosting). */
export function readInjectedContent(): Json {
  const el = typeof document !== 'undefined' ? document.getElementById('site-content') : null;
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent);
  } catch {
    return null;
  }
}
