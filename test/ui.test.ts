import { env } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { createArtifact, setRetention, shareArtifact, unshareArtifact, updateArtifact } from '../src/artifacts';
import { upsertUser } from '../src/auth';
import { ARTIFACT_TYPES } from '../src/types';
import { retentionLabel } from '../src/ui/format';
import { createTestUser, request } from './helpers';

afterEach(() => reset());

const asUser = (cookie: string): RequestInit => ({ headers: { Cookie: cookie } });

async function signedInAlice() {
  const { user, cookie } = await createTestUser('alice@example.com', '1');
  return { user, init: asUser(cookie) };
}

const HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://lh3.googleusercontent.com data:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
  'cache-control': 'private, no-store',
};

function expectSecurityHeaders(res: Response) {
  for (const [name, value] of Object.entries(HEADERS)) expect(res.headers.get(name)).toBe(value);
}

describe('landing', () => {
  it('shows the sign-in link when signed out', async () => {
    const res = await request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('<!doctype html>');
    expect(body).toContain('href="/auth/login"');
    expect(body).toContain('Sign in with Google');
    expect(body).not.toContain('Sign out');
    expect(body).toContain('href="/static/app.css"');
    expect(body).toContain('<script type="module" src="/static/app.js">');
  });

  it('shows header links, avatar and sign out when signed in', async () => {
    const { user, init } = await signedInAlice();
    await upsertUser(env, { sub: '1', email: 'alice@example.com', name: 'Alice', avatarUrl: 'https://lh3.googleusercontent.com/a/1' });
    const body = await (await request('/', init)).text();
    expect(user.id).toBe('google_1');
    expect(body).toContain('alice@example.com');
    expect(body).toContain('href="/new"');
    expect(body).toContain('href="/settings"');
    expect(body).toContain('src="https://lh3.googleusercontent.com/a/1"');
    expect(body).toContain('action="/auth/logout"');
    expect(body).toContain('method="post"');
  });
});

