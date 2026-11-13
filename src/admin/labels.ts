/**
 * What each field of the panel is called and what it changes on the site.
 * Paths use "*" for any list position or floor (as in src/content/rules.ts).
 * Fields not listed here still appear, with a name made from their key.
 */
import type { Path } from '../content/rules';

export interface FieldInfo {
  label?: string;
  help?: string;
  /** Name of one entry of a list, e.g. "Tag". */
  item?: string;
  /** Text of the "add" button of a list. */
  add?: string;
  hidden?: boolean;
  /** A group that starts folded (long lists of small texts). */
  folded?: boolean;
  unit?: string;
}

const INFO: Record<string, FieldInfo> = {
  // ---------- First screen ----------
  'lobby.eyebrow': { label: 'Small line above the headline' },
  'lobby.title': {
    label: 'Headline',
    help: 'The big text on the first screen. Each sentence goes on its own line; the second one is in the orange-pink gradient.',
  },
  'lobby.subtitle': { label: 'Text under the headline' },
  'lobby.scrollHint': {
    label: 'Hint at the bottom of the first screen',
    help: 'Invites visitors to scroll down and ride the lift up. Shown in the light 2D version, and on the 3D tower when “Scroll up to ride the lift up” is off.',
  },
  'lobby.scrollUpHint': {
    label: 'Same hint on computers, 3D tower',
    help: 'Shown while “Scroll up to ride the lift up” is on: tells visitors to scroll up with the mouse or trackpad.',
  },
  'lobby.swipeDownHint': {
    label: 'Same hint on phones and tablets, 3D tower',
    help: 'Shown while “Scroll up to ride the lift up” is on: tells visitors to drag the page down with a finger.',
  },

  // ---------- Google (every page part) ----------
  '*.seo': { label: 'In Google and in the browser tab', folded: true },
  '*.seo.title': { label: 'Page title', help: 'Shown in the browser tab and as the blue link in Google. Around 50–60 characters is best.' },
  '*.seo.description': { label: 'Description in Google', help: 'The grey text under the link in Google results. Around 140–160 characters is best.' },

  // ---------- Floors ----------
  'floors.*.id': { hidden: true },
  'floors.*.visible': { label: 'Show this floor', help: 'Off: the lift skips this floor and its button disappears. Nothing is deleted.' },
  'floors.*.label': {
    label: 'Floor name',
    help: 'On the lift buttons, the floor display, the sign on the 3D tower and the list of services in the contact form. Keep it short.',
  },
  'floors.*.kicker': { label: 'Small line above the title' },
  'floors.*.title': { label: 'Title of the floor' },
  'floors.*.intro': { label: 'Text under the title', help: 'An empty line starts a new paragraph.' },
  'floors.*.facts': { label: 'Groups of tags', help: 'For example “Products” with EN590, LNG… Shown as small labels.', item: 'Group', add: 'Add a group of tags' },
  'floors.*.facts.*.label': { label: 'Name of the group' },
  'floors.*.facts.*.items': { label: 'Tags', item: 'Tag', add: 'Add a tag' },
  'floors.*.steps': { label: 'Numbered steps', help: 'A procedure shown in order, with arrows between the steps. Remove all steps to hide it.' },
  'floors.*.steps.label': { label: 'Heading above the steps' },
  'floors.*.steps.items': { label: 'Steps, in order', item: 'Step', add: 'Add a step' },
  'floors.*.points': { label: 'Bullet points', item: 'Point', add: 'Add a point' },
  'floors.*.blocks': { label: 'Text blocks', help: 'A small heading with a paragraph, e.g. Vision and Mission.', item: 'Block', add: 'Add a text block' },
  'floors.*.blocks.*.heading': { label: 'Heading' },
  'floors.*.blocks.*.text': { label: 'Text' },
  'floors.*.note': { label: 'Small print at the bottom of the floor' },

  // ---------- Office 902 ----------
  'contact.label': { label: 'Floor name', help: 'On the top lift button, the floor display and the sign on the tower.' },
  'contact.kicker': { label: 'Small line above the title' },
  'contact.title': { label: 'Title of the office' },
  'contact.intro': { label: 'Text under the title' },
  'contact.addressLabel': { label: 'Heading above the address' },
  'contact.phoneLabel': { label: 'Heading above the phone number' },
  'contact.websiteLabel': { label: 'Heading above the website' },
  'contact.mapLabel': { label: 'Text of the map link', help: 'The link opens the map address set in Company.' },
  'contact.form': { label: 'Texts of the contact form', folded: true },
  'contact.form.name': { label: 'Label of the name field' },
  'contact.form.company': { label: 'Label of the company field' },
  'contact.form.email': { label: 'Label of the e-mail field' },
  'contact.form.phone': { label: 'Label of the phone field' },
  'contact.form.service': { label: 'Label of the list of services' },
  'contact.form.serviceAny': { label: 'First choice in the list of services', help: 'For visitors without a specific service in mind. The other choices are the floor names.' },
  'contact.form.message': { label: 'Label of the message field' },
  'contact.form.optional': { label: 'Word shown after fields that can stay empty' },
  'contact.form.submit': { label: 'Send button' },
  'contact.form.sending': { label: 'Send button while sending' },
  'contact.form.success': { label: 'Message after sending' },
  'contact.form.failure': { label: 'Message when sending did not work' },
  'contact.form.failureLink': { label: 'Link to send by e-mail instead (after a failure)' },
  'contact.form.mailtoNote': { label: 'Message when the visitor’s e-mail app opens' },
  'contact.form.privacy': { label: 'Small print under the form' },
  'contact.form.errorName': { label: 'Error when the name is missing' },
  'contact.form.errorEmail': { label: 'Error when the e-mail is not valid' },
  'contact.form.errorPhone': { label: 'Error when the phone is not valid' },
  'contact.form.errorMessage': { label: 'Error when the message is missing or too short' },
  'contact.form.errorSummary': { label: 'Error above the form when fields need fixing' },

  // ---------- Company ----------
  'company.legalName': { label: 'Full company name', help: 'In Google results, in the details for search engines and next to ©.' },
  'company.brand': { label: 'Short name', help: 'Next to the logo and in the alt text of the logo.' },
  'company.nameArabic': { label: 'Company name in Arabic', help: 'Given to search engines, so people who search in Arabic find the site.' },
  'company.logo': { label: 'Logo in the top bar', help: 'An SVG, PNG or WebP with a transparent background looks best.' },
  'company.phone': { label: 'Phone number', help: 'In the contact office; tapping it on a phone calls the number.' },
  'company.website': { label: 'Website address', help: 'Shown in the contact office and used by Google as the official address.' },
  'company.address': { label: 'Address', help: 'One line per row, top to bottom.', item: 'Line', add: 'Add a line' },
  'company.mapUrl': { label: 'Map link', help: 'A Google Maps link (https://…). Empty = no map link.' },
  'company.formEmail': { label: 'E-mail that receives the contact form', help: 'When the form opens the visitor’s e-mail app, the message is addressed here.' },
  'company.formEndpoint': {
    label: 'Form service address (optional)',
    help: 'An https:// address from a form service (e.g. Formspree, Basin) that sends the messages to you. Empty = the visitor’s own e-mail app opens with the message ready.',
  },
  'company.people': { label: 'People in the contact office', item: 'Person', add: 'Add a person' },
  'company.people.*.id': { hidden: true },
  'company.people.*.role': { label: 'Role', help: 'E.g. CEO.' },
  'company.people.*.name': { label: 'Name' },
  'company.people.*.email': { label: 'E-mail' },
  'company.people.*.bio': { label: 'A few lines about this person', help: 'Shown under their e-mail in Office 902. Leave empty to show nothing.' },

  // ---------- Menu and small words ----------
  nav: { label: 'Menu at the top' },
  common: { label: 'Small words used in several places' },
  settings: { label: '3D tower and background' },
  'nav.services': { label: 'Menu: link to the first floor' },
  'nav.about': { label: 'Menu: link to Vision & Mission' },
  'nav.contact': { label: 'Menu: link to the contact office' },
  'common.floorWord': { label: 'The word “Floor”', help: 'Before the floor number: on the lift buttons, the display and every floor.' },
  'common.lobbyLabel': { label: 'Name of the ground floor', help: 'On the lowest lift button and the floor display.' },
  'common.cta': { label: 'Button at the end of each floor', help: 'Takes the visitor up to the contact office.' },
  'common.liftPanel': { label: 'Title of the lift buttons', help: 'Read out by screen readers; shown above the buttons on large screens.' },
  'common.goingUp': { label: 'Floor display while going up' },
  'common.goingDown': { label: 'Floor display while going down' },
  'common.skipLink': { label: '“Skip to content” link', help: 'Appears only when the page is used with the keyboard.' },
  'common.copyright': { label: 'Copyright line', help: 'After © and the current year, at the bottom of the contact office.' },

  // ---------- Settings ----------
  'settings.enable3D': {
    label: 'Show the 3D tower',
    help: 'Off = every visitor sees the light 2D version. Devices too slow for 3D, and visitors who asked their system for less motion, always do.',
  },
  'settings.phone3D': {
    label: 'Show the 3D tower on phones too',
    help: 'Off = phones get the light 2D version and computers keep the 3D tower. Works only while “Show the 3D tower” is on.',
  },
  'settings.scrollUp': {
    label: 'Scroll up to ride the lift up',
    help: 'On = the 3D tower opens at the lobby at the bottom of the page, and scrolling up (or dragging down with a finger) takes the lift up. Off = scrolling down takes it up, like a normal page. The light 2D version always reads from top to bottom.',
  },
  'settings.floorSigns': { label: 'Floor names on the glass of the tower' },
  'settings.floorScroll': {
    label: 'How long the lift stays at each floor',
    help: 'In screen heights of scrolling. More = visitors scroll longer before the lift moves on.',
    unit: 'screens',
  },
  'settings.backdropVideo': {
    label: 'Video of Dubai behind the tower',
    help: 'On = the moving video below plays behind the 3D tower, over and over. Off = a drawn sky and skyline instead (set further down).',
  },
  'settings.backdropSrc': {
    label: 'Background video (computers)',
    help: 'An MP4 or WebM video, up to 40 MB, 16:9. It plays without sound and starts again from the beginning, so its first and last frames should match.',
  },
  'settings.backdropSrcPhone': {
    label: 'Lighter copy of the video for phones',
    help: 'The same video made smaller (about 1280 × 720), so it loads fast on mobile data. Empty = phones load the video above.',
  },
  'settings.backdropPoster': {
    label: 'Still picture of the background',
    help: 'Shown while the video loads, and instead of it for visitors who save mobile data or asked for less motion. Best: the first frame of the video.',
  },
  'settings.backdropDim': {
    label: 'Darken the background video',
    help: 'More = a darker city behind the tower, so the tower and the texts stand out more.',
    unit: '%',
  },
  'settings.glassReflections': {
    label: 'City reflected in the glass of the tower',
    help: 'Uses the still picture of the background. Off = the glass reflects only a soft sunset glow.',
  },
  'settings.sceneBrightness': {
    label: 'Brightness of the tower',
    help: '1.1 is the designed look. Lower = a darker, moodier night; higher = brighter floors and glass.',
    unit: '×',
  },
  'settings.groundShow': {
    label: 'Street, palms and park around the tower',
    help: 'The plaza, the road with its palms and street lights, and the park down to the water. Off = a dark floor under the tower that fades into the water of the video.',
  },
  'settings.groundLight': {
    label: 'Brightness of the street lights',
    help: '1 is the designed look. Lower = a darker street at night; higher = brighter pools of light on the ground, the palms and the lamps.',
    unit: '×',
  },
  'settings.skylineImage': {
    label: 'Skyline photo behind the tower (when the video is off)',
    help: 'Empty = the Business Bay skyline is drawn automatically.',
  },
  'settings.skylineBlur': { label: 'Blur of the skyline (when the video is off)', unit: 'px' },
};

