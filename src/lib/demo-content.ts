/**
 * Demo build only: the changes saved in the demo panel, read from this browser and checked
 * again with the panel's rules (browser storage can be edited by hand). Kept apart from
 * demo.ts so the rules never end up in the public site's bundle in the normal build.
 */
import { defaultContent, mergeContent } from '../content';
import { validateContent } from '../content/rules';
import { DEMO_KEYS, storageGet } from './demo';

export function readDemoContent(): unknown {
  const raw = storageGet('local', DEMO_KEYS.state);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw)?.current?.content;
    if (!saved) return null;
    return validateContent(mergeContent(defaultContent, saved), defaultContent, { lenient: true }).content;
  } catch {
    return null;
  }
}
