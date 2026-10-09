import { env } from 'cloudflare:workers';
import { createExecutionContext, reset } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createArtifact, shareArtifact, unshareArtifact } from '../src/artifacts';
import main from '../src/index';
import { ORIGIN, createTestUser, request } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
  return reset();
});

const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://lh3.googleusercontent.com data:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
  'cache-control': 'private, no-store',
};

async function expectErrorPage(res: Response, status: number, title: string): Promise<string> {
  expect(res.status).toBe(status);
  expect(res.headers.get('content-type')).toContain('text/html');
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(name)).toBe(value);
  const body = await res.text();
  expect(body).toContain('<!doctype html>');
  expect(body).toContain(`<h1>${title}</h1>`);
  expect(body).toContain('href="/static/app.css"');
  return body;
}

const asUser = (cookie: string): RequestInit => ({ headers: { Cookie: cookie } });

describe('share page errors', () => {
  it('renders a themed 404 for an unknown share link, signed out', async () => {
    const body = await expectErrorPage(await request('/s/unknown'), 404, 'Link not available');
    expect(body).toContain('This share link was removed, has expired, or never existed.');
    expect(body).toContain('<title>Not found · Artifacts</title>');
    expect(body).toContain('Go to Artifacts');
    expect(body).not.toContain('id="account-menu"');
    expect(body).not.toContain('<script>');
    expect(body).not.toContain('style="');
  });

  it('renders the same page for a revoked share link', async () => {
    const { user } = await createTestUser();
    const artifact = await createArtifact(env, user.id, { title: 'Doc', type: 'html', content: '<p>x</p>' });
    const { shareId } = await shareArtifact(env, user.id, artifact.id);
    await unshareArtifact(env, user.id, artifact.id);
    const body = await expectErrorPage(await request(`/s/${shareId}`), 404, 'Link not available');
    expect(body).not.toContain('Doc');
  });

  it('shows the account menu when signed in', async () => {
    const { cookie } = await createTestUser();
    const body = await expectErrorPage(await request('/s/unknown', asUser(cookie)), 404, 'Link not available');
    expect(body).toContain('id="account-menu"');
  });
});

describe('artifact page errors', () => {
  it('renders a themed 404 with the account menu for an unknown artifact', async () => {
    const { cookie } = await createTestUser();
    for (const path of ['/a/unknown', '/a/unknown/edit']) {
      const body = await expectErrorPage(await request(path, asUser(cookie)), 404, 'Artifact not found');
      expect(body).toContain('It may have expired or been deleted, or it belongs to another account.');
      expect(body).toContain('Back to your artifacts');
      expect(body).toContain('id="account-menu"');
    }
  });

  it('does not tell another account apart from a missing artifact', async () => {
    const alice = await createTestUser('alice@example.com', '1');
    const bob = await createTestUser('bob@example.com', '2');
    const artifact = await createArtifact(env, alice.user.id, { title: 'Secret plan', type: 'html', content: '<p>x</p>' });
    const other = await request(`/a/${artifact.id}`, asUser(bob.cookie));
    const missing = await request('/a/unknown', asUser(bob.cookie));
    const otherBody = await expectErrorPage(other, 404, 'Artifact not found');
    expect(otherBody).not.toContain('Secret plan');
    expect(otherBody).toBe(await missing.text());
  });

  it('says so when only the version is missing', async () => {
    const { user, cookie } = await createTestUser();
    const artifact = await createArtifact(env, user.id, { title: 'Doc', type: 'html', content: '<p>x</p>' });
    const body = await expectErrorPage(await request(`/a/${artifact.id}?v=9`, asUser(cookie)), 404, 'Version not found');
    expect(body).toContain('This artifact has no such version.');
  });

  it('renders a 400 with the escaped message for a bad version', async () => {
    const { user, cookie } = await createTestUser();
    const artifact = await createArtifact(env, user.id, { title: 'Doc', type: 'html', content: '<p>x</p>' });
    const body = await expectErrorPage(await request(`/a/${artifact.id}?v=abc`, asUser(cookie)), 400, 'Request problem');
    expect(body).toContain('v must be a positive integer');
    expect(body).toContain('Go back');
  });
});

describe('other page errors', () => {
  it('renders a themed 404 for unknown paths', async () => {
    const body = await expectErrorPage(await request('/nope'), 404, 'Page not found');
    expect(body).toContain('Check the address and try again.');
    expect(body).toContain('<title>Not found · Artifacts</title>');
    await expectErrorPage(await request('/s/x/other'), 404, 'Page not found');
    await expectErrorPage(await request('/render'), 404, 'Page not found');
  });

  it('falls back to the signed-out header when the session lookup fails', async () => {
    const { cookie } = await createTestUser();
    const broken = new Proxy(env.KV, {
      get(target, prop) {
        if (prop === 'get') return () => Promise.reject(new Error('KV down'));
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const res = await main.fetch(new Request(`${ORIGIN}/nope`, asUser(cookie)), { ...env, KV: broken }, createExecutionContext());
    const body = await expectErrorPage(res, 404, 'Page not found');
    expect(body).not.toContain('id="account-menu"');
  });

  it('renders a 500 without the error details and still logs them', async () => {
    const { user, cookie } = await createTestUser();
    const artifact = await createArtifact(env, user.id, { title: 'Doc', type: 'html', content: '<p>x</p>' });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = new Proxy(env.BUCKET, {
      get(target, prop) {
        if (prop === 'get') return () => Promise.reject(new Error('R2 down'));
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const res = await main.fetch(new Request(`${ORIGIN}/a/${artifact.id}`, asUser(cookie)), { ...env, BUCKET: broken }, createExecutionContext());
    const body = await expectErrorPage(res, 500, 'Something went wrong');
    expect(body).toContain('Try again in a moment.');
    expect(body).not.toContain('R2 down');
    expect(body).toContain('id="account-menu"');
    expect(log).toHaveBeenCalled();
  });
});

describe('non-page responses are unchanged', () => {
  it('keeps JSON for the API', async () => {
    const { token } = await createTestUser();
    const res = await request('/api/artifacts/unknown', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'Artifact not found' });
  });

  it('keeps plain text and the sandbox CSP for raw and render documents', async () => {
    const { cookie } = await createTestUser();
    for (const [path, init] of [
      ['/s/unknown/raw', undefined],
      ['/s/unknown/render', undefined],
      ['/render/unknown', asUser(cookie)],
    ] as const) {
      const res = await request(path, init);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('text/plain');
      expect(await res.text()).toBe('Artifact not found');
      expect(res.headers.get('content-security-policy')).toContain('sandbox');
    }
  });

  it('keeps the MCP challenge', async () => {
    const res = await request('/mcp', { method: 'POST' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
  });
});
