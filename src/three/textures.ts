import * as THREE from 'three';

const SANS = '"Inter Variable", Inter, "Segoe UI", system-ui, sans-serif';
const SERIF = '"Cormorant Garamond", Georgia, serif';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Vertical gradient (top → bottom), used for the warm lit walls inside the floors. */
export function gradientTexture(stops: [number, string][], h = 256) {
  const c = canvas(4, h);
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 0, h);
  stops.forEach(([o, col]) => gr.addColorStop(o, col));
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, h);
  return toTexture(c);
}

/** Round soft spot, for glows and halos. */
export function glowTexture() {
  const c = canvas(128, 128);
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,.35)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return toTexture(c);
}

/** Soft horizontal bar of light (bright centre line fading up and down), for neon halos. */
export function lineGlowTexture() {
  const c = canvas(8, 64);
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.5, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 8, 64);
  return toTexture(c);
}

/** Splits a long floor name over two lines, like the signs in the reference. */
export function splitLabel(text: string, max = 15): string[] {
  const t = text.trim().toUpperCase();
  if (t.length <= max || !t.includes(' ')) return [t];
  const mid = t.length / 2;
  let best = -1;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  }
  return [t.slice(0, best), t.slice(best + 1)];
}

/** A glowing text sign on the glass. Returns the texture and its width/height ratio. */
export function signTexture(lines: string[], opts: { size?: number; align?: CanvasTextAlign; plate?: boolean } = {}) {
  const size = opts.size ?? 76;
  const lineH = size * 1.18;
  const W = 1024;
  // With a plate, more room above and below so its soft edge fades out inside the picture.
  const m = size * (opts.plate ? 0.65 : 0.35);
  const H = Math.ceil(lines.length * lineH + m * 2);
  const c = canvas(W, H);
  const g = c.getContext('2d')!;
  g.font = `500 ${size}px ${SANS}`;
  if ('letterSpacing' in g) (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${size * 0.04}px`;
  g.textAlign = opts.align ?? 'left';
  g.textBaseline = 'middle';
  const centre = g.textAlign === 'center';
  const x = centre ? W / 2 : size * 0.3;
  if (opts.plate) {
    // A soft dark pane behind the letters: the lights of the floor behind the glass stop crossing them.
    const tw = Math.min(W - size * 1.4, Math.max(...lines.map((l) => g.measureText(l).width)));
    const pw = tw + size * 1.2;
    const px = centre ? (W - pw) / 2 : x - size * 0.6;
    const py = m - size * 0.25;
    const ph = lines.length * lineH + size * 0.5;
    g.shadowColor = 'rgba(18,9,15,.6)';
    g.shadowBlur = size * 0.5;
    g.fillStyle = 'rgba(18,9,15,.55)';
    g.beginPath();
    if (g.roundRect) g.roundRect(Math.max(0, px), py, Math.min(W, pw), ph, size * 0.3);
    else g.rect(Math.max(0, px), py, Math.min(W, pw), ph);
    g.fill();
  }
  g.shadowColor = 'rgba(255,160,120,.75)';
  g.shadowBlur = size * 0.32;
  g.fillStyle = '#fff1e4';
  lines.forEach((l, i) => g.fillText(l, x, m + lineH * (i + 0.5)));
  return { texture: toTexture(c), aspect: W / H };
}

/** The sign on the wall facing the lift on each floor: big number, floor name. */
export function lobbySignTexture(level: number, label: string) {
  const W = 1024;
  const H = 512;
  const c = canvas(W, H);
  const g = c.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // Dark lettering on the lit lobby wall, like metal letters on a backlit panel. No glow:
  // seen from afar the texture is shrunk a lot and a light halo would turn the ink grey.
  g.fillStyle = '#3a0f26';
  g.font = `500 260px ${SERIF}`;
  g.fillText(String(level).padStart(2, '0'), W / 2, 205);
  const ls = g as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in g) ls.letterSpacing = '9px';
  const text = label.toUpperCase();
  let size = 66;
  g.font = `600 ${size}px ${SANS}`;
  while (size > 34 && g.measureText(text).width > W - 80) {
    size -= 2;
    g.font = `600 ${size}px ${SANS}`;
  }
  g.fillStyle = '#8a1212';
  g.fillText(text, W / 2, 405);
  return toTexture(c);
}
