import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { defaultContent, mergeContent, type SiteContent } from '../content';
import { validateContent, type Issue, type Path } from '../content/rules';
import { api, ApiError, type SavedContent } from './api';
import { EditorContext, keyOf, pathFromEditKey, setAt, type Editor } from './editor';
import { Field, Fields } from './fields';
import { Preview } from './Preview';
import { Activity, DemoPasswordNote, FindReplace, PasswordForm, Versions } from './Tools';
import { SITE_HREF, media } from '../lib/demo';

type SectionId = 'lobby' | 'floors' | 'contact' | 'company' | 'words' | 'settings';

const SECTIONS: { id: SectionId; title: string; intro: string; roots: string[] }[] = [
  { id: 'lobby', title: 'First screen', intro: 'What visitors see first: the tower at sunset, the headline and the hint to scroll.', roots: ['lobby'] },
  { id: 'floors', title: 'Floors', intro: 'One floor per service. Change the texts, move a floor up or down, or hide it.', roots: ['floors'] },
  { id: 'contact', title: 'Office 902', intro: 'The top floor: the contact office, its details and the form.', roots: ['contact'] },
  { id: 'company', title: 'Company', intro: 'Name, logo, phone, address, the people in the contact office and where form messages go.', roots: ['company'] },
  { id: 'words', title: 'Menu & small words', intro: 'The menu at the top and short words used in several places.', roots: ['nav', 'common'] },
  { id: 'settings', title: 'Settings', intro: 'The 3D tower and the Dubai video behind it, tools for many texts at once, earlier versions and your password.', roots: ['settings'] },
];

const SECTION_OF: Record<string, SectionId> = {
  lobby: 'lobby',
  floors: 'floors',
  contact: 'contact',
  company: 'company',
  nav: 'words',
  common: 'words',
  settings: 'settings',
};

interface Base extends SavedContent {
  content: SiteContent;
}

type Notice = { kind: 'ok' | 'error'; text: string } | null;