describe('artifact list', () => {
  it('lists only the user artifacts with escaped titles and badges', async () => {
    const { user, init } = await signedInAlice();
    const bob = await createTestUser('bob@example.com', '2');
    const first = await createArtifact(env, user.id, { title: '<img src=x onerror=alert(1)>', type: 'html', content: 'a' });
    const second = await createArtifact(env, user.id, { title: 'Permanent one', type: 'svg', content: 'b' });
    await updateArtifact(env, user.id, second.id, { content: 'b2' });
    await setRetention(env, user.id, second.id, true);
    await shareArtifact(env, user.id, second.id);
    await createArtifact(env, bob.user.id, { title: 'Bobs secret', type: 'code', content: 'c' });

    const body = await (await request('/', init)).text();
    expect(body).toContain(`href="/a/${first.id}"`);
    expect(body).toContain(`href="/a/${second.id}"`);
    expect(body).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(body).not.toContain('<img src=x');
    expect(body).not.toContain('Bobs secret');
    expect(body).toContain('Expires in 30 days');
    expect(body).toContain('Permanent');
    expect(body).toContain('Shared');
    expect(body).toContain('>v2<');
    expect(body).toContain('>svg<');
  });

  it('labels an artifact with under a day left as expiring within a day', async () => {
    const { user, init } = await signedInAlice();
    await createArtifact(env, user.id, { title: 'Soon', type: 'html', content: 'a' }, new Date(Date.now() - 29.5 * 24 * 3600 * 1000));
    const body = await (await request('/', init)).text();
    expect(body).toContain('Expires within a day');
    expect(body).not.toContain('Expires today');
  });

  it('shows an empty state pointing to New and Settings', async () => {
    const { init } = await signedInAlice();
    const body = await (await request('/', init)).text();
    expect(body).toContain('No artifacts yet');
    expect(body).toContain('<a href="/new">Create one</a>');
    expect(body).toContain('<a href="/settings">Settings</a>');
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

describe('new and settings pages', () => {
  it('renders the create form with every type for a signed-in user', async () => {
    const { init } = await signedInAlice();
    const res = await request('/new', init);
    expect(res.status).toBe(200);
    const body = await res.text();
    for (const type of ARTIFACT_TYPES) expect(body).toContain(`<option value="${type}">${type}</option>`);
    expect(body).toContain('for="title"');
    expect(body).toContain('for="language"');
    expect(body).toContain('for="content"');
    expect(body).toContain('<form class="form" method="post" data-form="new">');
  });

  it('renders tokens and MCP snippets built with the request origin', async () => {
    const { init } = await signedInAlice();
    const res = await request('/settings', init);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('>test<');
    expect(body).toContain('Revoke');
    expect(body).toContain('data-method="DELETE"');
    expect(body).toContain('claude mcp add --transport http artifacts https://artifacts.test/mcp --header &quot;Authorization: Bearer &lt;YOUR_TOKEN&gt;&quot;');
    expect(body).toContain('&quot;url&quot;: &quot;https://artifacts.test/mcp&quot;');
    expect(body).toContain('&quot;mcpServers&quot;');
    expect(body).toContain('you will not see it again');
    expect(body).toContain('method="post" data-form="token"');
  });

  it.each(['/new', '/settings'])('redirects %s to / when signed out', async (path) => {
    const res = await request(path, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location') ?? '', 'https://artifacts.test').pathname).toBe('/');
  });
});

describe('viewer', () => {
  it('renders the sandboxed preview, tabs, actions and version links', async () => {
    const { user, init } = await signedInAlice();
    const meta = await createArtifact(env, user.id, { title: 'Doc', type: 'html', content: '<p>one</p>' });
    await updateArtifact(env, user.id, meta.id, { content: '<p>two</p>' });
    await updateArtifact(env, user.id, meta.id, { content: '<p>three</p>' });

    const res = await request(`/a/${meta.id}?v=2`, init);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(`<iframe src="/render/${meta.id}?v=2" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads" title="Artifact preview"`);
    expect(body).toContain('role="tablist"');
    expect(body).toMatch(/role="tab"[^>]*aria-selected="true"/);
    expect(body).toContain('&lt;p&gt;two&lt;/p&gt;');
    expect(body).not.toContain('&lt;p&gt;one&lt;/p&gt;');
    expect(body).toContain(`href="/a/${meta.id}?v=1"`);
    expect(body).toContain(`href="/a/${meta.id}?v=3"`);
    expect(body).toContain('v2 of 3');
    expect(body).toContain(`href="/api/artifacts/${meta.id}/content?version=2&amp;download=1"`);
    expect(body).toContain(`href="/render/${meta.id}?v=2" target="_blank" rel="noopener noreferrer"`);
    expect(body).toContain(`href="/a/${meta.id}/edit"`);
    expect(body).toContain('Make permanent');
    expect(body).toContain('Expires in 30 days');
    expect(body).toContain(`data-url="/api/artifacts/${meta.id}/share"`);
    expect(body).toContain('>Share<');
    expect(body).toContain('data-confirm=');
    expect(body).toContain('data-done="/"');
    expectSecurityHeaders(res);
  });

  it('defaults to the latest version', async () => {
    const { user, init } = await signedInAlice();
    const meta = await createArtifact(env, user.id, { title: 'Doc', type: 'html', content: 'first' });
    await updateArtifact(env, user.id, meta.id, { content: 'second' });
    const body = await (await request(`/a/${meta.id}`, init)).text();
    expect(body).toContain(`/render/${meta.id}?v=2"`);
    expect(body).toContain('>second<');
  });

  it('shows ?v=1 content', async () => {
    const { user, init } = await signedInAlice();
    const meta = await createArtifact(env, user.id, { title: 'Doc', type: 'code', content: 'first-version' });
    await updateArtifact(env, user.id, meta.id, { content: 'second-version' });
    const body = await (await request(`/a/${meta.id}?v=1`, init)).text();
    expect(body).toContain('first-version');
    expect(body).not.toContain('second-version');
  });

  it('escapes script content in the Code tab', async () => {
    const { user, init } = await signedInAlice();
    const meta = await createArtifact(env, user.id, { title: 'XSS', type: 'html', content: '<script>alert(1)</script>' });
    const body = await (await request(`/a/${meta.id}`, init)).text();
    expect(body).toContain('<code id="code">&lt;script&gt;alert(1)&lt;/script&gt;</code>');
    expect(body).not.toContain('<script>alert(1)');
  });

  it('shows the share link and stop-sharing action when shared, permanent state otherwise', async () => {
    const { user, init } = await signedInAlice();
    const meta = await createArtifact(env, user.id, { title: 'Doc', type: 'html', content: 'x' });
    const shared = await shareArtifact(env, user.id, meta.id);
    await setRetention(env, user.id, meta.id, true);
    const body = await (await request(`/a/${meta.id}`, init)).text();
    expect(body).toContain(`value="https://artifacts.test/s/${shared.shareId}"`);
    expect(body).toContain('readonly');
    expect(body).toContain('Copy link');
    expect(body).toContain('Stop sharing');
    expect(body).toContain('Set to expire');
    expect(body).toContain('Permanent');
  });

  it('404s for another user artifact and 400s for a bad v', async () => {
    const { user, init } = await signedInAlice();
    const bob = await createTestUser('bob@example.com', '2');
    const bobs = await createArtifact(env, bob.user.id, { title: 'Bobs', type: 'html', content: 'x' });
    const mine = await createArtifact(env, user.id, { title: 'Mine', type: 'html', content: 'x' });
    const other = await request(`/a/${bobs.id}`, init);
    expect(other.status).toBe(404);
    expectSecurityHeaders(other);
    for (const v of ['0', '-1', 'abc', '1.5', '']) {
      expect((await request(`/a/${mine.id}?v=${v}`, init)).status).toBe(400);
    }
    expect((await request(`/a/${mine.id}?v=9`, init)).status).toBe(404);
  });

  it('redirects to / when signed out', async () => {
    const { user } = await signedInAlice();
    const meta = await createArtifact(env, user.id, { title: 'Doc', type: 'html', content: 'x' });
    for (const path of [`/a/${meta.id}`, `/a/${meta.id}/edit`]) {
      const res = await request(path, { redirect: 'manual' });
      expect(res.status).toBe(302);
      expect(new URL(res.headers.get('location') ?? '', 'https://artifacts.test').pathname).toBe('/');
    }
  });
});

describe('edit page', () => {
  it('pre-fills the title and the latest content', async () => {
    const { user, init } = await signedInAlice();
    const meta = await createArtifact(env, user.id, { title: 'Doc "q"', type: 'html', content: '<p>one</p>' });
    await updateArtifact(env, user.id, meta.id, { content: '<p>latest & greatest</p>' });
    const res = await request(`/a/${meta.id}/edit`, init);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('value="Doc &quot;q&quot;"');
    expect(body).toContain('&lt;p&gt;latest &amp; greatest&lt;/p&gt;</textarea>');
    expect(body).not.toContain('&lt;p&gt;one&lt;/p&gt;');
    expect(body).toContain(`method="post" data-form="edit" data-id="${meta.id}"`);
    expect(body).toContain(`href="/a/${meta.id}"`);
    expectSecurityHeaders(res);
  });

  it("404s for another user's artifact", async () => {
    const { init } = await signedInAlice();
    const bob = await createTestUser('bob@example.com', '2');
    const bobs = await createArtifact(env, bob.user.id, { title: 'Bobs', type: 'html', content: 'x' });
    expect((await request(`/a/${bobs.id}/edit`, init)).status).toBe(404);
  });
});

describe('public share page', () => {
  it('works signed out without owner actions or Remix', async () => {
    const { user } = await signedInAlice();
    const meta = await createArtifact(env, user.id, { title: 'Shared <b>', type: 'html', content: '<h1>hi</h1>' });
    const { shareId } = await shareArtifact(env, user.id, meta.id);
    const res = await request(`/s/${shareId}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(`<iframe src="/s/${shareId}/render" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads" title="Artifact preview"`);
    expect(body).toContain('Shared &lt;b&gt;');
    expect(body).toContain('&lt;h1&gt;hi&lt;/h1&gt;');
    expect(body).toContain(`href="/s/${shareId}/raw?download=1"`);
    expect(body).toContain('data-copy="#code"');
    expect(body).not.toContain('Remix');
    expect(body).not.toContain('/edit');
    expect(body).not.toContain('data-method');
    expect(body).not.toContain(meta.id);
    expectSecurityHeaders(res);
  });

  it('shows Remix with the artifact attributes when signed in', async () => {
    const { user, init } = await signedInAlice();
    const meta = await createArtifact(env, user.id, { title: 'Snippet', type: 'code', content: 'print(1)', language: 'python' });
    const { shareId } = await shareArtifact(env, user.id, meta.id);
    const body = await (await request(`/s/${shareId}`, init)).text();
    expect(body).toContain('Remix');
    expect(body).toContain(`data-remix="${shareId}"`);
    expect(body).toContain('data-title="Snippet"');
    expect(body).toContain('data-type="code"');
    expect(body).toContain('data-language="python"');
  });

  it('404s for a revoked or unknown share', async () => {
    const { user } = await signedInAlice();
    const meta = await createArtifact(env, user.id, { title: 'Doc', type: 'html', content: 'x' });
    const { shareId } = await shareArtifact(env, user.id, meta.id);
    await unshareArtifact(env, user.id, meta.id);
    const revoked = await request(`/s/${shareId}`);
    expect(revoked.status).toBe(404);
    expectSecurityHeaders(revoked);
    expect((await request('/s/unknown')).status).toBe(404);
  });
});

describe('security headers', () => {
  it('are present on every page', async () => {
    const { user, init } = await signedInAlice();
    const meta = await createArtifact(env, user.id, { title: 'Doc', type: 'html', content: 'x' });
    const { shareId } = await shareArtifact(env, user.id, meta.id);
    const responses = await Promise.all([
      request('/'),
      request('/', init),
      request('/new', init),
      request('/new', { redirect: 'manual' }),
      request(`/a/${meta.id}`, init),
      request(`/a/${meta.id}/edit`, init),
      request(`/s/${shareId}`),
      request('/settings', init),
    ]);
    for (const res of responses) expectSecurityHeaders(res);
  });

  it('pages contain no inline scripts, handlers or style attributes', async () => {
    const { user, init } = await signedInAlice();
    const meta = await createArtifact(env, user.id, { title: 'Doc', type: 'html', content: 'x' });
    const { shareId } = await shareArtifact(env, user.id, meta.id);
    for (const path of ['/', '/new', `/a/${meta.id}`, `/a/${meta.id}/edit`, `/s/${shareId}`, '/settings']) {
      const body = await (await request(path, init)).text();
      expect(body, path).not.toMatch(/<script(?![^>]*\ssrc=)/);
      expect(body, path).not.toMatch(/\son[a-z]+=/);
      expect(body, path).not.toMatch(/\sstyle=/);
    }
  });

  it('does not add headers to paths owned by other lanes', async () => {
    for (const path of ['/s/abc/render', '/s/abc/raw', '/render/abc', '/api/artifacts', '/auth/login']) {
      const res = await request(path, { redirect: 'manual' });
      expect(res.headers.get('x-frame-options'), path).toBeNull();
    }
  });
});
