/**
 * Checks the ground plan against the site's camera, before baking. Every check is a hard assert:
 *  - desktop street, on every desktop screen and browser window held wide: nothing comes within 15 px of the first
 *    screen's text; on the four common desktop screens nothing in view rises above the
 *    sight line h = 1.6 + 0.0827·d (d: metres along the ground from the street camera);
 *  - street shots: nothing taller than 1 m stands in front of the tower over its face;
 *  - phone street: no palm, lantern or pole rises above the video's shore; the necklace lamps rise at most 10 px
 *    above it, and only in the screen's outer thirds; nothing stands on the camera-side pavement;
 *  - desktop ride L0–L3, on every desktop screen and browser window: nothing tall behind the lift panel but the
 *    canal row and the back street's poles;
 *  - every screen, state and mouse position: the quay's edge sits at least 8 px above the row where the video
 *    starts to fade, across the whole width.
 * Then it prints the water band (rows of video water between the shore and the quay) for the client.
 * Run: node scripts/ground/check.mjs   (reads src/three/ground/layout.json; exits with 1 on a failure)
 * Add a screen or state name to check only those: node scripts/ground/check.mjs 375x812   or   ... office
 */
import { readFileSync } from 'node:fs';
import { camera, waterline, onScreen, pxPerM, zones, SCREENS, DESKTOPS, WIDE, PHONES, STATES, SWAYS, SCROLLBARS, TOWER, THREE } from './views.mjs';

const L = JSON.parse(readFileSync(new URL('../../src/three/ground/layout.json', import.meta.url), 'utf8'));
const want = process.argv[2];
const picked = (screen, state) => !want || `${screen.name} ${state.name}`.includes(want);
const state = (name) => STATES.find((s) => s.name === name);
const STREET = state('street');
const V = (x, y, z) => new THREE.Vector3(x, y, z);

const towerBox = new THREE.Box3(V(TOWER.x0, TOWER.y0, TOWER.z0), V(TOWER.x1, TOWER.h, TOWER.z1));
const ray = new THREE.Ray();
const hit = V(0, 0, 0);
/** True when the tower stands between the camera and the point (from inside the office, nothing is hidden). */
function hidden(cam, p) {
  if (towerBox.containsPoint(cam.position)) return false;
  const d = p.clone().sub(cam.position);
  const len = d.length();
  ray.set(cam.position, d.normalize());
  return !!ray.intersectBox(towerBox, hit) && hit.distanceTo(cam.position) < len - 0.01;
}

/** Kinds whose lamp head carries a glow sprite: their top on screen is raised by the glow's radius. */
const GLOWING = new Set(['pole', 'lantern', 'lamp', 'bollard']);

/**
 * Where one tall thing lands on screen: its column range (crown or glow included), its top and base rows, and
 * whether the tower hides it (its top, middle and both sides of its top all behind the tower).
 * Null when it is behind the camera or off screen.
 */
function place(cam, W, H, t) {
  const y1 = t.y0 + t.h;
  const top = onScreen(cam, W, H, t.x, y1, t.z);
  const base = onScreen(cam, W, H, t.x, t.y0, t.z);
  if (!top.front || !base.front) return null;
  const r = t.r * pxPerM(cam, H, cam.position.distanceTo(V(t.x, y1, t.z)));
  const p = { x: top.x, x0: top.x - r, x1: top.x + r, top: top.y - (GLOWING.has(t.kind) ? r : 0), base: base.y };
  if (p.x1 < 0 || p.x0 > W || p.base < 0 || p.top > H) return null;
  const points = [V(t.x, y1, t.z), V(t.x, t.y0 + t.h / 2, t.z), V(t.x - t.r, y1, t.z), V(t.x + t.r, y1, t.z)];
  p.hidden = points.every((q) => hidden(cam, q));
  return p;
}

/**
 * One check group: how many camera views it ran, the worst value seen (lower is worse) and the failures,
 * keeping the worst case per thing.
 */
