/**
 * Bundle for the Node server (built with `vite build --ssr`, see package.json):
 * the same defaults, merge, validation and SEO rendering the site and the panel use.
 */
export { defaultContent, mergeContent, buildStops, contactLevel } from '../content';
export { validateContent, diffContent } from '../content/rules';
export { renderSeoHead, renderStaticBody } from '../content/static-html';
