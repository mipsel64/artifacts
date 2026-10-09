import type { Context } from 'hono';
import { ArtifactError } from '../artifacts';
import type { AppEnv } from '../types';
import { setPageHeaders } from '../ui/headers';
import { Icon, type IconName } from '../ui/icons';
import { identify } from '../ui/identify';
import { Layout, type Identity } from '../ui/layout';

type Status = 400 | 404 | 409 | 413 | 500;

interface ErrorCopy {
  heading: string;
  title: string;
  text: string;
  icon: IconName;
  danger: boolean;
  home: string;
  signInAction: boolean;
}

// Paths that answer with JSON, a sandboxed document or a static file keep their non-HTML error responses.
const SHARE_PAGE = /^\/s\/[^/]+$/;
const ARTIFACT_PAGE = /^\/a\/[^/]+(\/edit)?$/;

function isPagePath(path: string): boolean {
  if (path === '/api' || path.startsWith('/api/')) return false;
  if (path.startsWith('/render/') || path.startsWith('/static/')) return false;
  return !/^\/s\/[^/]+\/(render|raw)$/.test(path);
}

function copyFor(status: Status, path: string, message: string): ErrorCopy {
  if (status === 404) {
    const base = { icon: 'unlink', danger: false, heading: '404', signInAction: false } as const;
    if (SHARE_PAGE.test(path)) {
      return { ...base, title: 'Link not available', text: 'This share link was removed, has expired, or never existed.', home: 'Go to Artifacts' };
    }
    if (ARTIFACT_PAGE.test(path)) {
      if (message === 'Version not found') {
        return { ...base, title: 'Version not found', text: 'This artifact has no such version.', home: 'Back to your artifacts', signInAction: true };
      }
      return {
        ...base,
        title: 'Artifact not found',
        text: 'It may have expired or been deleted, or it belongs to another account.',
        home: 'Back to your artifacts',
        signInAction: true,
      };
    }
    return { ...base, title: 'Page not found', text: 'Check the address and try again.', home: 'Go to Artifacts' };
  }
  if (status === 500) {
    return { icon: 'circle-alert', danger: true, heading: '500', title: 'Something went wrong', text: 'Try again in a moment.', home: 'Go to Artifacts', signInAction: false };
  }
  return { icon: 'circle-alert', danger: true, heading: String(status), title: 'Request problem', text: message, home: 'Go to Artifacts', signInAction: false };
}

function ErrorPage({ copy, me }: { copy: ErrorCopy; me: Identity | null }) {
  const pageTitle = copy.heading === '404' ? 'Not found' : copy.title;
  return (
    <Layout title={pageTitle} me={me} signIn={false} width="narrow">
      <div class="card auth-card error-card">
        <span class={copy.danger ? 'auth-icon auth-icon-danger' : 'auth-icon'}>
          <Icon name={copy.icon} size={24} />
        </span>
        <p class="error-status">{copy.heading}</p>
        <h1>{copy.title}</h1>
        <p class="muted">{copy.text}</p>
        <div class="actions actions-center">
          <a class="button button-primary" href="/">
            {copy.home}
          </a>
          {copy.signInAction && !me && (
            <a class="button" href="/auth/login">
              Sign in
            </a>
          )}
        </div>
      </div>
    </Layout>
  );
}

// The header is best effort: a failing session or profile lookup must never replace the error being shown.
async function tryIdentify(c: Context<AppEnv>): Promise<Identity | null> {
  try {
    return await identify(c);
  } catch {
    return null;
  }
}

async function errorPage(c: Context<AppEnv>, status: Status, message: string) {
  setPageHeaders(c);
  const me = await tryIdentify(c);
  return c.html(<ErrorPage copy={copyFor(status, c.req.path, message)} me={me} />, status);
}

export function handleError(err: Error, c: Context<AppEnv>): Response | Promise<Response> {
  const isJson = c.req.path === '/api' || c.req.path.startsWith('/api/');
  const page = isPagePath(c.req.path);
  if (err instanceof ArtifactError) {
    if (page) return errorPage(c, err.status, err.message);
    return isJson ? c.json({ error: err.message }, err.status) : c.text(err.message, err.status);
  }
  console.error(err);
  if (page) return errorPage(c, 500, '');
  return isJson ? c.json({ error: 'Internal Server Error' }, 500) : c.text('Internal Server Error', 500);
}

export function handleNotFound(c: Context<AppEnv>): Response | Promise<Response> {
  if (c.req.path === '/api' || c.req.path.startsWith('/api/')) return c.json({ error: 'Not found' }, 404);
  if (!isPagePath(c.req.path)) return c.text('404 Not Found', 404);
  return errorPage(c, 404, 'Page not found');
}
