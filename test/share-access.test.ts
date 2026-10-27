import { env } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_SHARE_AUDIENCE,
  canViewShare,
  createArtifact,
  getSharedArtifact,
  shareArtifact,
  unshareArtifact,
} from '../src/artifacts';
import { createSessionCookie } from '../src/auth';
import type { ArtifactMeta, Session } from '../src/types';
import { ORIGIN, createTestUser, request } from './helpers';

afterEach(() => reset());

const base: ArtifactMeta = {
  id: 'a1',
  ownerId: 'google_1',
  title: 'Private artifact',
  type: 'html',
  language: null,
  version: 1,
  versions: [],
  createdAt: '',
  updatedAt: '',
  expiresAt: null,
  shareId: 'share1',
  shareAudience: null,
};

const viewer = (overrides: Partial<Session> = {}): Session => ({
  id: 'google_v1',
  email: 'carol@acme.dev',
  hostedDomain: null,
  ...overrides,
});

async function signedViewerCookie(email = 'carol@acme.dev', hostedDomain: string | null = 'acme.dev') {
  return (await createSessionCookie(env, { id: 'google_v1', email, hostedDomain })).split(';')[0];
}

async function createShared(audience: string[] | null) {
  const owner = await createTestUser('alice@example.com', '1');
  const artifact = await createArtifact(env, owner.user.id, {
    title: 'Needle Private Title',
    type: 'html',
    content: '<h1>Needle Private Content</h1>',
  });
  const meta = await shareArtifact(env, owner.user.id, artifact.id, { audience });
  return { owner, meta, shareId: meta.shareId! };
}

const withCookie = (cookie: string): RequestInit => ({ headers: { Cookie: cookie } });

describe('canViewShare', () => {
  it('allows anyone when the audience is null', () => {
    expect(canViewShare(base, null)).toBe(true);
  });

  it('rejects an anonymous viewer for a restricted link', () => {
    expect(canViewShare({ ...base, shareAudience: ['carol@acme.dev'] }, null)).toBe(false);
  });

  it('always allows the owner', () => {
    expect(canViewShare({ ...base, shareAudience: ['someone@else.dev'] }, viewer({ id: 'google_1' }))).toBe(true);
  });

  it('matches an exact email case-insensitively', () => {
    expect(canViewShare({ ...base, shareAudience: ['carol@acme.dev'] }, viewer({ email: 'CAROL@ACME.DEV' }))).toBe(true);
  });

  it('matches a domain only with the same hosted domain', () => {
    const meta = { ...base, shareAudience: ['@acme.dev'] };
    expect(canViewShare(meta, viewer({ hostedDomain: 'acme.dev' }))).toBe(true);
    expect(canViewShare(meta, viewer({ hostedDomain: null }))).toBe(false);
    expect(canViewShare(meta, viewer({ hostedDomain: 'other.dev' }))).toBe(false);
  });

  it('does not match a subdomain email to a parent domain entry', () => {
    const meta = { ...base, shareAudience: ['@acme.dev'] };
    expect(canViewShare(meta, viewer({ email: 'carol@eng.acme.dev', hostedDomain: 'acme.dev' }))).toBe(false);
  });
});

describe('share audience validation and storage', () => {
  it('normalizes case, trims and deduplicates entries in input order', async () => {
    const meta = await createArtifact(env, 'u1', { title: 'x', type: 'html', content: 'x' });
    const shared = await shareArtifact(env, 'u1', meta.id, {
      audience: [' Carol@ACME.DEV ', '@EXAMPLE.COM', 'carol@acme.dev', '@example.com'],
    });
    expect(shared.shareAudience).toEqual(['carol@acme.dev', '@example.com']);
  });

  it('rejects values that are not null or an array of strings', async () => {
    const meta = await createArtifact(env, 'u1', { title: 'x', type: 'html', content: 'x' });
    for (const audience of ['carol@acme.dev', {}, ['carol@acme.dev', 42]]) {
      await expect(shareArtifact(env, 'u1', meta.id, { audience })).rejects.toMatchObject({
        status: 400,
        message: 'audience must be null or a list of emails and @domains',
      });
    }
  });

  it('rejects an empty list', async () => {
    const meta = await createArtifact(env, 'u1', { title: 'x', type: 'html', content: 'x' });
    await expect(shareArtifact(env, 'u1', meta.id, { audience: [] })).rejects.toMatchObject({
      status: 400,
      message: 'audience must list at least one email or @domain; use null to let anyone with the link view',
    });
  });

  it.each(['acme.dev', '*@acme.dev', 'a@b@acme.dev', '@localhost', 'j\u00f6hn@acme.dev'])('rejects the invalid entry %s', async (entry) => {
    const meta = await createArtifact(env, 'u1', { title: 'x', type: 'html', content: 'x' });
    await expect(shareArtifact(env, 'u1', meta.id, { audience: [entry] })).rejects.toMatchObject({
      status: 400,
      message: `audience entries must be emails (alice@example.com) or domains (@example.com): ${entry}`,
    });
  });

  it('rejects more than 50 entries after deduplication', async () => {
    const meta = await createArtifact(env, 'u1', { title: 'x', type: 'html', content: 'x' });
    const audience = Array.from({ length: MAX_SHARE_AUDIENCE + 1 }, (_, index) => `user${index}@example.com`);
    await expect(shareArtifact(env, 'u1', meta.id, { audience })).rejects.toMatchObject({
      status: 400,
      message: 'audience can list at most 50 entries',
    });
  });

  it('keeps the share id across audience changes and clears the audience on unshare', async () => {
    const meta = await createArtifact(env, 'u1', { title: 'x', type: 'html', content: 'x' });
    const shared = await shareArtifact(env, 'u1', meta.id, { audience: ['carol@acme.dev'] });
    const changed = await shareArtifact(env, 'u1', meta.id, { audience: ['@acme.dev'] });
    expect(changed.shareId).toBe(shared.shareId);
    expect(changed.shareAudience).toEqual(['@acme.dev']);
    expect((await shareArtifact(env, 'u1', meta.id)).shareAudience).toEqual(['@acme.dev']);
    expect(await unshareArtifact(env, 'u1', meta.id)).toMatchObject({ shareId: null, shareAudience: null });
  });

  it('reads legacy metadata with a public null audience', async () => {
    const { meta, shareId } = await createShared(null);
    const key = `artifacts/${meta.id}/meta.json`;
    const object = await env.BUCKET.get(key);
    const legacy = (await object!.json()) as Record<string, unknown>;
    delete legacy.shareAudience;
    await env.BUCKET.put(key, JSON.stringify(legacy));
    expect((await getSharedArtifact(env, shareId)).shareAudience).toBeNull();
    expect((await request(`/s/${shareId}`)).status).toBe(200);
  });
});