function group(title, unit) {
  return {
    title,
    unit,
    views: 0,
    worst: null,
    fails: new Map(),
    see(value, where) {
      if (!this.worst || value < this.worst.value) this.worst = { value, where };
    },
    fail(key, value, message) {
      const f = this.fails.get(key);
      if (!f || value < f.value) this.fails.set(key, { value, message });
    },
  };
}
const groups = [];
const sway = ([sx, sy]) => `sway ${sx},${sy}`;
const px = (n) => n.toFixed(1);

// ---------------------------------------------------------------- desktop street: the text and the sight line
// The text is checked on every desktop screen and browser window held wide. On a tablet held upright (768 × 1024) it
// runs across the whole width over the tower's foot, so the ground always stands behind it; its soft shade
// (.lobby-3d::before) keeps it readable there. The sight line is the design rule the ground was laid out by, worked
// out on the four common desktop screens; wider screens see further to the sides (an ultra-wide shows a cross
// street's pole at its left edge, beside the text), and the text check covers what matters on them.
const text = group('desktop street, every window held wide: >= 15 px between the text and anything under it', 'px');
const sight = group('desktop street, four common screens: everything in view under h = 1.6 + 0.0827 d', 'm');
groups.push(text, sight);
for (const s of WIDE) {
  if (!picked(s, STREET) || s.W < s.H) continue;
  const common = DESKTOPS.includes(s);
  for (const sb of SCROLLBARS)
  for (const sw of SWAYS) {
    const box = zones(s.W, s.H, sb).text;
    const cam = camera({ ...s, W: s.W - sb, ...STREET, sx: sw[0], sy: sw[1] });
    text.views++;
    if (common) sight.views++;
    for (const t of L.tall) {
      const p = place(cam, s.W - sb, s.H, t);
      if (!p) continue;
      const where = `${t.id} at ${s.name} ${sway(sw)} scroll bar ${sb}`;
      const room = 1.6 + 0.0827 * Math.hypot(t.x + 16.5, t.z - 57.5) - (t.y0 + t.h);
      if (common) sight.see(room, where);
      if (common && room < 0) sight.fail(t.id, room, `${t.id}: ${(-room).toFixed(2)} m over the sight line`);
      if (p.hidden || p.x1 < box[0] || p.x0 > box[2]) continue;
      const gap = p.top - box[3];
      text.see(gap, where);
      if (gap < 15) text.fail(t.id, gap, `${where}: ${px(gap)} px under the text`);
    }
  }
}

// ---------------------------------------------------------------- street shots: the tower's face
const front = group('street: nothing over 1 m in front of the tower over its face', 'px');
groups.push(front);
for (const s of SCREENS) {
  if (!picked(s, STREET)) continue;
  for (const sw of SWAYS) {
    const cam = camera({ ...s, ...STREET, sx: sw[0], sy: sw[1] });
    front.views++;
    const corners = [[TOWER.x0, 0], [TOWER.x1, 0], [TOWER.x0, TOWER.h], [TOWER.x1, TOWER.h]].map(([x, y]) => onScreen(cam, s.W, s.H, x, y, TOWER.z1));
    const face = [Math.min(...corners.map((c) => c.x)), Math.max(...corners.map((c) => c.x)), Math.max(...corners.map((c) => c.y))];
    for (const t of L.tall) {
      if (t.h <= 1 || t.z <= TOWER.z1) continue;
      const p = place(cam, s.W, s.H, t);
      if (!p || p.hidden) continue;
      // Pixels clear of the face: beside it, or under its foot; negative = over it.
      const clear = Math.max(face[0] - p.x1, p.x0 - face[1], p.top - face[2]);
      const where = `${t.id} at ${s.name} ${sway(sw)}`;
      front.see(clear, where);
      if (clear < 0) front.fail(t.id, clear, `${where}: ${px(-clear)} px over the tower's face`);
    }
  }
}

// ---------------------------------------------------------------- phone street: the shore and the near pavement
const SHORE_KINDS = new Set(['palm', 'lantern', 'pole']);
/**
 * Necklace lamps may show over the shore only in the screen's outer thirds, beside the tower (which fills the
 * middle of the phone's street shot), never in its middle third.
 */
