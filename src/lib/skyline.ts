/**
 * The blurred Business Bay skyline behind the tower, drawn on a canvas (no image files).
 * An image can replace it (Settings → skyline image); both go through the same blur.
 */

type Source = HTMLCanvasElement | HTMLImageElement;

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Small seeded random generator, so the skyline is the same on every visit. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Soft blur that works in every browser: shrink, then enlarge with smoothing
 * (canvas `filter` is not supported everywhere).
 */
export function blurCanvas(src: Source, blur: number, w = src.width, h = src.height): HTMLCanvasElement {
  const out = canvas(w, h);
  const g = out.getContext('2d')!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  if (blur <= 0) {
    g.drawImage(src, 0, 0, w, h);
    return out;
  }
  const s = 1 / (1 + blur * 1.1);
  const small = canvas(Math.max(8, Math.round(w * s)), Math.max(8, Math.round(h * s)));
  const sg = small.getContext('2d')!;
  sg.imageSmoothingEnabled = true;
  sg.imageSmoothingQuality = 'high';
  sg.drawImage(src, 0, 0, small.width, small.height);
  g.drawImage(small, 0, 0, w, h);
  return out;
}

interface Layer {
  count: number;
  minH: number;
  maxH: number;
  minW: number;
  maxW: number;
  color: string;
  lit: number;
  lights: string[];
}

const LAYERS: Layer[] = [
  { count: 90, minH: 0.06, maxH: 0.24, minW: 18, maxW: 64, color: '#3c1b35', lit: 0.1, lights: ['rgba(255,190,150,.45)'] },
  {
    count: 56,
    minH: 0.14,
    maxH: 0.5,
    minW: 24,
    maxW: 78,
    color: '#26111f',
    lit: 0.22,
    lights: ['rgba(255,200,150,.85)', 'rgba(255,235,210,.8)', 'rgba(255,120,160,.7)'],
  },
  {
    count: 16,
    minH: 0.42,
    maxH: 0.84,
    minW: 30,
    maxW: 66,
    color: '#1b0b17',
    lit: 0.3,
    lights: ['rgba(255,215,170,.95)', 'rgba(255,245,230,.9)'],
  },
];

/** Draws a wide, seamless skyline strip (transparent sky, lit windows, warm haze). */
export function drawSkyline(blur: number, seed = 906): HTMLCanvasElement {
  const W = 2048;
  const H = 512;
  const c = canvas(W, H);
  const g = c.getContext('2d')!;
  const rand = rng(seed);

  const haze = g.createLinearGradient(0, H * 0.45, 0, H);
  haze.addColorStop(0, 'rgba(255,120,90,0)');
  haze.addColorStop(1, 'rgba(255,120,90,.32)');
  g.fillStyle = haze;
  g.fillRect(0, H * 0.45, W, H * 0.55);

  for (const L of LAYERS) {
    for (let i = 0; i < L.count; i++) {
      const w = L.minW + rand() * (L.maxW - L.minW);
      const h = H * (L.minH + Math.pow(rand(), 1.6) * (L.maxH - L.minH));
      const x = rand() * W;
      const spire = h > H * 0.5 && rand() < 0.45;
      const round = !spire && rand() < 0.25;
      const lit = L.lit * (0.5 + rand());
      const light = L.lights[Math.floor(rand() * L.lights.length)];
      // Draw twice when crossing the edge so the strip tiles without a seam.
      for (const ox of [0, -W, W]) {
        const bx = x + ox;
        if (bx > W || bx + w < 0) continue;
        g.fillStyle = L.color;
        g.beginPath();
        g.moveTo(bx, H);
        g.lineTo(bx, H - h);
        if (spire) {
          g.lineTo(bx + w * 0.5, H - h - h * 0.16);
          g.lineTo(bx + w, H - h);
        } else if (round) {
          g.quadraticCurveTo(bx + w * 0.5, H - h - w * 0.45, bx + w, H - h);
        } else {
          g.lineTo(bx + w, H - h);
        }
        g.lineTo(bx + w, H);
        g.closePath();
        g.fill();
        // Windows
        const r2 = rng(Math.floor(x * 1000) + i);
        g.fillStyle = light;
        for (let wy = H - h + 6; wy < H - 4; wy += 6) {
          for (let wx = bx + 3; wx < bx + w - 3; wx += 5) {
            if (r2() < lit) g.fillRect(wx, wy, 2, 2.5);
          }
        }
      }
    }
  }

  // Street lights along the water's edge
  for (let i = 0; i < 260; i++) {
    g.fillStyle = rand() < 0.7 ? 'rgba(255,170,90,.9)' : 'rgba(255,240,220,.9)';
    g.fillRect(rand() * W, H - 3 - rand() * 6, 2, 2);
  }
  return blurCanvas(c, blur);
}

/** Loads an image for the skyline (at most maxW pixels wide); resolves to null if it cannot be used. */
export function loadSkylineImage(url: string, blur: number, maxW = 4096): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const w = Math.min(maxW, img.naturalWidth || 2048);
        const h = Math.round(w * ((img.naturalHeight || 512) / (img.naturalWidth || 2048)));
        resolve(blurCanvas(img, blur, w, h));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
