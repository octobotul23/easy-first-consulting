/**
 * Shape of everything the site shows. The defaults live in src/content/floors.ts,
 * src/config/company.ts and src/config/scene.ts; the admin panel saves changes on top.
 * Optional parts are "empty = not shown" (empty string / empty list), never missing,
 * so the admin panel can build its forms straight from this structure.
 */

export interface Seo {
  title: string;
  description: string;
}

/** A labelled group of short items shown as chips, e.g. "Products: EN590, LNG…". */
export interface Fact {
  label: string;
  items: string[];
}

/** A small heading + paragraph pair, e.g. Vision / Mission. */
export interface TextBlock {
  heading: string;
  text: string;
}

export interface FloorContent {
  /** Stable id, also the #anchor in the URL. Never shown. */
  id: string;
  /** false = the lift does not stop here and the button is hidden. */
  visible: boolean;
  /** Short name used on lift buttons, the floor display and the sign in the 3D tower. */
  label: string;
  kicker: string;
  title: string;
  intro: string;
  facts: Fact[];
  /** A numbered procedure shown as a sequence (empty list = hidden). */
  steps: Fact;
  points: string[];
  blocks: TextBlock[];
  note: string;
  seo: Seo;
}

export interface LobbyContent {
  eyebrow: string;
  title: string;
  subtitle: string;
  scrollHint: string;
  /** 3D tower, scrolling up rides up: the hint on computers (mouse, trackpad). */
  scrollUpHint: string;
  /** 3D tower, scrolling up rides up: the hint on touch screens. */
  swipeDownHint: string;
  seo: Seo;
}

export interface ContactFormText {
  name: string;
  company: string;
  email: string;
  phone: string;
  service: string;
  serviceAny: string;
  message: string;
  optional: string;
  submit: string;
  sending: string;
  success: string;
  failure: string;
  failureLink: string;
  mailtoNote: string;
  privacy: string;
  errorName: string;
  errorEmail: string;
  errorPhone: string;
  errorMessage: string;
  errorSummary: string;
}

export interface ContactContent {
  label: string;
  kicker: string;
  title: string;
  intro: string;
  addressLabel: string;
  phoneLabel: string;
  websiteLabel: string;
  mapLabel: string;
  form: ContactFormText;
  seo: Seo;
}

export interface NavContent {
  services: string;
  about: string;
  contact: string;
}

/** Small interface words used in several places. */
export interface CommonContent {
  floorWord: string;
  lobbyLabel: string;
  cta: string;
  liftPanel: string;
  goingUp: string;
  goingDown: string;
  skipLink: string;
  copyright: string;
}

export interface Person {
  id: string;
  role: string;
  name: string;
  email: string;
  /** A few lines about the person, shown under their details. Empty = nothing is shown. */
  bio: string;
}

export interface CompanyInfo {
  legalName: string;
  brand: string;
  /** The company name in Arabic, as in the logo. */
  nameArabic: string;
  /** Logo in the header (for a dark background): /logo.png, an uploaded image or an https:// link. */
  logo: string;
  phone: string;
  website: string;
  /** Address lines, shown one per line. */
  address: string[];
  mapUrl: string;
  /** Where the mailto fallback of the contact form goes. */
  formEmail: string;
  /** https:// address the contact form posts to (a form service). Empty = the visitor's e-mail app opens. */
  formEndpoint: string;
  people: Person[];
}

export interface SceneSettings {
  /** Off = everyone gets the light 2D version. */
  enable3D: boolean;
  /** Off = phones (narrower than 768 px) get the light 2D version, computers keep the 3D tower. */
  phone3D: boolean;
  /** 3D tower: the page starts at the lobby at the bottom and scrolling up rides the lift up. Off = scrolling down rides up. */
  scrollUp: boolean;
  /** Show floor names on the glass of the 3D tower. */
  floorSigns: boolean;
  /** How long the lift waits at each floor, in screens of scrolling (0.6 – 3). */
  floorScroll: number;
  /** A moving video behind the 3D tower. Off = the drawn sky and skyline (below). */
  backdropVideo: boolean;
  /** The video for computers: an uploaded MP4/WebM, a file of the site (/media/…) or an https:// link. */
  backdropSrc: string;
  /** A lighter copy for phones (about 720p). Empty = phones load the video above. */
  backdropSrcPhone: string;
  /** Still picture shown until the video plays, and instead of it for visitors who save data or want less motion. */
  backdropPoster: string;
  /** How much the video is darkened, in % (0 – 70), so the tower and the texts stand out. */
  backdropDim: number;
  /** The city (the still picture of the background) reflected in the glass of the tower and the lift. */
  glassReflections: boolean;
  /** Overall brightness of the tower: 0.7 – 1.4, 1.1 is the designed look. */
  sceneBrightness: number;
  /** The ground around the 3D tower: plaza, road, palms, street lights, the park down to the canal. Off = a dark floor fading into the water. */
  groundShow: boolean;
  /** Brightness of the street lights and lamps on that ground: 0.5 – 2, 1 is as designed. */
  groundLight: number;
  /** Background skyline: empty = drawn automatically; or /skyline.jpg / an https:// image. */
  skylineImage: string;
  /** Blur of the skyline in pixels (0 – 12). */
  skylineBlur: number;
  /** The framed picture on the desk of Office 902, which the camera walks up to at floor 9. Empty = the company logo. */
  deskImage: string;
}

export interface SiteContent {
  lobby: LobbyContent;
  floors: FloorContent[];
  contact: ContactContent;
  nav: NavContent;
  common: CommonContent;
  company: CompanyInfo;
  settings: SceneSettings;
}

/** One place the lift can stop at, in scroll order (lobby → floors → contact). */
export interface Stop {
  key: string;
  level: number;
  label: string;
}
