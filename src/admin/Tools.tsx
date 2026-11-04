import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import type { SiteContent } from '../content';
import type { Path } from '../content/rules';
import { api, ApiError, setCsrf, type AuditEntry, type SavedContent, type VersionMeta } from './api';
import { infoFor, placeOf } from './labels';

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/* ---------- Find and replace in every text ---------- */

interface Hit {
  path: Path;
  count: number;
}

/** Every text of the site, except internal ids. */
function texts(v: unknown, path: Path, out: { path: Path; value: string }[]) {
  if (typeof v === 'string') {
    if (path[path.length - 1] !== 'id' && !infoFor(path).hidden) out.push({ path, value: v });
  } else if (Array.isArray(v)) v.forEach((x, i) => texts(x, [...path, i], out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) texts(x, [...path, k], out);
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function FindReplace({ draft, setDraft }: { draft: SiteContent; setDraft: (c: SiteContent) => void }) {
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [exact, setExact] = useState(false);
  const [done, setDone] = useState('');

  const re = useMemo(() => (find ? new RegExp(escapeRe(find), exact ? 'g' : 'gi') : null), [find, exact]);
  const hits: Hit[] = useMemo(() => {
    if (!re) return [];
    return texts(draft, [], [])
      .map((t) => ({ path: t.path, count: t.value.match(re)?.length ?? 0 }))
      .filter((h) => h.count > 0);
  }, [draft, re]);
  const total = hits.reduce((n, h) => n + h.count, 0);
  const floorLabel = (i: number) => draft.floors[i]?.label || `Floor ${i + 1}`;

  const run = () => {
    if (!re || !total) return;
    let next = draft;
    for (const h of hits) {
      const set = (obj: unknown, p: Path): unknown => {
        if (!p.length) return (obj as string).replace(re, () => replace);
        const [head, ...rest] = p;
        if (Array.isArray(obj)) return obj.map((x, i) => (i === head ? set(x, rest) : x));
        return { ...(obj as object), [head]: set((obj as Record<string, unknown>)[head], rest) };
      };
      next = set(next, h.path) as SiteContent;
    }
    setDraft(next);
    setDone(`Replaced ${total} ${total === 1 ? 'time' : 'times'}. Check the preview, then press Save.`);
  };

  return (
    <section className="card tool" aria-labelledby="fr-title">
      <h3 id="fr-title">Find and replace in all texts</h3>
      <p className="help">Change a word, a phone number or a name everywhere at once. Nothing reaches the site until you press Save.</p>
      <div className="tool-grid">
        <div className="field">
          <label htmlFor="fr-find">Find</label>
          <input
            id="fr-find"
            value={find}
            onChange={(e) => {
              setFind(e.target.value);
              setDone('');
            }}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor="fr-replace">Replace with</label>
          <input id="fr-replace" value={replace} onChange={(e) => setReplace(e.target.value)} autoComplete="off" />
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={exact} onChange={(e) => setExact(e.target.checked)} /> Capital letters must match exactly
      </label>
      {find && (
        <p className="tool-result" aria-live="polite">
          {total ? `Found ${total} ${total === 1 ? 'time' : 'times'}, in ${hits.length} ${hits.length === 1 ? 'place' : 'places'}:` : 'Not found anywhere.'}
        </p>
      )}
      {hits.length > 0 && (
        <ul className="hits">
          {hits.slice(0, 12).map((h) => (
            <li key={h.path.join('.')}>{placeOf(h.path, floorLabel)}</li>
          ))}
          {hits.length > 12 && <li>…and {hits.length - 12} more</li>}
        </ul>
      )}
      <button type="button" className="btn" disabled={!total} onClick={run}>
        Replace {total ? `${total} ${total === 1 ? 'time' : 'times'}` : ''}
      </button>
      {done && (
        <p className="ok" role="status">
          {done}
        </p>
      )}
    </section>
  );
}

/* ---------- Saved versions ---------- */

interface VersionsProps {
  currentVersion: number;
  dirty: boolean;
  onRestored: (saved: SavedContent) => void;
}

export function Versions({ currentVersion, dirty, onRestored }: VersionsProps) {
  const [list, setList] = useState<VersionMeta[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(0);

  useEffect(() => {
    let live = true;
    api<{ versions: VersionMeta[] }>('/api/admin/versions')
      .then((d) => live && setList(d.versions))
      .catch((e: ApiError) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [currentVersion]);

  const restore = async (v: number, label: string) => {
    const lose = dirty ? '\n\nYour unsaved changes will be lost.' : '';
    if (!window.confirm(`Put back ${label}? The site changes right away.\n\nWhat the site shows now is kept as a version too, so you can come back to it.${lose}`)) return;
    setBusy(v || -1);
    setError('');
    try {
      onRestored(await api<SavedContent>(`/api/admin/versions/${v}/restore`, { method: 'POST' }));
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(0);
    }
  };

  return (
    <section className="card tool" aria-labelledby="ver-title">
      <h3 id="ver-title">Earlier versions</h3>
      <p className="help">Every save keeps the version before it (the last 30). Put one back if something went wrong.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!list && !error && <p className="help">Loading…</p>}
      {list && list.length === 0 && <p className="empty">No earlier versions yet. They appear after the first save.</p>}
      {list && list.length > 0 && (
        <ul className="versions">
          {list.map((v) => (
            <li key={v.version}>
              <div>
                <strong>Version {v.version}</strong>
                <span className="meta">
                  {when(v.savedAt)}
                  {v.user ? ` · ${v.user}` : ''}
                  {v.note ? ` · ${v.note}` : ''}
                </span>
              </div>
              <button type="button" className="btn btn-small" disabled={!!busy} onClick={() => restore(v.version, `version ${v.version}`)}>
                {busy === v.version ? 'Restoring…' : 'Put back'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn-quiet" disabled={!!busy} onClick={() => restore(0, 'the original texts of the site (as delivered)')}>
        {busy === -1 ? 'Restoring…' : 'Go back to the original texts'}
      </button>
    </section>
  );
}

/* ---------- Password ---------- */

/** The demo has no accounts: this card says what the real panel offers here. */
export function DemoPasswordNote() {
  return (
    <section className="card tool" aria-labelledby="pw-title">
      <h3 id="pw-title">Change your password</h3>
      <p className="help">
        On the real site you change your password here. The demo has no accounts and no passwords, so there is nothing to change.
      </p>
    </section>
  );
}

export function PasswordForm({ user }: { user: string }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<{ field: string; text: string } | null>(null);
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setOk('');
    if (!current) return setError({ field: 'current', text: 'Enter your current password.' });
    if (next.length < 12) return setError({ field: 'next', text: 'The new password needs at least 12 characters.' });
    if (next.toLowerCase().includes(user.toLowerCase())) return setError({ field: 'next', text: 'The new password must not contain your user name.' });
    if (next !== again) return setError({ field: 'again', text: 'The two new passwords are different. Type them again.' });
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ csrf: string }>('/api/admin/password', { method: 'POST', json: { current, next } });
      setCsrf(r.csrf);
      setCurrent('');
      setNext('');
      setAgain('');
      setOk('Password changed. Any other device signed in with this account has been signed out.');
    } catch (err) {
      const ae = err as ApiError;
      setError({ field: ae.field ?? '', text: ae.message });
    } finally {
      setBusy(false);
    }
  };

  const err = (f: string) =>
    error?.field === f ? (
      <p className="error" role="alert">
        {error.text}
      </p>
    ) : null;

  return (
    <form className="card tool" onSubmit={submit} noValidate aria-labelledby="pw-title">
      <h3 id="pw-title">Change your password</h3>
      <input type="text" name="username" autoComplete="username" value={user} readOnly hidden />
      <div className="field">
        <label htmlFor="pw-current">Current password</label>
        <input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        {err('current')}
      </div>
      <div className="field">
        <label htmlFor="pw-next">New password</label>
        <p className="help" id="pw-next-help">
          At least 12 characters. A few unrelated words make a strong password that is easy to remember.
        </p>
        <input id="pw-next" type="password" autoComplete="new-password" aria-describedby="pw-next-help" value={next} onChange={(e) => setNext(e.target.value)} />
        {err('next')}
      </div>
      <div className="field">
        <label htmlFor="pw-again">New password again</label>
        <input id="pw-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        {err('again')}
      </div>
      {error && !['current', 'next', 'again'].includes(error.field) && (
        <p className="error" role="alert">
          {error.text}
        </p>
      )}
      <button type="submit" className="btn" disabled={busy}>
        {busy ? 'Changing…' : 'Change password'}
      </button>
      {ok && (
        <p className="ok" role="status">
          {ok}
        </p>
      )}
    </form>
  );
}

/* ---------- Recent activity ---------- */

function describe(e: AuditEntry): string {
  switch (e.action) {
    case 'login.ok':
      return 'Signed in';
    case 'login.fail':
      return `Wrong password${e.user ? ` for “${e.user}”` : ''}`;
    case 'login.blocked':
      return 'Sign-in blocked after too many wrong passwords';
    case 'logout':
      return 'Signed out';
    case 'content.save':
      return `Saved changes (version ${e.version})`;
    case 'content.restore':
      return e.from ? `Put back version ${e.from}` : 'Went back to the original texts';
    case 'password.change':
      return 'Changed the password';
    case 'password.change.fail':
      return 'Wrong current password when changing it';
    case 'password.reset':
      return 'New password set in the terminal';
    case 'account.create':
      return 'Account created in the terminal';
    case 'account.remove':
      return 'Account removed in the terminal';
    case 'upload':
      return 'Uploaded an image';
    default:
      return e.action;
  }
}

export function Activity() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState('');
  const load = () => {
    setError('');
    api<{ entries: AuditEntry[] }>('/api/admin/audit')
      .then((d) => setEntries(d.entries))
      .catch((e: ApiError) => setError(e.message));
  };
  useEffect(load, []);

  return (
    <section className="card tool" aria-labelledby="act-title">
      <div className="tool-head">
        <h3 id="act-title">Recent activity</h3>
        <button type="button" className="btn btn-small btn-quiet" onClick={load}>
          Refresh
        </button>
      </div>
      <p className="help">Sign-ins, saves, restores and password changes, newest first.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {entries && entries.length === 0 && <p className="empty">Nothing yet.</p>}
      {entries && entries.length > 0 && (
        <ul className="activity">
          {entries.slice(0, 60).map((e, i) => (
            <li key={i} className={e.action.includes('fail') || e.action.includes('blocked') ? 'warn' : ''}>
              <span className="meta">{when(e.at)}</span>
              <span>
                {describe(e)}
                {e.user && !e.action.startsWith('login.fail') ? ` · ${e.user}` : ''}
              </span>
              {e.ip && <span className="meta ip">{e.ip}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
