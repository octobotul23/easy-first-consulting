/**
 * Talking to the site server. The session lives in an HttpOnly cookie the page can't read;
 * every change also sends the CSRF token received at sign-in.
 */
import type { Issue } from '../content/rules';

export class ApiError extends Error {
  status: number;
  issues: Issue[];
  field?: string;
  constructor(status: number, message: string, data?: { issues?: Issue[]; field?: string }) {
    super(message);
    this.status = status;
    this.issues = data?.issues ?? [];
    this.field = data?.field;
  }
}

let csrf = '';
let onSignedOut: (() => void) | null = null;

export const setCsrf = (token: string) => {
  csrf = token;
};
/** Called when the server says the session is over (the panel then asks to sign in again). */
export const whenSignedOut = (cb: () => void) => {
  onSignedOut = cb;
};

interface Options {
  method?: 'GET' | 'POST' | 'PUT';
  json?: unknown;
  file?: Blob;
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  // Demo build: the browser plays the server (left out of the normal build).
  if (__DEMO__) {
    const { demoApi } = await import('./demo-backend');
    try {
      return await demoApi<T>(path, opts);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && path.startsWith('/api/admin/')) onSignedOut?.();
      throw e;
    }
  }
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  let body: BodyInit | undefined;
  if (opts.file) {
    body = opts.file;
    headers['Content-Type'] = opts.file.type;
  } else if (opts.json !== undefined) {
    body = JSON.stringify(opts.json);
    headers['Content-Type'] = 'application/json';
  }
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf;

  let res: Response;
  try {
    res = await fetch(path, { method, headers, body, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'No connection to the server. Check the internet connection and try again.');
  }
  let data: { error?: string; issues?: Issue[]; field?: string } | null = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    if (res.status === 401 && path.startsWith('/api/admin/')) onSignedOut?.();
    const fallback =
      res.status === 404 || res.status === 502 || res.status === 504
        ? 'The admin server does not answer. Start it with: npm run serve'
        : `The server answered with an error (${res.status}). Try again.`;
    throw new ApiError(res.status, data?.error || fallback, data ?? undefined);
  }
  return data as T;
}

export interface SessionInfo {
  user: string;
  csrf: string;
  idleMinutes: number;
}

export interface VersionMeta {
  version: number;
  savedAt: string | null;
  user: string | null;
  note: string;
}

export interface SavedContent extends VersionMeta {
  content: unknown;
  unchanged?: boolean;
}

export interface AuditEntry {
  at: string;
  action: string;
  user?: string;
  ip?: string;
  version?: number;
  from?: number;
  file?: string;
  by?: string;
}
