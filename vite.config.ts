import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defaultContent } from './src/content/index.ts';
import { renderSeoHead, renderStaticBody } from './src/content/static-html.ts';

const root = fileURLToPath(new URL('.', import.meta.url));

/** The site's version (package.json, raised by scripts/bump-version.mjs on every build) and the build's day. */
const VERSION = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;
const BUILT = new Date().toLocaleDateString('en-GB').replaceAll('/', '.');

/**
 * Puts real, crawlable HTML into index.html at build time (meta tags, Open Graph,
 * JSON-LD and every floor's text), generated from the same data files the app uses.
 * React replaces the static body on load; crawlers without JavaScript still read it.
 */
function seoStatic(): Plugin {
  return {
    name: 'easyfirst-seo-static',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (!ctx.filename.endsWith('index.html')) return html;
        // The markers let the Node server re-render both parts with the saved content.
        return html
          .replace('<!--SEO_HEAD-->', `<!--seo-head-->${renderSeoHead(defaultContent)}<!--/seo-head-->`)
          .replace('<!--SEO_STATIC-->', `<!--seo-body-->${renderStaticBody(defaultContent)}<!--/seo-body-->`);
      },
    },
  };
}

/**
 * Outside the demo build, src/lib/demo-content.ts is replaced by an empty stand-in, so the
 * content rules it needs stay in the panel's bundle and never reach the public site's.
 */
function demoContentOnlyInDemo(mode: string): Plugin {
  const STUB = '\0easyfirst-demo-content-off';
  return {
    name: 'easyfirst-demo-content',
    enforce: 'pre',
    resolveId(source) {
      return mode !== 'demo' && /(^|\/)demo-content(\.ts)?$/.test(source) ? STUB : null;
    },
    load(id) {
      return id === STUB ? 'export const readDemoContent = () => null;' : null;
    },
  };
}

/** In development, /admin opens admin.html (in production the Node server does this). */
function adminRoute(): Plugin {
  return {
    name: 'easyfirst-admin-route',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/admin' || req.url === '/admin/') req.url = '/admin.html';
        next();
      });
    },
  };
}

export default defineConfig(({ isSsrBuild, mode }) => ({
  // `npm run demo` (mode "demo"): site + panel with no server, files found relative to the page,
  // so the demo also works from a sub-folder (e.g. on ILUZ). Built into dist-demo/.
  base: mode === 'demo' ? './' : '/',
  // A literal true/false in every file that asks (see src/globals.d.ts): demo code drops out of the normal build.
  define: {
    __DEMO__: JSON.stringify(mode === 'demo' && !isSsrBuild),
    __APP_VERSION__: JSON.stringify(VERSION),
    __BUILD_DATE__: JSON.stringify(BUILT),
  },
  plugins: isSsrBuild ? [] : [react(), tailwindcss(), seoStatic(), adminRoute(), demoContentOnlyInDemo(mode)],
  build: isSsrBuild
    ? {
        // `vite build --ssr src/server/entry.ts`: content code for the Node server (not public).
        outDir: 'server/build',
        emptyOutDir: true,
        copyPublicDir: false,
        rollupOptions: { output: { entryFileNames: 'entry.js' } },
      }
    : {
        outDir: mode === 'demo' ? 'dist-demo' : 'dist',
        rollupOptions: {
          input: {
            main: `${root}index.html`,
            admin: `${root}admin.html`,
          },
        },
        chunkSizeWarningLimit: 1400,
      },
  server: {
    port: 5173,
    // Lets the dev site and the admin panel talk to the optional Node server (npm run serve).
    proxy: {
      '/uploads': `http://127.0.0.1:${process.env.PORT || 8787}`,
      '/api': {
        target: `http://127.0.0.1:${process.env.PORT || 8787}`,
        configure(proxy) {
          // Node server not started: the site quietly keeps its defaults; the panel gets a clear message.
          proxy.on('error', (_err, req, res) => {
            if (!('writeHead' in res) || res.headersSent) return;
            if (req.method === 'GET' && req.url?.startsWith('/api/content')) {
              res.writeHead(204).end();
              return;
            }
            res
              .writeHead(503, { 'Content-Type': 'application/json' })
              .end(JSON.stringify({ error: 'The admin server is not running. Start it with: npm run serve' }));
          });
        },
      },
    },
  },
}));
