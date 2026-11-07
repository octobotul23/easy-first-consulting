/**
 * Builds plain HTML from the site content, used at build time (see vite.config.ts):
 *  - renderSeoHead: <title>, description, canonical, Open Graph, Twitter and JSON-LD
 *  - renderStaticBody: every floor's text as real headings/paragraphs inside #root
 * Pure string functions (no DOM), everything escaped.
 */
import type { FloorContent, SiteContent } from './types.ts';

const esc = (s: string) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const origin = (c: SiteContent) => c.company.website.replace(/\/+$/, '');

export function renderSeoHead(c: SiteContent): string {
  const site = origin(c);
  const { title, description } = c.lobby.seo;
  const image = `${site}/og-image.jpg`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'ProfessionalService',
    name: c.company.legalName,
    alternateName: [c.company.brand, c.company.nameArabic].filter(Boolean),
    url: `${site}/`,
    logo: /^https:/.test(c.company.logo) ? c.company.logo : `${site}${c.company.logo}`,
    image,
    description,
    telephone: c.company.phone,
    email: c.company.formEmail,
    address: {
      '@type': 'PostalAddress',
      streetAddress: c.company.address.slice(0, 2).join(', '),
      addressLocality: 'Business Bay, Dubai',
      addressCountry: 'AE',
    },
    areaServed: 'Worldwide',
    employee: c.company.people.map((p) => ({ '@type': 'Person', name: p.name, jobTitle: p.role, email: p.email, ...(p.bio ? { description: p.bio } : {}) })),
    knowsAbout: c.floors.filter((f) => f.visible).map((f) => f.label),
  };
  // JSON inside <script>: "<" escaped so no text can close the tag.
  const json = JSON.stringify(ld).replace(/</g, '\\u003c');
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<link rel="canonical" href="${esc(site)}/" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(c.company.legalName)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(site)}/" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
    `<script type="application/ld+json">${json}</script>`,
  ].join('\n    ');
}

function floorHtml(f: FloorContent, level: number, c: SiteContent): string {
  const parts = [
    `<p>${esc(c.common.floorWord)} ${level} · ${esc(f.kicker)}</p>`,
    `<h2>${esc(f.title)}</h2>`,
    f.intro && `<p>${esc(f.intro)}</p>`,
    ...f.facts.map((x) => `<p><strong>${esc(x.label)}:</strong> ${x.items.map(esc).join(', ')}</p>`),
    f.steps.items.length ? `<p><strong>${esc(f.steps.label)}:</strong> ${f.steps.items.map(esc).join(' → ')}</p>` : '',
    f.points.length ? `<ul>${f.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '',
    ...f.blocks.map((b) => `<h3>${esc(b.heading)}</h3><p>${esc(b.text)}</p>`),
    f.note && `<p>${esc(f.note)}</p>`,
  ];
  return `<section id="${esc(f.id)}">${parts.filter(Boolean).join('')}</section>`;
}

export function renderStaticBody(c: SiteContent): string {
  const floors = c.floors.map((f, i) => (f.visible ? floorHtml(f, i + 1, c) : '')).join('');
  const people = c.company.people
    .map((p) => `<li>${esc(p.role)}: ${esc(p.name)} — <a href="mailto:${esc(p.email)}">${esc(p.email)}</a>${p.bio ? `<p>${esc(p.bio)}</p>` : ''}</li>`)
    .join('');
  const tel = c.company.phone.replace(/[^\d+]/g, '');
  return `<div class="seo-static">
<header><p>${esc(c.lobby.eyebrow)}</p><h1>${esc(c.lobby.title)}</h1><p>${esc(c.lobby.subtitle)}</p></header>
<main>${floors}
<section id="contact"><p>${esc(c.contact.kicker)}</p><h2>${esc(c.contact.title)}</h2><p>${esc(c.contact.intro)}</p>
<address>${c.company.address.map(esc).join('<br>')}</address>
<p><a href="tel:${esc(tel)}">${esc(c.company.phone)}</a> · <a href="${esc(c.company.website)}">${esc(c.company.website)}</a></p>
<ul>${people}</ul></section></main>
<footer><p>© ${new Date().getFullYear()} ${esc(c.common.copyright)}</p></footer>
</div>`;
}