describe('restricted share routes', () => {
  it('returns 403 without a cookie and never reveals the artifact on the page', async () => {
    const { shareId } = await createShared(['carol@acme.dev']);
    const page = await request(`/s/${shareId}`);
    expect(page.status).toBe(403);
    const body = await page.text();
    expect(body).not.toContain('Needle Private Title');
    expect(body).not.toContain('Needle Private Content');
    expect((await request(`/s/${shareId}/render`)).status).toBe(403);
    expect((await request(`/s/${shareId}/raw`)).status).toBe(403);
  });

  it('allows a listed email on the page, render and raw routes', async () => {
    const { shareId } = await createShared(['carol@acme.dev']);
    const init = withCookie(await signedViewerCookie('carol@acme.dev', null));
    for (const suffix of ['', '/render', '/raw']) {
      expect((await request(`/s/${shareId}${suffix}`, init)).status).toBe(200);
    }
  });

  it('allows a matching Workspace domain and rejects it without hd', async () => {
    const { shareId } = await createShared(['@acme.dev']);
    const allowed = withCookie(await signedViewerCookie());
    for (const suffix of ['', '/render', '/raw']) {
      expect((await request(`/s/${shareId}${suffix}`, allowed)).status).toBe(200);
    }
    const denied = withCookie(await signedViewerCookie('carol@acme.dev', null));
    for (const suffix of ['', '/render', '/raw']) {
      expect((await request(`/s/${shareId}${suffix}`, denied)).status).toBe(403);
    }
  });

  it('allows the owner on every share route', async () => {
    const { owner, shareId } = await createShared(['carol@acme.dev']);
    for (const suffix of ['', '/render', '/raw']) {
      expect((await request(`/s/${shareId}${suffix}`, withCookie(owner.cookie))).status).toBe(200);
    }
  });

  it('keeps a public link available without a cookie', async () => {
    const { shareId } = await createShared(null);
    for (const suffix of ['', '/render', '/raw']) {
      expect((await request(`/s/${shareId}${suffix}`)).status).toBe(200);
    }
  });
});

describe('viewer session isolation', () => {
  it('cannot access the API or library', async () => {
    const cookie = await signedViewerCookie();
    expect((await request('/api/artifacts', withCookie(cookie))).status).toBe(401);
    const landing = await request('/', withCookie(cookie));
    expect(landing.status).toBe(200);
    const body = await landing.text();
    expect(body).toContain('Sign in with Google');
    expect(body).not.toContain('id="account-menu"');
  });

  it('cannot open or change owner resources', async () => {
    const { meta } = await createShared(['carol@acme.dev']);
    const cookie = await signedViewerCookie();
    const id = meta.id;
    const attempts: [string, string, unknown?][] = [
      ['GET', '/settings'],
      ['GET', '/new'],
      ['GET', `/a/${id}`],
      ['GET', `/a/${id}/edit`],
      ['GET', `/r/${id}`],
      ['GET', `/api/artifacts/${id}/export?format=md`],
      ['POST', '/api/artifacts', { title: 'Viewer artifact', type: 'html', content: '<p>no</p>' }],
      ['GET', '/api/tokens'],
      ['POST', '/api/tokens', { name: 'viewer' }],
      ['DELETE', '/api/grants/x'],
    ];
    for (const [method, path, body] of attempts) {
      const res = await request(path, {
        method,
        headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
      });
      const location = res.headers.get('Location');
      const redirectedAway = res.status >= 300 && res.status < 400 && location !== null &&
        (location === '/' || new URL(location, ORIGIN).pathname === '/auth/login');
      expect(res.status === 401 || res.status === 403 || redirectedAway, `${method} ${path}: ${res.status}`).toBe(true);
    }
  });
});
