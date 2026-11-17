import type { Context } from 'hono';
import { ArtifactError } from '../artifacts';
import type { AppEnv } from '../types';
import { renderPage } from '../ui/app/document';
import type { IconName } from '../ui/app/icons';
import type { Identity } from '../ui/app/identity';
import { identify } from '../ui/identify';

type Status = 400 | 403 | 404 | 409 | 413 | 500;

interface ErrorCopy {
  heading: string;
  title: string;
  text: string;
  icon: IconName;
  danger: boolean;
  home: string;
  signInAction: boolean;
}

const SHARE_PAGE = /^\/s\/[^/]+$/;
const ARTIFACT_PAGE = /^\/a\/[^/]+(\/edit)?$/;

function isPagePath(path: string): boolean {
  if (path === '/api' || path.startsWith('/api/')) return false;
  if (path.startsWith('/r/') || path.startsWith('/static/')) return false;
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

async function tryIdentify(c: Context<AppEnv>): Promise<Identity | null> {
  try {
    return await identify(c);
  } catch {
    return null;
  }
}

async function errorPage(c: Context<AppEnv>, status: Status, message: string) {
  const me = await tryIdentify(c);
  const copy = copyFor(status, c.req.path, message);
  return renderPage(c, 'error', { ...copy, signedIn: me !== null }, {
    title: copy.heading === '404' ? 'Not found' : copy.title,
    status,
    shell: { me, signIn: false, width: 'narrow' },
  });
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
