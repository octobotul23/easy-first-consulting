/** true only in the demo build (`npm run demo`); written into the code by vite.config.ts, so dead branches drop out. */
declare const __DEMO__: boolean;
/** The site's version from package.json (e.g. "0.0.3"), written in at build time. Shown only in the panel. */
declare const __APP_VERSION__: string;
/** The day the build was made (e.g. "13.11.2026"). */
declare const __BUILD_DATE__: string;
