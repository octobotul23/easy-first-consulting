# Easy First — The Lift in IRIS Bay Tower

Presentation site for **Easy First Management Consultancies FZCO** (Office 902, IRIS Bay Tower, Business Bay, Dubai).
Visitors ride a glass lift up a 3D tower as they scroll. Each floor is a service, and on floor 9 the doors open onto the contact office.

Vite + React + TypeScript, three.js (@react-three/fiber, drei), GSAP ScrollTrigger and Tailwind.
The site and the admin panel run on a small Node server (`server/`) that uses no npm packages.

## Start

```bash
npm install
npm run build          # site + admin panel → dist/, server renderer → server/build/
npm run admin:create   # first admin account (asks for a name and a hidden password)
npm run serve          # http://127.0.0.1:8787  ·  panel: http://127.0.0.1:8787/admin
```

While you work on the code, run `npm run dev` (http://localhost:5173). To use the panel and the saved texts at the same time, also run `npm run serve` in a second terminal; Vite forwards `/api` and `/uploads` to it.
Without the server, the site still works and shows the original texts.

## 3D or 2D

Visitors get the full 3D lift on computers, tablets and phones with WebGL. The light 2D version is shown instead in these cases:
- the visitor asked their system for *reduced motion*;
- WebGL is missing;
- **Settings → Show the 3D tower** is off in the panel (everyone gets 2D);
- **Settings → Show the 3D tower on phones too** is off (screens narrower than 768 px get 2D, computers keep 3D);
- the device draws the tower too slowly (under about 20 frames a second while the lift moves). The site then switches to 2D by itself and keeps 2D for the rest of the visit.

`?mode=3d` or `?mode=flow` in the address forces one version, which is handy for testing.

**Which way to scroll.** The 3D tower opens at the Lobby, at the bottom of the page. Scrolling up (mouse wheel up, or dragging the page down with a finger) takes the lift up, and Office 902 is at the top of the page.
- The hint under the title says so: “Scroll up to go up” on computers, “Swipe down to go up” on phones and tablets, with a small light running the same way.
- Keys: ↑ and Page Up go up, ↓ and Page Down go down. Space goes up one screen (Shift+Space goes down), Home goes to the Lobby, End to Office 902.
- Pull-to-refresh is off on the 3D tower, so dragging down at Office 902 does not reload the page.
- With **Settings → Scroll up to ride the lift up** off, the 3D tower becomes a normal page again: it opens at the Lobby at the top, and scrolling down takes the lift up.
- The 2D version always reads from top to bottom.
- In both versions a link to a floor (e.g. `/#contact`) opens at that floor. Resizing the window or turning the phone keeps the lift on its floor.

**On phones held upright** the tower fills the screen. When the lift stops, the floor's text slides up in a card at the bottom, above one row of lift buttons (G–9). Held sideways, phones use the computer layout, with the card on the left and the buttons on the right.
While riding, the camera keeps the cabin and the floor's name on the glass on the screen together. For floors 1–8 it stands a little to the left, where the names are. On the way up to Office 902 it swings to the right, to the office's name, rests there for a moment once the doors are open (about 1.6 s), then walks in, up to the desk facing the lift, and ends on the framed picture on it (Settings → Picture on the desk in Office 902). The picture lands in the part of the screen the contact card leaves free: to its right on computers, above it on phones. The camera looks straight at it and shifts its lens instead of turning, so the frame stays level; the picture sits on a dark mat inside the frame. Whenever the camera stops, the still view is drawn once more at the screen's full sharpness. When the doors open, it tilts so both sit above the card. With **Settings → Floor names on the glass of the tower** off, the cabin stays in the middle.

Both versions use the same HTML texts, the same lift buttons 1–9 and the same keyboard support. Scrolling is never blocked.

## Admin panel

- **Address:** `/admin`. No link on the site points there. It is marked `noindex` (header and meta tag) and is not in the sitemap or robots.txt.
- **Hidden gestures** on the site:
  - type **`admin`** anywhere on the page (outside form fields);
  - or tap the **©** sign in the footer **5 times** quickly.
- **Accounts are created in the terminal only.** There is no sign-up page.

  ```bash
  npm run admin:create                 # new account
  npm run admin:password -- <name>     # new password for an account
  npm run admin:list                   # list accounts
  npm run admin:remove -- <name>       # remove an account
  ```

  Add `--data <folder>` to work on another data folder.

### What each section changes

| Section | What it changes on the site |
|---|---|
| **First screen** | Small line above the headline, the headline (the second sentence uses the orange–pink gradient), the text under it, the hint at the bottom (three versions: computers and phones while scrolling up rides up, and one for scrolling down), and the search title and description. |
| **Floors** | One floor per service. Name (lift buttons, floor display, tower sign, form list), small line, title, text, groups of tags, numbered steps, bullet points, text blocks, small print, and search texts. You can move a floor up or down, or hide it (the lift skips it). |
| **Office 902** | The contact floor: title and intro; the labels for address, phone and website; the form's labels, buttons and messages after sending; search texts. |
| **Company** | Name (also in Arabic, for search engines) and logo, phone, address and map link, website, the people (now the CEO; more can be added) with their e-mails and a few lines about each (shown in Office 902; empty = nothing shown), the e-mail that receives the form, and the form service address. |
| **Menu & small words** | Menu items at the top, the footer © line, and short words used in several places ("Floor", "Lobby", "Going up", the lift panel's name…). |
| **Settings** | 3D tower on/off, 3D on phones on/off, which way to scroll (up or down) to ride up, floor names on the glass, how long the lift waits at each floor. Background: the Dubai video behind the tower on/off, the video for computers, the lighter copy for phones, its still picture, how much it is darkened, the city reflected in the glass on/off, and the brightness of the tower. The ground: the street, palms and park around the tower on/off, and how bright its street lights are. With the video off: the skyline photo and its blur. **Picture on the desk in Office 902**: the framed picture the camera ends on at floor 9 (any shape; empty = the header logo). Also these tools: **find and replace** across all texts, **earlier versions**, **password**, **recent activity**. |

### How saving works

- Every change shows up straight away in the **preview** on the right (phone or computer size). Click a text in the preview to jump to its field.
- A bar appears at the bottom as soon as you have unsaved changes: **Discard** / **Save** (or Ctrl+S). The site changes only when you save.
- Fields are checked as you type. A field with a problem says what is wrong, and the section and floor show a red badge.
- Every save keeps the previous version. The **last 30** can be put back from **Settings → Earlier versions**, as can "the original texts of the site".
- Images (PNG, JPEG, WebP, up to 5 MB) can be uploaded from any image field, and videos (MP4 or WebM, up to 40 MB) from the video fields.

## Where things live

| What | File |
|---|---|
| Original texts of every floor, lobby and contact | `src/content/floors.ts` |
| Company details, people, contact form address | `src/config/company.ts` |
| 3D settings | `src/config/scene.ts` |
| Content rules (lengths, required fields, allowed links) | `src/content/rules.ts` (used by both the panel and the server) |
| Colours and fonts | `src/index.css` (`--color-crimson #E8194A`, `--color-ruby #9B1515`, `--color-plum #6B1F4E`, `--color-night #12090F`, gradient `#F7931E → #D6247A`; Cormorant Garamond + Inter) |
| Background video of Dubai | `public/media/dubai-loop.mp4` (1920×1080, about 7 MB), `public/media/dubai-loop-720.mp4` (phones, about 3 MB), `public/media/dubai-loop.jpg` (its first frame) |
| The tower, the lift and their look | `src/three/` (`Tower.tsx`, `Elevator.tsx`, `glass.ts`, colours in `constants.ts`, lights in `Experience.tsx`) |
| The ground around the tower (street, plaza, park, canal promenade) | Plan: `scripts/ground/layout.mjs`. Built and lit in Blender by `scripts/ground/build.py`. Checked against the site's camera by `scripts/ground/check.mjs`. Result: `public/models/ground.glb`, `ground-*.webp`, `ground-*-zones.png`, `ground-*-albedo.png`, `ground-paint.png` and `src/three/ground/baked.json`. Drawn by `src/three/Ground.tsx` |
| Logo / icons / share image | `public/logo.png` (menu bar, ivory for the dark site), `public/logo-stacked.png` (full logo with the Arabic name, for dark backgrounds), `public/logo-original.png` (as in the company profile, for light backgrounds), `public/favicon.png`, `public/apple-touch-icon.png`, `public/og-image.jpg` (1200×630) |

The panel saves only the **differences** from these defaults, in `data/content.json`, and the site lays them over the defaults. When you change a default in the code, every text the panel never touched follows it.

### Contact form

The form checks name, e-mail and message, then:
- if a **form service address** is set (panel: *Company → Form service address*, or `VITE_CONTACT_ENDPOINT` in `.env` at build time; see `.env.example`), it posts JSON there (Formspree, Basin, a webhook…);
- otherwise it opens the visitor's e-mail app with the message ready, addressed to the form e-mail.

### Background video

- **What it is:** a 23-second loop of Business Bay at dusk, made with Kling. It starts and ends on the same picture, and the last second is cross-faded into the first, so the loop has no visible jump. It plays muted, behind the 3D tower (the tower is drawn on a transparent canvas over it). The waterline of the video stays on the horizon of the 3D scene as the camera moves.
- **Who sees the still picture instead:** visitors who save mobile data or asked their system for less motion, and everyone while the video loads.
- **Phones** (narrower than 768 px) load the lighter copy.
- **Changing it:** in *Settings*, upload another video in *Background video (computers)* and *Lighter copy of the video for phones*, and its first frame in *Still picture of the background* (or put the files in `public/media/` and type `/media/name.mp4`). Keep the horizon about a fifth of the way up from the bottom, as in the current video. To prepare a new one:

  ```bash
  ffmpeg -i new.mp4 -an -c:v libx264 -profile:v high -preset slow -crf 24 -g 96 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -movflags +faststart dubai-loop.mp4
  ffmpeg -i new.mp4 -an -vf scale=-2:720 -c:v libx264 -profile:v high -preset slow -crf 23 -g 96 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -movflags +faststart dubai-loop-720.mp4
  ffmpeg -i new.mp4 -frames:v 1 -q:v 4 dubai-loop.jpg
  ```

- **Safari and iPhone play a video only if the server answers byte-range requests** (status 206). The server here does. Any other host must too: without it, Safari shows only the still picture.

### The ground around the tower

- **What it is:** the tower stands on a raised granite and limestone podium in a Business Bay street block.
  - In front: the boulevard, with its median, crossings and street lamps.
  - Behind: a park with lawns, palm groves and lantern-lit walks.
  - At the far end: a promenade along the canal, with a row of lamps along the edge and a railing.
  The ground ends at the canal's stone edge, and the water of the video starts there. From the street the edge sits on the horizon, so no water shows. As the lift climbs, more and more water opens up above it.
- **How it is made:**
  - **Modelled from code in Blender.** No images or models are generated by AI.
  - **Lit with Cycles at dusk** by about 230 lamps (street lamps, lanterns, bollards, palm uplights, the canal lamps) and the dusk sky.
  - **Baked in two passes,** lamps and sky. That is why the panel's brightness slider can change the lamps alone.
  - **The baked files:**
    - `ground.glb`: the ground, and the props with their light in their colours;
    - `ground-near.webp` / `ground-far.webp`: lamp light, round the tower and further out;
    - `ground-near-sky.webp` / `ground-far-sky.webp`: sky light;
    - `ground-*-zones.png` and `ground-*-albedo.png`: which surface each spot is and its colour;
    - `ground-paint.png`: road markings;
    - `src/three/ground/baked.json`: their scales.
  - **Drawn without live lights,** so it stays fast on phones. The paving joints, asphalt grain and grass are drawn in the browser.
- **From the panel** (*Settings*):
  - *Street, palms and park around the tower* turns it off. The plain dark platform of earlier versions is shown instead.
  - *Brightness of the street lights* goes from 0.5× to 2×.
- **Changing the plan** (where roads, palms and lamps stand, the colours of the stone, the lamp power): edit `scripts/ground/layout.mjs`, then build again. You need Blender 5.2 or newer (an NVIDIA card makes it faster):

  ```bash
  node scripts/ground/layout.mjs
  node scripts/ground/check.mjs
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python scripts/ground/build.py
  ```

  - **`check.mjs`** replays the site's camera on 22 screen sizes, from the street to the office: computer screens, phones (upright and sideways), and real browser windows (a maximised browser loses the taskbar and its own bars, so 1920 × 1080 becomes 1920 × 953). It checks three things:
    - no palm, pole or lamp lands on the first screen's text or behind the lift buttons, during the fly-in and the ride, with and without a scroll bar. Allowed behind the buttons: the rows that run on behind them, the canal row and the back street's poles (the frosted glass hides them; which stretch it covers depends on the window). Single lamps and palms must stay clear on every window;
    - nothing tall stands between the camera and the tower;
    - the canal edge always covers the bottom of the video.

    It must end with "All checks pass" before you build. To check only some views, give a name: `node scripts/ground/check.mjs office`.
  - **`build.py`** sets each lamp group's power by itself, so the pools of light keep their brightness. It takes about 1½ minutes on an RTX 3090.
  - **Build options** (add them at the end):
    - `-- --quick`: a fast, noisier test build (about 30 seconds);
    - `-- --reuse-calib`: keeps the lamp powers of the last build;
    - `-- --no-bake`: only the shapes and maps, without light.
  - **After a build:** the files in `public/models/` and `src/three/ground/baked.json` are rewritten. The new version number in `baked.json` makes browsers download the new files.

## Server settings

Each setting is given as an argument or as an environment variable.

| Argument | Variable | Default | Meaning |
|---|---|---|---|
| `--port` | `PORT` | `8787` | Port |
| `--host` | `HOST` | `127.0.0.1` | Address to listen on |
| `--data` | `DATA_DIR` | `./data` | Saved texts, versions, accounts, uploads, activity (never served) |
| `--dist` | `DIST_DIR` | `./dist` | The only folder that is served |
| `--origin` | `PUBLIC_ORIGIN` | — | e.g. `https://easyfirst-ae.com`: the only origin allowed to make changes |
| `--trust-proxy` | `TRUST_PROXY` | `0` | `1` behind nginx/Caddy (real client IP and https) |
| `--cookie-secure` | `COOKIE_SECURE` | `auto` | `Secure` cookie flag: `auto`, `1` or `0` |
| `--session-idle` | `SESSION_IDLE_MINUTES` | `180` | Sign-out after this long without activity |
| `--session-max` | `SESSION_MAX_HOURS` | `12` | Sign-out after this long in any case |

### On a real server

1. Run `npm run build`, then copy the project (without `node_modules` and `data`) and run `npm run admin:create` there.
2. Start the server: `PUBLIC_ORIGIN=https://easyfirst-ae.com TRUST_PROXY=1 npm run serve`. Run it behind nginx or Caddy with HTTPS. Keep `HOST=127.0.0.1` so only the proxy reaches it.
3. **Back up the `data/` folder.** It holds everything changed from the panel.

### Versions

Every build raises the version by one (v0.0.1, v0.0.2, …). The number lives only in `package.json`. The panel shows it small under **Settings**, for example "Site version v0.0.3 · built on 13.11.2026". Visitors never see it.

`npm run vps` and `npm run demo` also keep a copy of each package in `versions/v<version>/`. Each build adds a line to `versions/versions.txt` with the version, date, file and size. Nothing there is deleted automatically, so any earlier build can be uploaded again. The folder stays out of git.

### On a VPS (Ubuntu, beside other sites such as ILUZ)

1. **DNS:** an `A` record for the domain (and one for `www`) pointing to the VPS's IP.
2. **Pack:** `npm run vps` builds the site and writes `easyfirst-vps.tar.gz` (site, server, `deploy/`; never `data/`).
3. **Upload** it to your home folder on the VPS (WinSCP, or `scp easyfirst-vps.tar.gz root@<IP>:~/`).
4. **Install** (first time and every update, same commands):

   ```bash
   rm -rf ~/easyfirst-new && mkdir ~/easyfirst-new && tar -xzf ~/easyfirst-vps.tar.gz -C ~/easyfirst-new
   sudo bash ~/easyfirst-new/deploy/install.sh easyfirst-ae.com
   ```

   It installs nginx and Node.js 22 if missing, puts the site in `/var/www/easyfirst`, runs it as the service `easyfirst` (user `easyfirst`, port 8787, reachable only through nginx), adds `/etc/nginx/sites-available/easyfirst` (www → the plain domain) and asks Let's Encrypt for HTTPS. It does not touch other sites. On an update it first copies `data/` to `/var/backups/easyfirst/` (last 10 kept) and never changes it.
5. **Account** (once; the password is typed hidden):

   ```bash
   cd /var/www/easyfirst && sudo -u easyfirst node server/manage.mjs create-admin
   ```

Useful: `sudo systemctl status easyfirst`, `sudo journalctl -u easyfirst -n 50`, `sudo systemctl restart easyfirst`. New password: `cd /var/www/easyfirst && sudo -u easyfirst node server/manage.mjs reset-password <name>`.

### Security

- **Passwords:** scrypt hashes with a random salt.
- **Sessions:**
  - a random token in an `HttpOnly`, `SameSite=Strict` cookie (`Secure` on HTTPS);
  - only the token's hash is kept;
  - sign-out after inactivity;
  - changing the password ends all other sessions.
- **Every change needs:** a valid session, the CSRF token and a same-origin request.
- **Wrong passwords:** after 5, both the IP and the account are blocked for 1 minute. The block doubles with each further mistake, up to 24 hours, and it survives restarts.
- **Checks on everything received:** types, lengths, ranges and links (only `https:`, `tel:`, `mailto:`). Images and videos are checked by their content, not their name.
- **Escaping:** saved texts are always escaped on the page. The site has no `innerHTML`.
- **Activity log** (`data/audit.log`): sign-ins, saves, restores, uploads and password changes. Passwords never appear in it, and neither does a user name that is not an account.

## Demo without a server (ILUZ)

```bash
npm run demo     # site + panel → dist-demo/, packed into easy-first-consulting-demo.zip
```

- **Uploading:** put `easy-first-consulting-demo.zip` on ILUZ as a **site** demo, or unpack it on any static host. It also works from a sub-folder.
  - `index.html` is at the top of the zip.
  - It holds only public files: no server code, no `data/` folder and no accounts.
  - `node scripts/pack-demo.mjs --out other.zip` packs it again under another name.
- **The site** is the same as the real one: the 3D tower (on phones too), the 2D version where needed, and the contact form.
- **The panel:**
  - the same hidden gestures open it (type `admin`, or tap © 5 times), at `admin.html`;
  - there is no password: the **Open the demo panel** button lets you in;
  - every section, the preview, find and replace, earlier versions and recent activity work as on the real site;
  - only the password card is different: it says the demo has nothing to change.
- **Where saves go:** only into the visitor's own browser (localStorage).
  - Nobody else sees them, and nothing is sent anywhere.
  - A save shows up at once in another open tab of the site.
  - Uploaded images are shrunk to at most 1600 px and kept in the browser too.
  - Videos cannot be kept in the browser: in the video fields, type a file of the site (such as `/media/dubai-loop.mp4`) or a link starting with `https://`.
- **Safari and iPhone:** the background video plays there only if the host answers byte-range requests. Where it does not, they show the still picture of the video; the rest of the site is the same.
- **Starting again:** Settings → Earlier versions → "Go back to the original texts". Clearing the site's data in the browser does the same.
- **The normal build** (`npm run build`) contains none of the demo code. In the code, demo branches sit behind `__DEMO__` (see `vite.config.ts`, `src/lib/demo.ts`, `src/admin/demo-backend.ts`).

## Notes

- The browser console shows one `THREE.Clock … deprecated` warning. It comes from inside `@react-three/fiber` and is harmless.
- The tower is built in code (three.js), not from a 3D model file: every floor, light and pane follows the floors of the panel. Its look (glass, ceiling lights, neon, colours, brightness) is in `src/three/`.
- `npm run typecheck` runs only the TypeScript check.
