import { lazy, Suspense, useEffect, useState, type ComponentProps } from 'react';
import { media } from '../lib/demo';
import { api, ApiError, setCsrf, whenSignedOut, type SessionInfo } from './api';
import { Login } from './Login';
import { Panel } from './Panel';

/** The demo build opens with a button instead of the sign-in form (loaded only there). */
const DemoLogin = __DEMO__ ? lazy(() => import('./DemoLogin')) : null;
function SignIn(props: ComponentProps<typeof Login>) {
  if (!DemoLogin) return <Login {...props} />;
  return (
    <Suspense fallback={null}>
      <DemoLogin onSignedIn={props.onSignedIn} overlay={props.overlay} />
    </Suspense>
  );
}

type State = 'loading' | 'out' | 'in' | 'down';

export function AdminApp() {
  const [state, setState] = useState<State>('loading');
  const [user, setUser] = useState('');
  const [expired, setExpired] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    whenSignedOut(() => setExpired(true));
    api<SessionInfo>('/api/session')
      .then((s) => {
        setCsrf(s.csrf);
        setUser(s.user);
        setState('in');
      })
      .catch((e: ApiError) => {
        if (e.status === 401) setState('out');
        else {
          setProblem(e.message);
          setState('down');
        }
      });
  }, []);

  if (state === 'loading') return <div className="login-page">Loading…</div>;

  if (state === 'down') {
    return (
      <div className="login-page">
        <div className="login-card">
          <img src={media('/logo-stacked.png')} alt="Easy First Management Consultancies" className="login-logo" width="196" height="92" />
          <h1>Site administration</h1>
          <p className="error" role="alert">
            {problem}
          </p>
          <button type="button" className="btn btn-primary" onClick={() => location.reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (state === 'out') {
    return (
      <SignIn
        onSignedIn={(s) => {
          setUser(s.user);
          setExpired(false);
          setState('in');
        }}
      />
    );
  }

  return (
    <>
      <Panel
        user={user}
        onSignOut={() => {
          setUser('');
          setState('out');
        }}
      />
      {expired && (
        <SignIn
          overlay
          notice="You were signed out after a long time without activity. Sign in again — your unsaved changes are still here."
          onSignedIn={(s) => {
            setUser(s.user);
            setExpired(false);
          }}
        />
      )}
    </>
  );
}
