import { useCallback, useEffect, useRef } from 'react';
import { ADMIN_HREF } from '../lib/demo';
import { IN_PREVIEW } from '../lib/preview';

const ADMIN_URL = ADMIN_HREF;

/** Typing "admin" anywhere on the page (outside form fields) opens the admin panel. */
export function useAdminKeyword() {
  useEffect(() => {
    if (IN_PREVIEW) return; // inside the admin panel's preview
    let typed = '';
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      typed = (typed + e.key.toLowerCase()).slice(-5);
      if (typed === 'admin') location.href = ADMIN_URL;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Five taps in a row on the © sign (each within 0.8 s of the last) open the admin panel. */
export function useCopyrightTaps() {
  const taps = useRef<number[]>([]);
  return useCallback(() => {
    const now = Date.now();
    const recent = taps.current.filter((t) => now - t < 800 * 5);
    const last = recent[recent.length - 1];
    taps.current = last && now - last > 800 ? [now] : [...recent, now];
    if (taps.current.length >= 5 && !IN_PREVIEW) location.href = ADMIN_URL;
  }, []);
}
