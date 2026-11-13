/**
 * 3D scene options. All of them can also be changed from the admin panel (Settings).
 */
import type { SceneSettings } from '../content/types.ts';

export const scene: SceneSettings = {
  enable3D: true,
  phone3D: true,
  scrollUp: true,
  floorSigns: true,
  floorScroll: 1.3,
  // Video of Dubai behind the 3D tower (a seamless 23 s loop made with Kling; files in /public/media).
  backdropVideo: true,
  backdropSrc: '/media/dubai-loop.mp4',
  backdropSrcPhone: '/media/dubai-loop-720.mp4',
  backdropPoster: '/media/dubai-loop.jpg',
  backdropDim: 20,
  glassReflections: true,
  sceneBrightness: 1.1,
  // The ground around the tower, built and lit in Blender (scripts/ground; files in /public/models).
  groundShow: true,
  groundLight: 1,
  // When the video is off: put an image in /public (e.g. /skyline.jpg) or an https:// link to use a photo instead of the drawn skyline.
  skylineImage: '',
  skylineBlur: 3,
};
