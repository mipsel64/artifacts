import { reset } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { createArtifact, shareArtifact } from '../src/artifacts';
import { createSessionCookie } from '../src/auth';
import { createTestUser, request } from './helpers';

afterEach(() => reset());

interface SettingsPageData {
  page: string;
  props: {
    origin: string;
    tokens: { id: string; name: string; createdAt: string }[];
    apps: { id: string; name: string; createdAt: string }[];
  };
}

async function signedInAlice() {
  const { user, token, cookie } = await createTestUser('alice@example.com', '1');
  return { user, token, init: { headers: { Cookie: cookie } } };
}

function pageData(body: string): SettingsPageData {
  const match = body.match(/<script type="application\/json" id="page-data">(.*?)<\/script>/);
  expect(match).not.toBeNull();
  return JSON.parse(match?.[1] ?? '') as SettingsPageData;
}

describe('settings page', () => {
  it('redirects signed-out users to /', async () => {
    const res = await request('/settings', { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location') ?? '', 'https://artifacts.test').pathname).toBe('/');
  });

  it('renders Settings with serializable token and app props', async () => {
    const { token, init } = await signedInAlice();
    const res = await request('/settings', init);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<title>Settings · Artifacts</title>');
    expect(body).toContain('Settings sections');
    expect(body).toContain('Appearance');
    expect(body).toContain('Saved in this browser.');
    expect(body).toContain('No connected apps.');
    expect(body).not.toContain('No tokens yet.');

    const data = pageData(body);
    expect(data.page).toBe('settings');
    expect(data.props.origin).toBe('https://artifacts.test');
    expect(data.props.tokens).toEqual([
      expect.objectContaining({ name: 'test', id: expect.any(String), createdAt: expect.any(String) }),
    ]);
    expect(data.props.apps).toEqual([]);
    expect(data.props.tokens[0]).not.toHaveProperty('token');
    expect(body).not.toContain(token);
  });

  it('builds every agent snippet from the request origin and labels the connection method', async () => {
    const { init } = await signedInAlice();
    const body = await (await request('/settings', init)).text();
    expect(body).toContain('Connection method');
    for (const [value, label] of [
      ['claude-ai', 'Claude.ai &amp; Desktop'],
      ['claude-code', 'Claude Code'],
      ['token', 'API token'],
      ['json', 'JSON'],
    ]) {
      expect(body).toMatch(new RegExp(`<option value="${value}"[^>]*>${label}</option>`));
    }
    expect(body).toContain('https://artifacts.test/mcp');
    expect(body).toContain('claude mcp add --transport http artifacts https://artifacts.test/mcp --header &quot;Authorization: Bearer &lt;YOUR_TOKEN&gt;&quot;');
    expect(body).toContain('&quot;url&quot;: &quot;https://artifacts.test/mcp&quot;');
    expect(body).toContain('&quot;mcpServers&quot;');
    expect(body).toContain('claude mcp add --transport http artifacts https://artifacts.test/mcp');
    expect(body).toContain('href="#tokens"');
  });

  it('renders section hashes, reading preferences and the token form', async () => {
    const { init } = await signedInAlice();
    const body = await (await request('/settings', init)).text();
    for (const section of ['general', 'connect', 'apps', 'tokens']) {
      expect(body).toContain(`href="#${section}"`);
      expect(body).toMatch(new RegExp(`<option value="${section}"`));
    }
    expect(body).toContain('Settings section');
    expect(body).toContain('Live reading preview');
    expect(body).toMatch(/<input\b(?=[^>]*name="theme")(?=[^>]*value="system")(?=[^>]*checked="")[^>]*>/);
    expect(body).toMatch(/<option\b(?=[^>]*value="serif")(?=[^>]*selected="")[^>]*>Serif<\/option>/);
    expect(body).toMatch(/<option\b(?=[^>]*value="16")(?=[^>]*selected="")[^>]*>Default · 16 px<\/option>/);
    for (const label of ['System', 'Light', 'Dark', 'Serif', 'Default · 16 px']) {
      expect(body).toContain(label);
    }
    expect(body).toContain('Markdown, slides, react, and html that uses the theme font.');
    expect(body).toContain('Markdown, react, and html that uses the theme size. Slides keep their size.');
    expect(body).toContain('name="name"');
    expect(body).toContain('aria-required="true"');
    expect(body).toContain('Create token');
    expect(body).toContain('Revoke');
    expect(body).not.toContain('Copy it now: you will not see it again.');
  });

  it('uses the persisted theme in the server-rendered picker and falls back to System for unknown themes', async () => {
    const { init } = await signedInAlice();
    for (const [stored, selected] of [['dark', 'dark'], ['unknown', 'system']]) {
      const body = await (await request('/settings', { headers: { Cookie: `${init.headers.Cookie}; theme=${stored}` } })).text();
      expect(body).toMatch(new RegExp(`<input\\b(?=[^>]*name="theme")(?=[^>]*value="${selected}")(?=[^>]*checked="")[^>]*>`));
    }
  });

  it('never redisplays a newly created token in Settings and removes it from the list after revocation', async () => {
    const { init } = await signedInAlice();
    const res = await request('/api/tokens', {
      method: 'POST',
      headers: { ...init.headers, Origin: 'https://artifacts.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Field notebook' }),
    });
    expect(res.status).toBe(201);
    const created = await res.json<{ id: string; token: string }>();
    expect(created.token).toMatch(/^art_/);
    const body = await (await request('/settings', init)).text();
    expect(pageData(body).props.tokens).toContainEqual(expect.objectContaining({ id: created.id, name: 'Field notebook' }));
    expect(body).not.toContain(created.token);
    for (const item of pageData(body).props.tokens) {
      const revoke = await request(`/api/tokens/${item.id}`, { method: 'DELETE', headers: { ...init.headers, Origin: 'https://artifacts.test' } });
      expect(revoke.status).toBe(204);
    }
    const empty = await (await request('/settings', init)).text();
    expect(pageData(empty).props.tokens).toEqual([]);
    expect(empty).toContain('No tokens yet.');
  });
});

describe('restricted access page', () => {
  it('offers sign-in or account switching without disclosing the artifact in either state', async () => {
    const { user } = await signedInAlice();
    const meta = await createArtifact(env, user.id, { title: 'Private field notes', type: 'markdown', content: 'Sensitive specimen' });
    const share = await shareArtifact(env, user.id, meta.id, { audience: ['invited@example.com'] });
    const cookie = (await createSessionCookie(env, { email: 'guest@example.com', id: 'guest' })).split(';')[0];
    const path = `/s/${share.shareId}`;
    const signIn = `/auth/login?next=${encodeURIComponent(path)}`;
    for (const [init, heading, action] of [
      [undefined, 'Sign in to view', 'Sign in with Google'],
      [{ headers: { Cookie: cookie } }, 'You do not have access', 'Switch account'],
    ] as const) {
      const res = await request(path, init);
      expect(res.status).toBe(403);
      const body = await res.text();
      expect(body).toContain(heading);
      expect(body).toContain(action);
      expect(body).toContain(`href="${signIn}"`);
      expect(body).not.toContain('Private field notes');
      expect(body).not.toContain('Sensitive specimen');
      expect(body).not.toContain('invited@example.com');
      if (init) expect(body).toContain('guest@example.com');
    }
  });
});
