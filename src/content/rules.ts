/**
 * What the admin panel may save, checked the same way in the panel (as you type) and
 * on the server (before anything is written). The shape always comes from the defaults:
 * every field must exist there and have the same type. On top of that, the rules below
 * set lengths, formats, allowed links and number ranges.
 *
 * No imports with side effects: the Node server uses this through server/build/entry.js.
 */
import { ITEM_TEMPLATES } from './index';
import type { SiteContent } from './types';

export type Path = (string | number)[];
export interface Issue {
  path: Path;
  message: string;
}

type Kind = 'text' | 'multiline' | 'email' | 'phone' | 'https' | 'image' | 'video' | 'id';
export interface Rule {
  kind?: Kind;
  max?: number;
  required?: boolean;
  range?: [number, number];
  step?: number;
  minItems?: number;
  maxItems?: number;
}

/** Rules by path pattern ("*" = any list position or floor). The most specific match wins. */
const RULES: Record<string, Rule> = {
  // Lobby
  'lobby.eyebrow': { max: 140 },
  'lobby.title': { max: 140, required: true },
  'lobby.subtitle': { kind: 'multiline', max: 600 },
  'lobby.scrollHint': { max: 60 },
  'lobby.scrollUpHint': { max: 60 },
  'lobby.swipeDownHint': { max: 60 },
  // Floors
  'floors.*.id': { kind: 'id' },
  'floors.*.label': { max: 40, required: true },
  'floors.*.kicker': { max: 90 },
  'floors.*.title': { max: 160, required: true },
  'floors.*.intro': { kind: 'multiline', max: 900 },
  'floors.*.facts': { maxItems: 6 },
  'floors.*.facts.*.label': { max: 60, required: true },
  'floors.*.facts.*.items': { maxItems: 12 },
  'floors.*.facts.*.items.*': { max: 120, required: true },
  'floors.*.steps.label': { max: 60 },
  'floors.*.steps.items': { maxItems: 10 },
  'floors.*.steps.items.*': { max: 160, required: true },
  'floors.*.points': { maxItems: 10 },
  'floors.*.points.*': { max: 240, required: true },
  'floors.*.blocks': { maxItems: 6 },
  'floors.*.blocks.*.heading': { max: 80, required: true },
  'floors.*.blocks.*.text': { kind: 'multiline', max: 900 },
  'floors.*.note': { kind: 'multiline', max: 600 },
  // Contact (Office 906)
  'contact.label': { max: 40, required: true },
  'contact.kicker': { max: 90 },
  'contact.title': { max: 160, required: true },
  'contact.intro': { kind: 'multiline', max: 900 },
  'contact.*': { max: 80 },
  'contact.form.*': { max: 300, required: true },
  'contact.form.optional': { max: 40 },
  // Menu and small words
  'nav.*': { max: 30, required: true },
  'common.*': { max: 120, required: true },
  'common.copyright': { max: 200 },
  // Company
  'company.legalName': { max: 120, required: true },
  'company.brand': { max: 60, required: true },
  'company.nameArabic': { max: 120 },
  'company.logo': { kind: 'image', required: true },
  'company.phone': { kind: 'phone', required: true },
  'company.website': { kind: 'https', required: true },
  'company.address': { minItems: 1, maxItems: 6 },
  'company.address.*': { max: 120, required: true },
  'company.mapUrl': { kind: 'https' },
  'company.formEmail': { kind: 'email', required: true },
  'company.formEndpoint': { kind: 'https' },
  'company.people': { maxItems: 8 },
  'company.people.*.id': { kind: 'id' },
  'company.people.*.role': { max: 60, required: true },
  'company.people.*.name': { max: 80, required: true },
  'company.people.*.email': { kind: 'email', required: true },
  'company.people.*.bio': { kind: 'multiline', max: 400 },
  // Settings
  'settings.floorScroll': { range: [0.6, 3], step: 0.1 },
  'settings.backdropSrc': { kind: 'video' },
  'settings.backdropSrcPhone': { kind: 'video' },
  'settings.backdropPoster': { kind: 'image' },
  'settings.backdropDim': { range: [0, 70], step: 5 },
  'settings.sceneBrightness': { range: [0.7, 1.4], step: 0.05 },
  'settings.groundLight': { range: [0.5, 2], step: 0.05 },
  'settings.skylineImage': { kind: 'image' },
  'settings.skylineBlur': { range: [0, 12], step: 1 },
  // SEO of every page
  '*.seo.title': { max: 90, required: true },
  '*.seo.description': { max: 320, required: true },
  'floors.*.seo.title': { max: 90, required: true },
  'floors.*.seo.description': { max: 320, required: true },
};

