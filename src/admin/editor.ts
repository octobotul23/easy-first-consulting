import { createContext, useContext } from 'react';
import type { SiteContent } from '../content';
import type { Path } from '../content/rules';

export const keyOf = (path: Path) => path.join('.');

export function getAt(obj: unknown, path: Path): unknown {
  let v = obj;
  for (const p of path) {
    if (v === null || typeof v !== 'object') return undefined;
    v = (v as Record<string | number, unknown>)[p];
  }
  return v;
}

/** A copy of `obj` with one value replaced (nothing else is copied). */
export function setAt<T>(obj: T, path: Path, value: unknown): T {
  if (!path.length) return value as T;
  const [head, ...rest] = path;
  const node = obj as unknown as Record<string | number, unknown>;
  const next = setAt(node[head], rest, value);
  if (Array.isArray(obj)) {
    const copy = obj.slice();
    copy[head as number] = next;
    return copy as T;
  }
  return { ...(obj as object), [head]: next } as T;
}

/** An empty entry shaped like an existing one (for "Add" buttons). */
export function blankLike(v: unknown): unknown {
  if (typeof v === 'string') return '';
  if (Array.isArray(v)) return [];
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blankLike(x)]));
  return v;
}

/** "floors.oil-gas.title" (the data-edit key on the site) → ['floors', 0, 'title']. */
export function pathFromEditKey(key: string, content: SiteContent): Path | null {
  const parts = key.split('.');
  if (!parts[0]) return null;
  const out: Path = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (i === 1 && parts[0] === 'floors') {
      const idx = content.floors.findIndex((f) => f.id === p);
      if (idx < 0) return null;
      out.push(idx);
    } else out.push(/^\d+$/.test(p) ? Number(p) : p);
  }
  return getAt(content, out) === undefined ? null : out;
}

export interface Editor {
  draft: SiteContent;
  set: (path: Path, value: unknown) => void;
  errors: Map<string, string>;
  upload: (file: File) => Promise<string>;
}

export const EditorContext = createContext<Editor | null>(null);

export function useEditor(): Editor {
  const e = useContext(EditorContext);
  if (!e) throw new Error('useEditor outside the panel');
  return e;
}
