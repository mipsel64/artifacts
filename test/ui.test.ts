import { env } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { createArtifact, shareArtifact } from '../src/artifacts';
import { upsertUser } from '../src/auth';
import { formatDateTime, retentionLabel } from '../src/ui/format';
import { createTestUser, request } from './helpers';

afterEach(() => reset());

async function signedInAlice() {
  const { user, cookie } = await createTestUser('alice@example.com', '1');
  return { user, cookie, init: { headers: { Cookie: cookie } } satisfies RequestInit };
}

interface PageData {
  page: string;
  props: Record<string, unknown>;
  shell: { me: { email: string; name: string | null; avatarUrl: string | null } | null; settingsActive?: boolean };
  mode: string;
}

function pageData(body: string): PageData {
  const match = body.match(/<script type="application\/json" id="page-data">(.*?)<\/script>/);
  if (!match) throw new Error('page-data is missing');
  return JSON.parse(match[1]) as PageData;
}

const HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://lh3.googleusercontent.com data:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
  'cache-control': 'private, no-store',
};

describe('document shell', () => {
  it('serves the landing page with the client bundle and sign-in links when signed out', async () => {
    const res = await request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body.startsWith('<!doctype html>')).toBe(true);
    expect(body).toContain('<title>Welcome · Artifacts</title>');
    expect(body).toContain('<link rel="stylesheet" href="/static/build/app.css">');
    expect(body).toContain('<script type="module" src="/static/build/client.js"></script>');
    expect(body).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
    expect(body).toContain('href="/auth/login"');
    expect(body).toContain('Sign in with Google');
    expect(body).toContain('astryx-side-nav');
    expect(body).not.toContain('astryx-top-nav');
    for (const feature of ['MCP for agents', 'Sandboxed preview', 'Share links']) expect(body).toContain(feature);
    expect(body).not.toContain('Sign out');
    expect(pageData(body)).toMatchObject({ page: 'landing', shell: { me: null }, mode: 'system' });
  });

  it('renders the signed-in sidebar with New artifact and the profile name and picture', async () => {
    const { init } = await signedInAlice();
    await upsertUser(env, { sub: '1', email: 'alice@example.com', name: 'Alice Liddell', avatarUrl: 'https://lh3.googleusercontent.com/a/1' });
    const body = await (await request('/', init)).text();
    expect(body).toContain('astryx-side-nav');
    expect(body).not.toContain('astryx-top-nav');
    expect(body).toContain('+ New artifact');
    expect(body).toContain('href="/new"');
    expect(body).toContain('aria-label="Main navigation"');
    expect(body).toContain('Alice Liddell');
    expect(body).not.toContain('href="/auth/login"');
    expect(pageData(body).shell.me).toMatchObject({ email: 'alice@example.com', name: 'Alice Liddell', avatarUrl: 'https://lh3.googleusercontent.com/a/1' });
  });

  it('falls back to the email local part when there is no profile name', async () => {
    const { init } = await signedInAlice();
    await upsertUser(env, { sub: '1', email: 'alice@example.com', name: null, avatarUrl: null });
    const body = await (await request('/', init)).text();
    expect(body).toMatch(/>alice</);
  });

  it('marks Settings as active only on /settings', async () => {
    const { init } = await signedInAlice();
    for (const path of ['/', '/new', '/settings']) {
      const data = pageData(await (await request(path, init)).text());
      expect(Boolean(data.shell.settingsActive), path).toBe(path === '/settings');
    }
  });

  it('renders the theme mode from the theme cookie and ignores other values', async () => {
    const mode = async (cookie: string) => pageData(await (await request('/', { headers: { Cookie: cookie } })).text()).mode;
    expect(await mode('theme=dark')).toBe('dark');
    expect(await mode('theme=light')).toBe('light');
    expect(await mode('theme=blue')).toBe('system');
  });

  it('shows no Sign in link on the authorization error page', async () => {
    const body = await (await request('/authorize?response_type=code&client_id=x&redirect_uri=https%3A%2F%2Fx.test%2Fcb')).text();
    expect(body).toContain('Authorization failed');
    expect(body).not.toContain('href="/auth/login"');
  });

  it('loads no external assets', async () => {
    const body = await (await request('/')).text();
    expect(body).not.toMatch(/(?:href|src)="https?:\/\/(?!lh3\.googleusercontent\.com)/);
  });

  it('cannot break out of the page-data script with a crafted title', async () => {
    const { user, init } = await signedInAlice();
    const title = '</script><script>alert(1)</script>';
    await createArtifact(env, user.id, { title, type: 'html', content: 'x' });
    const body = await (await request('/', init)).text();
    expect(body).not.toContain(title);
    expect(body.match(/<\/script>/g)).toHaveLength(2);
    expect(JSON.stringify(pageData(body).props)).toContain(title);
  });
});

describe('formatDateTime', () => {
  it('formats an ISO timestamp as a short UTC date and time', () => {
    expect(formatDateTime('2026-10-09T14:02:11.000Z')).toBe('Oct 9, 14:02');
    expect(formatDateTime('2026-01-31T00:05:00.000Z')).toBe('Jan 31, 00:05');
  });
});

describe('retentionLabel', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const inHours = (h: number) => new Date(now.getTime() + h * 3600 * 1000).toISOString();

  it('says Permanent, within a day, or N days', () => {
    expect(retentionLabel(null, now)).toBe('Permanent');
    expect(retentionLabel(inHours(1), now)).toBe('Expires within a day');
    expect(retentionLabel(inHours(24), now)).toBe('Expires within a day');
    expect(retentionLabel(inHours(25), now)).toBe('Expires in 2 days');
    expect(retentionLabel(inHours(30 * 24), now)).toBe('Expires in 30 days');
  });
});

describe('security headers', () => {
  async function pages() {
    const { user, init } = await signedInAlice();
    const meta = await createArtifact(env, user.id, { title: 'Doc', type: 'html', content: 'x' });
    const { shareId } = await shareArtifact(env, user.id, meta.id);
    return { init, paths: ['/', '/new', `/a/${meta.id}`, `/a/${meta.id}/edit`, `/s/${shareId}`, '/settings'] };
  }

  it('are present on every page, signed in and signed out', async () => {
    const { init, paths } = await pages();
    const responses = await Promise.all([
      request('/'),
      request('/new', { redirect: 'manual' }),
      request(paths[4]),
      ...paths.map((path) => request(path, init)),
    ]);
    for (const res of responses) {
      for (const [name, value] of Object.entries(HEADERS)) expect(res.headers.get(name)).toBe(value);
    }
  });

  it('pages contain no inline executable scripts or event handler attributes', async () => {
    const { init, paths } = await pages();
    for (const path of paths) {
      const body = await (await request(path, init)).text();
      expect(body, path).not.toMatch(/<script(?![^>]*\s(?:src=|type="application\/json"))/);
      expect(body, path).not.toMatch(/\son[a-z]+=/);
    }
  });

  it('does not add headers to paths owned by other lanes', async () => {
    for (const path of ['/s/abc/render', '/s/abc/raw', '/r/abc', '/api/artifacts', '/auth/login']) {
      const res = await request(path, { redirect: 'manual' });
      expect(res.headers.get('x-frame-options'), path).toBeNull();
    }
  });
});
