import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SiteContent } from '../content';
import { PREVIEW_SRC } from '../lib/demo';

interface Props {
  draft: SiteContent;
  /** Part of the site to show: "lobby", a floor id or "contact". */
  focus: string | null;
  onPick: (editKey: string) => void;
}

const WIDTH = { phone: 390, computer: 1366 } as const;
type Device = keyof typeof WIDTH;

/**
 * The real site in a frame, with the unsaved changes sent to it. Clicking a text in it
 * opens the field that changes that text.
 */
export function Preview({ draft, focus, onPick }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const ready = useRef(false);
  const latest = useRef({ draft, focus, onPick });
  latest.current = { draft, focus, onPick };
  const [device, setDevice] = useState<Device>('phone');
  const [size, setSize] = useState({ w: 400, h: 700 });

  const post = (data: unknown) => frame.current?.contentWindow?.postMessage(data, location.origin);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return;
      if (e.data?.type === 'easyfirst:preview-ready') {
        ready.current = true;
        post({ type: 'easyfirst:preview', content: latest.current.draft });
        if (latest.current.focus) setTimeout(() => post({ type: 'easyfirst:goto', key: latest.current.focus }), 300);
      } else if (e.data?.type === 'easyfirst:pick' && typeof e.data.key === 'string') {
        latest.current.onPick(e.data.key);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Changes reach the preview a moment after typing stops.
  useEffect(() => {
    if (!ready.current) return;
    const t = setTimeout(() => post({ type: 'easyfirst:preview', content: draft }), 180);
    return () => clearTimeout(t);
  }, [draft]);

  useEffect(() => {
    if (ready.current && focus) {
      // After the new content has been applied (the floor may have just been shown or moved).
      const t = setTimeout(() => post({ type: 'easyfirst:goto', key: focus }), 260);
      return () => clearTimeout(t);
    }
  }, [focus]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const width = WIDTH[device];
  const scale = Math.min(1, size.w / width);

  return (
    <div className="preview">
      <div className="preview-bar">
        <span className="preview-title">Preview</span>
        <div className="seg" role="group" aria-label="Preview size">
          {(Object.keys(WIDTH) as Device[]).map((d) => (
            <button key={d} type="button" aria-pressed={device === d} onClick={() => setDevice(d)}>
              {d === 'phone' ? 'Phone' : 'Computer'}
            </button>
          ))}
        </div>
      </div>
      <p className="preview-hint">Shows your unsaved changes. Click a text to edit it.</p>
      <div className="preview-box" ref={box}>
        <iframe
          ref={frame}
          src={PREVIEW_SRC}
          title="Preview of the site with your unsaved changes"
          style={{
            width,
            height: size.h / scale,
            transform: `scale(${scale})`,
            left: Math.max(0, (size.w - width * scale) / 2),
          }}
        />
      </div>
    </div>
  );
}
