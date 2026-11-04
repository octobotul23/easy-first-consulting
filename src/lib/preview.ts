/**
 * The site shown inside the admin panel (/?preview in a frame of the same site).
 * The panel sends unsaved changes; the page sends back which text was clicked,
 * so the panel can jump to the field that changes it.
 */
import { goTo, stopIndex } from '../state/elevator';

export const IN_PREVIEW =
  typeof window !== 'undefined' && window.parent !== window && new URLSearchParams(location.search).has('preview');

const MSG = 'easyfirst:';

export function postToPanel(data: Record<string, unknown>) {
  window.parent.postMessage(data, location.origin);
}

/** Click on any text of the page → the panel opens its field. Links do not leave the preview. */
export function startPreviewBridge(): () => void {
  document.documentElement.classList.add('is-admin-preview');

  const onClick = (e: MouseEvent) => {
    const target = e.target as Element | null;
    const link = target?.closest('a[href]');
    if (link && !link.getAttribute('href')!.startsWith('#')) e.preventDefault();
    const field = target?.closest<HTMLElement>('[data-edit]');
    if (field?.dataset.edit) {
      e.preventDefault();
      postToPanel({ type: `${MSG}pick`, key: field.dataset.edit });
    }
  };
  // The panel asks to show the part being edited (a floor, the lobby or the contact office).
  const onMessage = (e: MessageEvent) => {
    if (e.origin !== location.origin || e.data?.type !== `${MSG}goto`) return;
    const i = stopIndex(String(e.data.key));
    if (i >= 0) goTo(i, { instant: true });
  };

  document.addEventListener('click', onClick, true);
  window.addEventListener('message', onMessage);
  return () => {
    document.removeEventListener('click', onClick, true);
    window.removeEventListener('message', onMessage);
  };
}
