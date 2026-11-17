import { reset } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestUser, request } from './helpers';

afterEach(() => reset());

interface SettingsPageData {
  page: string;
  props: {
    origin: string;
    tokens: { id: string; name: string; createdAt: string }[];
    apps: { id: string; name: string; createdAt: string }[];
  };
  shell: { settingsActive?: boolean };
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

  it('renders Settings with the active shell and serializable token and app props', async () => {
    const { token, init } = await signedInAlice();
    const res = await request('/settings', init);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<title>Settings · Artifacts</title>');
    expect(body).toContain('Settings sections');
    expect(body).toContain('Appearance');
    expect(body).toContain('Saved in this browser.');
    expect(body).toContain('No connected apps.');
    expect(body).toContain('No tokens yet.');

    const data = pageData(body);
    expect(data.page).toBe('settings');
    expect(data.shell.settingsActive).toBe(true);
    expect(data.props.origin).toBe('https://artifacts.test');
    expect(data.props.tokens).toEqual([
      expect.objectContaining({ name: 'test', id: expect.any(String), createdAt: expect.any(String) }),
    ]);
    expect(data.props.apps).toEqual([]);
    expect(data.props.tokens[0]).not.toHaveProperty('token');
    expect(body).not.toContain(token);
  });

  it('builds every agent snippet from the request origin and labels the tabs', async () => {
    const { init } = await signedInAlice();
    const body = await (await request('/settings', init)).text();
    for (const label of ['Claude.ai &amp; Desktop', 'Claude Code', 'API token', 'JSON']) {
      expect(body).toContain(label);
    }
    expect(body.match(/role="tab"/g)).toHaveLength(4);
    expect(body.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(body).toContain('https://artifacts.test/mcp');
    expect(body).toContain('claude mcp add --transport http artifacts https://artifacts.test/mcp --header &quot;Authorization: Bearer &lt;YOUR_TOKEN&gt;&quot;');
    expect(body).toContain('&quot;url&quot;: &quot;https://artifacts.test/mcp&quot;');
    expect(body).toContain('&quot;mcpServers&quot;');
    expect(body).toContain('claude mcp add --transport http artifacts https://artifacts.test/mcp');
    expect(body).toContain('href="#tokens"');
    expect(body).toContain('Copy it now: you will not see it again.');
  });

  it('renders section hashes, reading preferences and the token form', async () => {
    const { init } = await signedInAlice();
    const body = await (await request('/settings', init)).text();
    for (const section of ['general', 'connect', 'apps', 'tokens']) {
      expect(body).toContain(`href="#${section}"`);
      expect(body).not.toContain(`id="${section}"`);
    }
    for (const label of ['System', 'Light', 'Dark', 'Serif', 'Default · 16 px']) {
      expect(body).toContain(label);
    }
    expect(body).toContain('Markdown, slides, react, and html that uses the theme font.');
    expect(body).toContain('Markdown, react, and html that uses the theme size. Slides keep their size.');
    expect(body).toContain('name="name"');
    expect(body).toContain('aria-required="true"');
    expect(body).toContain('Create token');
    expect(body).toContain('Revoke');
  });
});