const pattern = (path: Path) => path.map((p) => (typeof p === 'number' ? '*' : p));

/** The rule for one field (or list) of the content. */
export function ruleFor(path: Path): Rule {
  const parts = pattern(path).map(String);
  let best: Rule | undefined;
  let bestScore = -1;
  for (const [key, rule] of Object.entries(RULES)) {
    const k = key.split('.');
    if (k.length !== parts.length) continue;
    let score = 0;
    let ok = true;
    for (let i = 0; i < k.length; i++) {
      if (k[i] === parts[i]) score += 2;
      else if (k[i] === '*') score += i === 0 ? 0 : 1;
      else {
        ok = false;
        break;
      }
    }
    if (ok && score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }
  return best ?? {};
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
const PHONE = /^\+?[0-9][0-9 ()\-.]{4,24}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SITE_PATH = /^\/(?!\/)[A-Za-z0-9._\-/]{1,200}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function isHttps(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Checks one text value. Returns the cleaned value, or an error message for the visitor of the panel. */
export function checkText(path: Path, raw: string): { value: string; error?: string } {
  const r = ruleFor(path);
  const multiline = r.kind === 'multiline';
  let v = raw.replace(/\r\n?/g, '\n');
  v = multiline ? v.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : v.replace(/\s+/g, ' ').trim();
  if (CONTROL.test(v)) return { value: v, error: 'Contains hidden control characters. Retype the text instead of pasting it.' };
  if (!v) return r.required ? { value: v, error: 'Can’t be empty.' } : { value: v };
  const max = r.max ?? (r.kind === 'https' || r.kind === 'image' || r.kind === 'video' ? 500 : 300);
  if (v.length > max) return { value: v, error: `Too long: ${v.length} characters, at most ${max}. Remove ${v.length - max}.` };
  switch (r.kind) {
    case 'email':
      if (!EMAIL.test(v) || v.length > 120) return { value: v, error: 'Not a valid e-mail address, e.g. name@company.com.' };
      break;
    case 'phone':
      if (!PHONE.test(v)) return { value: v, error: 'Use digits, spaces and an optional + at the start, e.g. +971 50 222 0708.' };
      break;
    case 'https':
      if (v.length > 500 || !isHttps(v)) return { value: v, error: 'Must be a full link starting with https://' };
      break;
    case 'image':
      if (v.length > 500 || (!isHttps(v) && !(SITE_PATH.test(v) && !v.includes('..'))))
        return { value: v, error: 'Use an uploaded image, a file of the site (/name.jpg) or a link starting with https://' };
      break;
    case 'video':
      if (v.length > 500 || (!isHttps(v) && !(SITE_PATH.test(v) && !v.includes('..'))))
        return { value: v, error: 'Use an uploaded video, a file of the site (/media/name.mp4) or a link starting with https://' };
      break;
    case 'id':
      if (!ID.test(v)) return { value: v, error: 'Only small letters, digits and dashes.' };
      break;
  }
  return { value: v };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const hasId = (v: unknown): v is { id: string } => isObj(v) && typeof v.id === 'string';

/**
 * Checks a whole content object against the defaults and returns a complete, cleaned copy.
 * lenient = drop what does not fit instead of reporting it (used when restoring old versions).
 */
export function validateContent(value: unknown, defaults: SiteContent, opts: { lenient?: boolean } = {}) {
  const issues: Issue[] = [];
  const report = (path: Path, message: string) => {
    if (!opts.lenient) issues.push({ path, message });
  };

  function walk(base: unknown, v: unknown, path: Path, key: string): unknown {
    if (v === undefined) return base;
    if (Array.isArray(base)) {
      if (!Array.isArray(v)) {
        report(path, 'Expected a list.');
        return base;
      }
      const rule = ruleFor(path);
      const template = base[0] ?? ITEM_TEMPLATES[key];
      if (template === undefined) return base;
      let list = v;
      if (rule.maxItems !== undefined && list.length > rule.maxItems) {
        report(path, `At most ${rule.maxItems} entries. Remove ${list.length - rule.maxItems}.`);
        list = list.slice(0, rule.maxItems);
      }
      if (hasId(template)) {
        const byId = new Map(base.map((b) => [(b as { id: string }).id, b]));
        const seen = new Set<string>();
        const out: unknown[] = [];
        list.forEach((item, i) => {
          if (!hasId(item)) return report([...path, i], 'Entry without an id.');
          const idCheck = checkText([...path, i, 'id'], item.id);
          if (idCheck.error) return report([...path, i, 'id'], idCheck.error);
          if (seen.has(item.id)) return report([...path, i, 'id'], 'Two entries have the same id.');
          if (key === 'floors' && !byId.has(item.id)) return report([...path, i], 'Unknown floor. Floors can be reordered or hidden, not added.');
          seen.add(item.id);
          out.push(walk(byId.get(item.id) ?? template, item, [...path, i], key));
        });
        if (key === 'floors') {
          for (const b of base) {
            if (!seen.has((b as { id: string }).id)) {
              report(path, `The floor “${(b as { id: string }).id}” is missing.`);
              out.push(b);
            }
          }
        }
        if (rule.minItems !== undefined && out.length < rule.minItems) report(path, `Needs at least ${rule.minItems} entries.`);
        return out;
      }
      const out = list.map((item, i) => walk(template, item, [...path, i], key));
      if (rule.minItems !== undefined && out.length < rule.minItems) report(path, `Needs at least ${rule.minItems} entries.`);
      return out;
    }
    if (isObj(base)) {
      if (!isObj(v)) {
        report(path, 'Expected a group of fields.');
        return base;
      }
      for (const k of Object.keys(v)) if (!(k in base)) report([...path, k], 'Unknown field.');
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(base)) out[k] = walk(base[k], v[k], [...path, k], k);
      return out;
    }
    if (typeof base === 'string') {
      if (typeof v !== 'string') {
        report(path, 'Expected text.');
        return base;
      }
      if (v.length > 5000) {
        report(path, 'Far too long.');
        return base;
      }
      const c = checkText(path, v);
      if (c.error) {
        report(path, c.error);
        return opts.lenient ? base : c.value;
      }
      return c.value;
    }
    if (typeof base === 'number') {
      const r = ruleFor(path);
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        report(path, 'Expected a number.');
        return base;
      }
      if (r.range && (v < r.range[0] || v > r.range[1])) {
        report(path, `Must be between ${r.range[0]} and ${r.range[1]}.`);
        return opts.lenient ? base : v;
      }
      return v;
    }
    if (typeof base === 'boolean') {
      if (typeof v !== 'boolean') {
        report(path, 'Expected on or off.');
        return base;
      }
      return v;
    }
    return base;
  }

  const content = walk(defaults, value, [], '') as SiteContent;
  return { ok: issues.length === 0, issues, content };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Only what differs from the defaults (what is stored). Lists are kept whole once they
 * differ; floors and people keep their order and ids, plus only their changed fields.
 * mergeContent(defaults, diff) gives the full content back.
 */
export function diffContent(base: unknown, value: unknown): unknown {
  if (same(base, value)) return undefined;
  if (Array.isArray(base) && Array.isArray(value)) {
    const byId = new Map(base.filter(hasId).map((b) => [b.id, b]));
    if (value.every(hasId) && (base.length === 0 || base.every(hasId))) {
      return value.map((v) => {
        const b = byId.get(v.id);
        if (!b) return v;
        const d = diffContent(b, v);
        return { ...(isObj(d) ? d : {}), id: v.id };
      });
    }
    return value;
  }
  if (isObj(base) && isObj(value)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(base)) {
      const d = diffContent(base[k], value[k]);
      if (d !== undefined) out[k] = d;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value;
}