const pattern = (path: Path) => path.map((p) => (typeof p === 'number' ? '*' : String(p)));

/** Most specific entry wins, like the validation rules. */
export function infoFor(path: Path): FieldInfo {
  const parts = pattern(path);
  let best: FieldInfo | undefined;
  let bestScore = -1;
  for (const [key, info] of Object.entries(INFO)) {
    const k = key.split('.');
    if (k.length !== parts.length) continue;
    let score = 0;
    let ok = true;
    for (let i = 0; i < k.length; i++) {
      if (k[i] === parts[i]) score += 2;
      else if (k[i] === '*') score += i === 0 ? 0 : 1;
      else {
        ok = false;
        break;
      }
    }
    if (ok && score > bestScore) {
      best = info;
      bestScore = score;
    }
  }
  return best ?? {};
}

/** "skylineBlur" → "Skyline blur" (for fields without an entry). */
export function humanize(key: string | number): string {
  const s = String(key)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function labelFor(path: Path): string {
  return infoFor(path).label ?? humanize(path[path.length - 1]);
}

/** A short human description of where a field is, for lists such as search results. */
export function placeOf(path: Path, floorLabel: (i: number) => string): string {
  const head: Record<string, string> = {
    lobby: 'First screen',
    contact: 'Office 902',
    company: 'Company',
    nav: 'Menu',
    common: 'Small words',
    settings: 'Settings',
  };
  const first = String(path[0]);
  const where = first === 'floors' ? floorLabel(path[1] as number) : (head[first] ?? humanize(first));
  return `${where} › ${labelFor(path)}`;
}