export function Panel({ user, onSignOut }: { user: string; onSignOut: () => void }) {
  const [base, setBase] = useState<Base | null>(null);
  const [draft, setDraft] = useState<SiteContent | null>(null);
  const [loadError, setLoadError] = useState('');
  const [section, setSection] = useState<SectionId>('lobby');
  const [floorIdx, setFloorIdx] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [saving, setSaving] = useState(false);
  const [serverIssues, setServerIssues] = useState<Issue[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);

  const adopt = useCallback((r: SavedContent) => {
    const full = mergeContent(defaultContent, r.content);
    setBase({ ...r, content: full });
    setDraft(full);
    setServerIssues([]);
  }, []);

  const load = useCallback(() => {
    setLoadError('');
    api<SavedContent>('/api/admin/content')
      .then(adopt)
      .catch((e: ApiError) => setLoadError(e.message));
  }, [adopt]);
  useEffect(load, [load]);

  /* ---------- Checks (same rules as the server) ---------- */

  const issues = useMemo(() => {
    if (!draft) return [];
    const all = [...validateContent(draft, defaultContent).issues, ...serverIssues];
    const seen = new Set<string>();
    return all.filter((i) => !seen.has(keyOf(i.path)) && seen.add(keyOf(i.path)));
  }, [draft, serverIssues]);
  const errors = useMemo(() => new Map(issues.map((i) => [keyOf(i.path), i.message])), [issues]);

  const dirty = useMemo(() => !!draft && !!base && JSON.stringify(draft) !== JSON.stringify(base.content), [draft, base]);

  const set = useCallback((path: Path, value: unknown) => {
    setDraft((d) => (d ? setAt(d, path, value) : d));
    setServerIssues([]);
    setNotice(null);
  }, []);

  const upload = useCallback(async (file: File) => (await api<{ url: string }>('/api/admin/upload', { method: 'POST', file })).url, []);

  const editor: Editor | null = useMemo(() => (draft ? { draft, set, errors, upload } : null), [draft, set, errors, upload]);

  /* ---------- Going to a field (from the preview or an error) ---------- */

  const jumpTo = useCallback((path: Path) => {
    setSection(SECTION_OF[String(path[0])] ?? 'lobby');
    if (path[0] === 'floors' && typeof path[1] === 'number') setFloorIdx(path[1]);
    setPendingFocus(keyOf(path));
  }, []);

  useEffect(() => {
    if (!pendingFocus) return;
    const raf = requestAnimationFrame(() => {
      let key = pendingFocus;
      let el: HTMLElement | null = null;
      while (key && !el) {
        el = document.querySelector<HTMLElement>(`[data-path="${CSS.escape(key)}"]`);
        if (!el) key = key.includes('.') ? key.slice(0, key.lastIndexOf('.')) : '';
      }
      if (el) {
        for (let p: HTMLElement | null = el; p; p = p.parentElement) if (p instanceof HTMLDetailsElement) p.open = true;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.querySelector<HTMLElement>('input:not([hidden]), textarea, [role="switch"]')?.focus({ preventScroll: true });
        el.classList.remove('flash');
        void el.offsetWidth;
        el.classList.add('flash');
      }
      setPendingFocus(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [pendingFocus, section, floorIdx]);

  const onPick = useCallback(
    (editKey: string) => {
      if (!draft) return;
      const path = pathFromEditKey(editKey, draft);
      if (!path) return;
      setPreviewOpen(false);
      jumpTo(path);
    },
    [draft, jumpTo],
  );

  /* ---------- Save / discard ---------- */

  const save = async () => {
    if (!draft || !base || saving) return;
    if (issues.length) {
      setNotice({
        kind: 'error',
        text: `${issues.length === 1 ? 'One field needs' : `${issues.length} fields need`} fixing before saving. They are marked in red.`,
      });
      jumpTo(issues[0].path);
      return;
    }
    setSaving(true);
    try {
      const r = await api<SavedContent>('/api/admin/content', { method: 'PUT', json: { baseVersion: base.version, content: draft } });
      adopt(r);
      setNotice({ kind: 'ok', text: r.unchanged ? 'Nothing new to save.' : 'Saved. The site shows the changes now.' });
    } catch (e) {
      const ae = e as ApiError;
      if (ae.status === 422 && ae.issues.length) {
        setServerIssues(ae.issues);
        jumpTo(ae.issues[0].path);
      }
      setNotice({
        kind: 'error',
        text: ae.status === 401 ? 'You were signed out. Sign in again, then press Save — your changes are still here.' : ae.message,
      });
    } finally {
      setSaving(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  const discard = () => {
    if (!base) return;
    if (!window.confirm('Throw away all changes made since the last save?')) return;
    setDraft(base.content);
    setServerIssues([]);
    setNotice(null);
  };

  const signOut = async () => {
    if (dirty && !window.confirm('You have unsaved changes. Sign out and lose them?')) return;
    try {
      await api('/api/logout', { method: 'POST' });
    } catch {
      /* signed out anyway */
    }
    onSignOut();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // A success message disappears by itself.
  useEffect(() => {
    if (notice?.kind !== 'ok') return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  /* ---------- Layout ---------- */

  if (loadError) {
    return (
      <div className="login-page">
        <div className="login-card">
          <h1>Site administration</h1>
          <p className="error" role="alert">
            {loadError}
          </p>
          <button type="button" className="btn btn-primary" onClick={load}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!draft || !base || !editor) return <div className="login-page">Loading the texts…</div>;

  const current = SECTIONS.find((s) => s.id === section)!;
  const badCount = (roots: string[]) => issues.filter((i) => roots.includes(String(i.path[0]))).length;
  const floor = draft.floors[Math.min(floorIdx, draft.floors.length - 1)];
  const focus = section === 'lobby' ? 'lobby' : section === 'floors' ? floor?.id ?? null : section === 'contact' || section === 'company' ? 'contact' : null;

  return (
    <EditorContext.Provider value={editor}>
      <div className={`adm ${previewOpen ? 'preview-open' : ''} ${dirty || notice ? 'has-bar' : ''}`}>
        <header className="adm-top">
          <a className="adm-brand" href={SITE_HREF} target="_blank" rel="noopener noreferrer" title="Open the site in a new tab">
            <img src={media(draft.company.logo)} alt={draft.company.brand} height="30" />
            <em>{__DEMO__ ? 'admin · demo' : 'admin'}</em>
          </a>
          <div className="adm-top-actions">
            <button type="button" className="btn btn-small preview-toggle" onClick={() => setPreviewOpen(true)}>
              Preview
            </button>
            <a className="btn btn-small btn-quiet hide-sm" href={SITE_HREF} target="_blank" rel="noopener noreferrer">
              Open the site ↗
            </a>
            <span className="who" title="Signed in as">
              {user}
            </span>
            <button type="button" className="btn btn-small btn-quiet" onClick={signOut}>
              Sign out
            </button>
          </div>
        </header>

        <nav className="adm-nav" aria-label="Parts of the site">
          {SECTIONS.map((s) => {
            const bad = badCount(s.roots);
            return (
              <button key={s.id} type="button" aria-current={section === s.id ? 'page' : undefined} onClick={() => setSection(s.id)}>
                {s.title}
                {bad > 0 && (
                  <span className="badge-bad" aria-label={`${bad} to fix`}>
                    {bad}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <main className="adm-main" id="main">
          {__DEMO__ && (
            <p className="demo-note">
              <strong>Demo.</strong> Your saves stay in this browser only. To start again: Settings → Earlier versions → “Go back to the original texts”.
            </p>
          )}
          <div className="section-head">
            <h2>{current.title}</h2>
            <p>{current.intro}</p>
          </div>

          {section === 'lobby' && (
            <div className="card">
              <Fields path={['lobby']} />
            </div>
          )}

          {section === 'floors' && <FloorsSection draft={draft} set={set} floorIdx={floorIdx} setFloorIdx={setFloorIdx} badKeys={issues} openSection={setSection} />}

          {section === 'contact' && (
            <div className="card">
              <Fields path={['contact']} />
            </div>
          )}

          {section === 'company' && (
            <div className="card">
              <Fields path={['company']} />
            </div>
          )}

          {section === 'words' && (
            <>
              <div className="card">
                <Field path={['nav']} />
              </div>
              <div className="card">
                <Field path={['common']} />
              </div>
            </>
          )}

          {section === 'settings' && (
            <>
              <div className="card">
                <Field path={['settings']} />
              </div>
              <FindReplace draft={draft} setDraft={(c) => (setDraft(c), setNotice(null))} />
              <Versions currentVersion={base.version} dirty={dirty} onRestored={(r) => (adopt(r), setNotice({ kind: 'ok', text: `${r.note}. The site shows it now.` }))} />
              {__DEMO__ ? <DemoPasswordNote /> : <PasswordForm user={user} />}
              <Activity key={base.version} />
              <p className="adm-version">
                Site version v{__APP_VERSION__} · built on {__BUILD_DATE__}
              </p>
            </>
          )}
        </main>

        <aside className="adm-side" aria-label="Preview">
          <button type="button" className="btn btn-small preview-close" onClick={() => setPreviewOpen(false)}>
            Close the preview
          </button>
          <Preview draft={draft} focus={focus} onPick={onPick} />
        </aside>

        {(dirty || notice) && (
          <div className={`savebar ${dirty ? 'is-dirty' : ''}`} role="region" aria-label="Unsaved changes">
            <p className={`savebar-text ${notice?.kind ?? ''}`} aria-live="polite">
              {notice
                ? notice.text
                : issues.length
                  ? `Unsaved changes · ${issues.length} ${issues.length === 1 ? 'field' : 'fields'} to fix`
                  : 'You have unsaved changes. The site shows them only after you save.'}
            </p>
            {dirty && (
              <div className="savebar-actions">
                <button type="button" className="btn btn-quiet" onClick={discard} disabled={saving}>
                  Discard
                </button>
                <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </EditorContext.Provider>
  );
}

/* ---------- Floors: the building, top floor first ---------- */

interface FloorsProps {
  draft: SiteContent;
  set: (path: Path, value: unknown) => void;
  floorIdx: number;
  setFloorIdx: (i: number) => void;
  badKeys: Issue[];
  openSection: (id: SectionId) => void;
}

function FloorsSection({ draft, set, floorIdx, setFloorIdx, badKeys, openSection }: FloorsProps) {
  const floors = draft.floors;
  const idx = Math.min(floorIdx, floors.length - 1);
  const selected = floors[idx];
  const top = floors.length + 1;

  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= floors.length) return;
    const next = floors.slice();
    [next[i], next[j]] = [next[j], next[i]];
    set(['floors'], next);
    setFloorIdx(j);
  };

  const order = floors.map((f, i) => ({ f, i })).reverse();

  return (
    <div className="floors">
      <div className="floor-list" role="group" aria-label="Floors, top to bottom">
        <button type="button" className="floor-fixed" onClick={() => openSection('contact')} title="The contact floor is changed in the Office 902 section">
          <span className="no">{top}</span>
          <span className="name">{draft.contact.label}</span>
          <span className="go">Edit ›</span>
        </button>
        <ol>
          {order.map(({ f, i }) => {
            const bad = badKeys.filter((k) => k.path[0] === 'floors' && k.path[1] === i).length;
            return (
              <li key={f.id} className={i === idx ? 'is-selected' : ''}>
                <button type="button" className="floor-pick" aria-current={i === idx ? 'true' : undefined} onClick={() => setFloorIdx(i)}>
                  <span className="no">{i + 1}</span>
                  <span className="name">{f.label || '(no name)'}</span>
                  {!f.visible && <span className="tag">Hidden</span>}
                  {bad > 0 && <span className="badge-bad">{bad}</span>}
                </button>
                <span className="floor-move">
                  <button type="button" className="icon-btn" onClick={() => move(i, 1)} disabled={i === floors.length - 1} aria-label={`Move ${f.label} one floor up`} title="One floor up">
                    ↑
                  </button>
                  <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${f.label} one floor down`} title="One floor down">
                    ↓
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
        <button type="button" className="floor-fixed" onClick={() => openSection('lobby')} title="The ground floor is changed in the First screen section">
          <span className="no">0</span>
          <span className="name">{draft.common.lobbyLabel}</span>
          <span className="go">Edit ›</span>
        </button>
      </div>

      <div className="card floor-editor" key={selected.id}>
        <h3 className="floor-heading">
          <span className="no">Floor {idx + 1}</span> {selected.label}
          {!selected.visible && <span className="tag">Hidden</span>}
        </h3>
        <Fields path={['floors', idx]} />
      </div>
    </div>
  );
}
