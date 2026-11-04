import { useState, type SyntheticEvent } from 'react';
import { api, ApiError, setCsrf, type SessionInfo } from './api';

interface Props {
  onSignedIn: (s: SessionInfo) => void;
  /** Shown above the form, e.g. after being signed out while editing. */
  notice?: string;
  overlay?: boolean;
}

export function Login({ onSignedIn, notice, overlay }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Enter your user name and your password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const s = await api<SessionInfo>('/api/login', { method: 'POST', json: { username: username.trim(), password } });
      setCsrf(s.csrf);
      setPassword('');
      onSignedIn(s);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in did not work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={overlay ? 'login-overlay' : 'login-page'}>
      <form className="login-card" onSubmit={submit} noValidate aria-labelledby="login-title">
        <img src="/logo-stacked.png" alt="Easy First Management Consultancies" className="login-logo" width="196" height="92" />
        <h1 id="login-title">Site administration</h1>
        {notice && <p className="notice">{notice}</p>}
        <label htmlFor="login-user">User name</label>
        <input
          id="login-user"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          spellCheck={false}
          autoCapitalize="none"
        />
        <label htmlFor="login-pass">Password</label>
        <input
          id="login-pass"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="help">
          No account yet? It is created on the server, in the terminal: <code>npm run admin:create</code>
        </p>
      </form>
    </div>
  );
}
