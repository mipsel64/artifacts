import { reset } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import type { ArtifactSummary, ArtifactView } from '../src/types';
import { ORIGIN, bearer, createTestUser, request } from './helpers';

afterEach(() => reset());

const input = { title: 'Hello World', type: 'html', content: '<p>hi</p>' };

function send(token: string, method: string, path: string, body?: unknown) {
  return request(path, {
    method,
    headers: { ...bearer(token), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function setup() {
  const alice = await createTestUser('alice@example.com', '1');
  const bob = await createTestUser('bob@example.com', '2');
  return { alice, bob };
}

async function create(token: string, body: unknown = input): Promise<ArtifactView> {
  const res = await send(token, 'POST', '/api/artifacts', body);
  expect(res.status).toBe(201);
  return res.json();
}

describe('create and read', () => {
  it('creates, reads and lists with Bearer auth', async () => {
    const { alice } = await setup();
    const created = await create(alice.token);
    expect(created).toMatchObject({ title: 'Hello World', type: 'html', version: 1, ownerId: alice.user.id });
    expect(created.url).toBe(`${ORIGIN}/a/${created.id}`);
    expect(created.shareUrl).toBeNull();

    const got = await send(alice.token, 'GET', `/api/artifacts/${created.id}`);
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual(created);

    const list = await send(alice.token, 'GET', '/api/artifacts');
    expect(list.status).toBe(200);
    const { items } = (await list.json()) as { items: ArtifactSummary[] };
    expect(items).toEqual([expect.objectContaining({ id: created.id, title: 'Hello World', shared: false })]);
  });

  it('accepts a language', async () => {
    const { alice } = await setup();
    const created = await create(alice.token, { title: 'x', type: 'code', content: 'print(1)', language: 'python' });
    expect(created.language).toBe('python');
  });

  it.each([
    ['title', { ...input, title: '  ' }, 400],
    ['missing title', { type: 'html', content: 'x' }, 400],
    ['type', { ...input, type: 'pdf' }, 400],
    ['content', { ...input, content: '' }, 400],
    ['missing content', { title: 'x', type: 'html' }, 400],
    ['size', { ...input, content: 'a'.repeat(1024 * 1024 + 1) }, 413],
  ])('rejects invalid %s', async (_name, body, status) => {
    const { alice } = await setup();
    const res = await send(alice.token, 'POST', '/api/artifacts', body);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });

  it.each([
    ['invalid JSON', '{nope'],
    ['array', '[]'],
    ['null', 'null'],
    ['string', '"x"'],
  ])('rejects %s body with 400', async (_name, body) => {
    const { alice } = await setup();
    for (const [method, path] of [
      ['POST', '/api/artifacts'],
      ['PATCH', '/api/artifacts/x'],
      ['PUT', '/api/artifacts/x/retention'],
    ]) {
      const res = await request(path, { method, headers: bearer(alice.token), body });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: expect.any(String) });
    }
  });
});

describe('update', () => {
  it('renames without a new version', async () => {
    const { alice } = await setup();
    const a = await create(alice.token);
    const res = await send(alice.token, 'PATCH', `/api/artifacts/${a.id}`, { title: 'Renamed' });
    expect(res.status).toBe(200);
    const view = (await res.json()) as ArtifactView;
    expect(view).toMatchObject({ title: 'Renamed', version: 1 });
    expect(view.url).toBe(`${ORIGIN}/a/${a.id}`);
  });

  it('adds a version with full content', async () => {
    const { alice } = await setup();
    const a = await create(alice.token);
    const res = await send(alice.token, 'PATCH', `/api/artifacts/${a.id}`, { content: '<p>new</p>' });
    expect(await res.json()).toMatchObject({ version: 2 });
  });

  it('adds a version with old_str/new_str', async () => {
    const { alice } = await setup();
    const a = await create(alice.token);
    const res = await send(alice.token, 'PATCH', `/api/artifacts/${a.id}`, { old_str: 'hi', new_str: 'bye' });
    expect(await res.json()).toMatchObject({ version: 2 });
    const content = await send(alice.token, 'GET', `/api/artifacts/${a.id}/content`);
    expect(await content.text()).toBe('<p>bye</p>');
  });

  it('rejects content with old_str, no-op and non-matching old_str', async () => {
    const { alice } = await setup();
    const a = await create(alice.token);
    for (const body of [{ content: 'x', old_str: 'hi', new_str: 'y' }, {}, { old_str: 'zzz', new_str: 'y' }]) {
      const res = await send(alice.token, 'PATCH', `/api/artifacts/${a.id}`, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: expect.any(String) });
    }
  });
});

describe('content', () => {
  it('returns latest and a specific version with headers', async () => {
    const { alice } = await setup();
    const a = await create(alice.token);
    await send(alice.token, 'PATCH', `/api/artifacts/${a.id}`, { content: 'second' });

    const latest = await send(alice.token, 'GET', `/api/artifacts/${a.id}/content`);
    expect(latest.status).toBe(200);
    expect(await latest.text()).toBe('second');
    expect(latest.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(latest.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(latest.headers.get('Cache-Control')).toBe('private, no-store');
    expect(latest.headers.get('Content-Disposition')).toBeNull();

    const first = await send(alice.token, 'GET', `/api/artifacts/${a.id}/content?version=1`);
    expect(await first.text()).toBe('<p>hi</p>');
  });

  it('rejects bad versions and 404s unknown ones', async () => {
    const { alice } = await setup();
    const a = await create(alice.token);
    for (const v of ['0', '-1', 'abc', '1.5', '', '01']) {
      const res = await send(alice.token, 'GET', `/api/artifacts/${a.id}/content?version=${v}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: expect.any(String) });
    }
    const res = await send(alice.token, 'GET', `/api/artifacts/${a.id}/content?version=9`);
    expect(res.status).toBe(404);
  });

  it('adds a download disposition with the file name', async () => {
    const { alice } = await setup();
    const a = await create(alice.token);
    const res = await send(alice.token, 'GET', `/api/artifacts/${a.id}/content?download=1`);
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="hello-world.html"');
    const code = await create(alice.token, { title: 'My Script', type: 'code', content: 'x', language: 'python' });
    const res2 = await send(alice.token, 'GET', `/api/artifacts/${code.id}/content?download=1`);
    expect(res2.headers.get('Content-Disposition')).toBe('attachment; filename="my-script.py"');
  });
});

describe('retention', () => {
  it('sets permanent and expiring', async () => {
    const { alice } = await setup();
    const a = await create(alice.token);
    expect(a.expiresAt).not.toBeNull();
    const permanent = await send(alice.token, 'PUT', `/api/artifacts/${a.id}/retention`, { permanent: true });
    expect(permanent.status).toBe(200);
    expect(await permanent.json()).toMatchObject({ expiresAt: null });
    const expiring = await send(alice.token, 'PUT', `/api/artifacts/${a.id}/retention`, { permanent: false });
    expect(((await expiring.json()) as ArtifactView).expiresAt).not.toBeNull();
  });

  it('rejects a non-boolean permanent', async () => {
    const { alice } = await setup();
    const a = await create(alice.token);
    for (const body of [{ permanent: 'true' }, { permanent: 1 }, {}]) {
      const res = await send(alice.token, 'PUT', `/api/artifacts/${a.id}/retention`, body);
      expect(res.status).toBe(400);
    }
  });
});

describe('share', () => {
  it('shares, is idempotent, and unshares', async () => {
    const { alice } = await setup();
    const a = await create(alice.token);
    const shared = await send(alice.token, 'POST', `/api/artifacts/${a.id}/share`);
    expect(shared.status).toBe(200);
    const view = (await shared.json()) as ArtifactView;
    expect(view.shareId).toEqual(expect.any(String));
    expect(view.shareUrl).toBe(`${ORIGIN}/s/${view.shareId}`);

    const again = (await (await send(alice.token, 'POST', `/api/artifacts/${a.id}/share`)).json()) as ArtifactView;
    expect(again.shareUrl).toBe(view.shareUrl);

    const unshared = await send(alice.token, 'DELETE', `/api/artifacts/${a.id}/share`);
    expect(unshared.status).toBe(200);
    expect(await unshared.json()).toMatchObject({ shareId: null, shareUrl: null });
  });
});

describe('delete', () => {
  it('returns 204 then 404 and removes it from the list', async () => {
    const { alice } = await setup();
    const a = await create(alice.token);
    const del = await send(alice.token, 'DELETE', `/api/artifacts/${a.id}`);
    expect(del.status).toBe(204);
    expect(await del.text()).toBe('');
    expect((await send(alice.token, 'GET', `/api/artifacts/${a.id}`)).status).toBe(404);
    expect((await send(alice.token, 'DELETE', `/api/artifacts/${a.id}`)).status).toBe(404);
    const { items } = (await (await send(alice.token, 'GET', '/api/artifacts')).json()) as { items: unknown[] };
    expect(items).toEqual([]);
  });
});

describe('auth and ownership', () => {
  it('returns 401 without auth', async () => {
    for (const [method, path] of [
      ['GET', '/api/artifacts'],
      ['POST', '/api/artifacts'],
      ['GET', '/api/artifacts/x'],
      ['GET', '/api/artifacts/x/content'],
      ['PATCH', '/api/artifacts/x'],
      ['DELETE', '/api/artifacts/x'],
      ['PUT', '/api/artifacts/x/retention'],
      ['POST', '/api/artifacts/x/share'],
      ['DELETE', '/api/artifacts/x/share'],
    ]) {
      const res = await request(path, { method });
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(await res.json()).toEqual({ error: 'Unauthorized' });
    }
  });

  it('works with cookies: GET, and POST with Origin', async () => {
    const { alice } = await setup();
    const list = await request('/api/artifacts', { headers: { Cookie: alice.cookie } });
    expect(list.status).toBe(200);
    const created = await request('/api/artifacts', {
      method: 'POST',
      headers: { Cookie: alice.cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect(created.status).toBe(201);
  });

  it('rejects cookie POST without Origin or with a foreign Origin', async () => {
    const { alice } = await setup();
    for (const origin of [undefined, 'https://evil.test']) {
      const res = await request('/api/artifacts', {
        method: 'POST',
        headers: { Cookie: alice.cookie, ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      expect(res.status).toBe(403);
    }
  });

  it("returns 404 for another user's artifact on every :id route", async () => {
    const { alice, bob } = await setup();
    const a = await create(alice.token);
    for (const [method, path, body] of [
      ['GET', `/api/artifacts/${a.id}`, undefined],
      ['GET', `/api/artifacts/${a.id}/content`, undefined],
      ['PATCH', `/api/artifacts/${a.id}`, { title: 'x' }],
      ['DELETE', `/api/artifacts/${a.id}`, undefined],
      ['PUT', `/api/artifacts/${a.id}/retention`, { permanent: true }],
      ['POST', `/api/artifacts/${a.id}/share`, undefined],
      ['DELETE', `/api/artifacts/${a.id}/share`, undefined],
    ] as const) {
      const res = await send(bob.token, method, path, body);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    const { items } = (await (await send(bob.token, 'GET', '/api/artifacts')).json()) as { items: unknown[] };
    expect(items).toEqual([]);
    expect((await send(alice.token, 'GET', `/api/artifacts/${a.id}`)).status).toBe(200);
  });

  it('does not apply auth to paths it does not own', async () => {
    const res = await request('/api/artifactsfoo');
    expect(res.status).toBe(404);
  });
});
