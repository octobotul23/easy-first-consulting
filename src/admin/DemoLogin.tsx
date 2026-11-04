import { useState } from 'react';
import { media } from '../lib/demo';
import { api, ApiError, setCsrf, type SessionInfo } from './api';
import { demoKeepsChanges } from './demo-backend';

interface Props {
  onSignedIn: (s: SessionInfo) => void;
  overlay?: boolean;
}

/** The demo's way in: no user name and no password, only an explanation and one button. */
export default function DemoLogin({ onSignedIn, overlay }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const enter = async () => {
    setBusy(true);
    setError('');
    try {
      const s = await api<SessionInfo>('/api/login', { method: 'POST' });
      setCsrf(s.csrf);
      onSignedIn(s);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The demo did not open. Reload the page and try again.');
      setBusy(false);
    }
  };

  return (
    <div className={overlay ? 'login-overlay' : 'login-page'}>
      <section className="login-card" aria-labelledby="login-title">
        <img src={media('/logo-stacked.png')} alt="Easy First Management Consultancies" className="login-logo" width="196" height="92" />
        <h1 id="login-title">Site administration</h1>
        <p className="demo-badge">Demo</p>
        <p className="notice">
          Try the panel that runs this site. Change any text, the contact details, the people, the logo, the order of the floors or the 3D
          settings, then press Save and open the site to see it.
        </p>
        <p className="help">
          {demoKeepsChanges()
            ? 'Your changes stay in this browser only. Nobody else sees them, and nothing is sent anywhere.'
            : 'This browser does not keep site data, so your changes last until you close this page. Nobody else sees them.'}{' '}
          On the real site, the panel asks for a user name and a password.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="btn btn-primary" onClick={enter} disabled={busy} autoFocus>
          {busy ? 'Opening…' : 'Open the demo panel'}
        </button>
      </section>
    </div>
  );
}