const LAMP_SIDE = 1 / 3;
const shore = group('phone street: palms, lanterns and poles under the shore', 'px');
const lamps = group('phone street: necklace lamps <= 10 px over the shore, in the outer thirds only', 'px');
const near = group('phone street: nothing on the camera-side pavement', 'px');
groups.push(shore, lamps, near);
for (const s of PHONES) {
  if (!picked(s, STREET)) continue;
  for (const sw of SWAYS) {
    const cam = camera({ ...s, ...STREET, sx: sw[0], sy: sw[1] });
    const line = waterline(cam, s.W, s.H).shore;
    // The far kerb of the boulevard (z 47): the camera-side pavement fills the screen from that row down.
    const kerb = onScreen(cam, s.W, s.H, cam.position.x, L.levels.walk, 47).y;
    shore.views++;
    lamps.views++;
    near.views++;
    for (const t of L.tall) {
      const p = place(cam, s.W, s.H, t);
      if (!p || p.hidden) continue;
      const where = `${t.id} at ${s.name} ${sway(sw)}`;
      const under = p.top - line;
      if (SHORE_KINDS.has(t.kind)) {
        shore.see(under, where);
        if (under < 0) shore.fail(t.id, under, `${where}: ${px(-under)} px over the shore`);
      }
      if (t.kind === 'lamp' && under < 0) {
        const side = Math.min(p.x, s.W - p.x) / s.W;
        lamps.see(10 + under, `${where} (${px(-under)} px, column ${p.x.toFixed(0)})`);
        if (under < -10) lamps.fail(t.id, under, `${where}: ${px(-under)} px over the shore`);
        else if (side > LAMP_SIDE) lamps.fail(t.id, -side, `${where}: over the shore at column ${p.x.toFixed(0)} of ${s.W}`);
      }
      const above = kerb - p.base;
      near.see(above, `${where} (pavement from row ${kerb.toFixed(0)})`);
      if (above < 0) near.fail(t.id, above, `${where}: stands on the camera-side pavement (rows ${kerb.toFixed(0)}-${s.H})`);
    }
  }
}

// ---------------------------------------------------------------- desktop ride L0–L3: the lift panel
/**
 * Accepted behind the panel: the two rows that run across its column, the canal row (the quay palms at z −191.5
 * and the necklace lamps at z −213) and the back street's poles behind the tower (z −28.6). Which stretch of a row
 * the panel covers depends on the window's size (checked live at 1920 × 953: the panel's dark frosted glass hides
 * it, and a crown at its edge simply peeks out), so no gap can follow it, and a gap would show from the upper
 * floors. Everything else (single lanterns, palms, poles), which can move, must stay clear.
 */
// (A pole's arm heads are entries of their own, off its z; its id names the pole's foot.)
const accepted = (t) => t.z <= -190 || (t.kind === 'pole' && t.id.endsWith(',-28.6'));
const panel = group('desktop ride L0-L3: nothing but the canal row and the back street behind the lift panel', 'px');
groups.push(panel);
const allowed = new Set();
// Every frame up to floor 3 with the doors shut: the fly-in from G and the ride (not the street, before the panel
// matters, nor the open doors and the office, where the floor's card covers the screen).
const RIDE = STATES.filter((q) => (q.intro ?? 1) > 0 && !q.door && !q.office && q.level <= 3);
for (const s of WIDE) {
  for (const sb of SCROLLBARS) {
  const box = zones(s.W, s.H, sb).panel;
  for (const st of RIDE) {
    if (!picked(s, st)) continue;
    for (const sw of SWAYS) {
      const cam = camera({ ...s, W: s.W - sb, ...st, sx: sw[0], sy: sw[1] });
      panel.views++;
      for (const t of L.tall) {
        if (t.h < 3) continue;
        const p = place(cam, s.W - sb, s.H, t);
        if (!p || p.hidden || p.base < box[1]) continue;
        // Pixels clear of the panel: beside it or under it; negative = behind it.
        const clear = Math.max(box[0] - p.x1, p.x0 - box[2], p.top - box[3]);
        if (accepted(t)) {
          if (clear < 0) allowed.add(t.id);
          continue;
        }
        const where = `${t.id} at ${s.name} ${st.name} ${sway(sw)} scroll bar ${sb}`;
        panel.see(clear, where);
        if (clear < 0) panel.fail(t.id, clear, `${where}: ${px(-clear)} px behind the panel`);
      }
    }
  }
  }
}

