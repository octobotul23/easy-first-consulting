/** Fades out the logo loader that index.html shows before the app is ready. */
export function hideBootLoader() {
  const el = document.getElementById('boot-loader');
  if (!el || el.classList.contains('is-done')) return;
  el.classList.add('is-done');
  setTimeout(() => el.remove(), 1000);
}

export function setMeta(selector: string, attr: 'content', value: string) {
  const el = document.head.querySelector<HTMLMetaElement>(selector);
  if (el) el.setAttribute(attr, value);
}
