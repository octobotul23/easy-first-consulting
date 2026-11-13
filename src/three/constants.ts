/**
 * Dimensions of the procedural tower (scene units ≈ metres) and the scene palette.
 * Level 0 is the lobby; level n sits at y = n * FLOOR_H.
 */
export const FLOOR_H = 3.4;
export const SLAB_T = 0.34;

export const TOWER_W = 17;
export const TOWER_D = 11;
export const FRONT_Z = TOWER_D / 2;

/** The lift shaft is a notch in the middle of the front facade. */
export const SHAFT_W = 3.1;
export const SHAFT_D = 2.4;
export const WING_W = (TOWER_W - SHAFT_W) / 2;
export const WING_X = SHAFT_W / 2 + WING_W / 2;

export const CABIN_W = 2.3;
export const CABIN_H = 2.82;
export const CABIN_D = 2.0;
/** Centre of the cabin in depth: its back is just in front of the landing doors. */
export const CABIN_Z = FRONT_Z - SHAFT_D + 0.16 + CABIN_D / 2;
export const LANDING_Z = FRONT_Z - SHAFT_D;

/**
 * Floor names on the glass: each floor's name sits on the left wing; the office's name ("Contact – Office 902")
 * on the right wing of the top floor. The phone camera frames the cabin together with these (CameraRig).
 */
export const SIGN_Z = FRONT_Z + 0.15;
export const FLOOR_SIGN_W = WING_W * 0.64;
export const OFFICE_SIGN_W = WING_W * 0.86;

/**
 * Office 902: the desk facing the lift, in the middle of the floor (x, z of its middle; height of its top),
 * and the framed picture standing on it, which the camera walks up to. The picture fits inside w × h
 * (metres) whatever its shape; y is the height of its middle above the floor.
 */
export const DESK = { x: 0, z: -2.45, top: 0.76, w: 2.1, d: 0.95 };
export const DESK_FRAME = { z: DESK.z - 0.12, w: 0.62, h: 0.44, y: DESK.top + 0.03 + 0.245 };

/** Plain floors above the office: the tower carries on above floor 9. */
export const EXTRA_LEVELS = 6;

/**
 * The grade without post-processing: shadows to night/plum, mid-tones ruby/plum, light sources warm
 * white or amber, accents crimson/magenta neon. Light colours are pushed above white in the code (hdr()).
 */
export const COLORS = {
  night: '#12090F',
  slab: '#1d1117',
  /** Dark bronze-mauve anodised aluminium: mullions, bands, crown, canopy. */
  metal: '#5e4b55',
  /** Dark rose-bronze tint of the curtain wall. */
  glass: '#2e1c27',
  neon: '#ff2f6d',
  neonSoft: '#ff3d7a',
  neonWide: '#d6247a',
  warm: '#ffb27a',
  warmWhite: '#ffe2c4',
  /** Ceiling linear LEDs (about 4000 K) and their warmer / cooler variants floor by floor. */
  led: '#fff0de',
  led3000: '#ffd2a1',
  led4000: '#ffe9d2',
  ledCool: '#dfe7ff',
  /** Light pools on the floors and the wash on the ceilings. */
  wash: '#ffb98a',
  label: '#ffe9d6',
};