// ---------------------------------------------------------------- every view: the quay covers the video's fade
/**
 * The quay's far top edge (y quay.top at z quay.z) is a straight line on screen: every row under it shows ground.
 * It must sit 8 px above the fade row in 41 columns across the screen, and the quay must run past both sides.
 */
const MARGIN = 8;
/** Where the ray through a screen pixel crosses the quay's line (x in metres; Infinity if it never gets there). */
function quayX(cam, s, x, y) {
  const d = V((x / s.W) * 2 - 1, 1 - (y / s.H) * 2, 0.5).unproject(cam).sub(cam.position);
  const k = (L.quay.z - cam.position.z) / d.z;
  return k > 0 ? cam.position.x + d.x * k : Infinity;
}
const fade = group(`every view: the quay >= ${MARGIN} px above the video's fade row`, 'px');
groups.push(fade);
let offScreen = 0;
for (const s of SCREENS) {
  for (const st of STATES) {
    if (!picked(s, st)) continue;
    for (const sw of SWAYS) {
      const cam = camera({ ...s, ...st, sx: sw[0], sy: sw[1] });
      const row = waterline(cam, s.W, s.H).fade;
      if (row >= s.H) {
        offScreen++;
        continue;
      }
      fade.views++;
      const where = `${s.name} ${st.name} ${sway(sw)}`;
      const at = (x) => onScreen(cam, s.W, s.H, x, L.quay.top, L.quay.z);
      const a = at(cam.position.x - 100);
      const b = at(cam.position.x + 100);
      const edgeRow = (x) => a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
      if (!a.front || !b.front || ![0, s.W].every((x) => Math.abs(quayX(cam, s, x, edgeRow(x))) <= L.quay.x[1])) {
        fade.fail(where, -Infinity, `${where}: the quay does not span the screen`);
        continue;
      }
      for (let i = 0; i <= 40; i++) {
        const margin = row - edgeRow((s.W * i) / 40);
        fade.see(margin, `${where} column ${i}/40`);
        if (margin < MARGIN) fade.fail(where, margin, `${where} column ${i}/40: ${px(margin)} px`);
      }
    }
  }
}

// ---------------------------------------------------------------- report
let failures = 0;
for (const g of groups) {
  if (!g.views) continue; // left out by the name filter
  const worst = g.worst ? `, worst ${g.worst.value.toFixed(g.unit === 'm' ? 2 : 1)} ${g.unit} (${g.worst.where})` : ', none in view';
  console.log(`${g.fails.size ? 'FAIL' : 'ok  '} ${g.title}: ${g.views} views${worst}`);
  for (const f of g.fails.values()) console.log(`       !! ${f.message}`);
  failures += g.fails.size;
}
if (allowed.size) {
  const rows = [...allowed].reduce((a, id) => ((a[id.split(' ')[0]] = (a[id.split(' ')[0]] ?? 0) + 1), a), {});
  console.log(`     accepted behind the panel: ${Object.entries(rows).map(([k, n]) => `${n} ${k}`).join(', ')} (the canal row, the back street)`);
}
if (offScreen) console.log(`     ${offScreen} views with the fade row below the screen (nothing to cover)`);

// The water band: rows of the video's water between its shore and the quay, straight ahead, without sway.
const BAND_SCREENS = ['1440x900', '1920x1080', '375x812'].map((n) => SCREENS.find((s) => s.name === n));
const BAND_STATES = ['street', 'ride L1', 'ride L3', 'ride L5', 'ride L9', 'office 1'].map(state);
console.log(`\nwater band (px)  ${BAND_SCREENS.map((s) => s.name.padStart(11)).join('')}`);
for (const st of BAND_STATES) {
  const cells = BAND_SCREENS.map((s) => {
    const cam = camera({ ...s, ...st });
    const quay = onScreen(cam, s.W, s.H, cam.position.x, L.quay.top, L.quay.z).y;
    return (quay - waterline(cam, s.W, s.H).shore).toFixed(0).padStart(11);
  });
  console.log(`${st.name.padEnd(17)}${cells.join('')}`);
}

console.log(failures ? `\n${failures} failure(s).` : '\nAll checks pass.');
process.exit(failures ? 1 : 0);
