import { env } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { createArtifact, deleteArtifact, getArtifact, sweepExpired, updateArtifact } from '../src/artifacts';
import { ARCHIFY_VERSION, archifyCacheKey } from '../src/archify';
import { renderStoredDocument, THEME_CSS, THEME_SCRIPT } from '../src/render';
import architecture from '../skills/artifacts/references/archify/examples/web-app.architecture.json';
import type { ArtifactSummary, ArtifactView } from '../src/types';
import { bearer, createTestUser, request } from './helpers';

afterEach(() => reset());

const { output: _output, ...meta } = architecture.meta;
const ARCHIFY_JSON = JSON.stringify({ ...architecture, meta });
const ARCHIFY_MARKDOWN = `# Cache behavior {#cache}

A cache stores values.

@meta locale=en quality_profile=standard

## What should you check? {#checks}

- Check the cache key.

@sequence id=cache-flow title="Cache flow"
| actor api | API | backend |
| actor redis | Redis | database |
| api | redis | GET order |
| redis | api | value | return |
`;
const MCP_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

function send(token: string, method: string, path: string, body?: unknown) {
  return request(path, {
    method,
    headers: { ...bearer(token), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function create(token: string, content = ARCHIFY_JSON, title = 'Sample Web App') {
  const res = await send(token, 'POST', '/api/artifacts', { title, type: 'archify', content });
  expect(res.status).toBe(201);
  return (await res.json()) as ArtifactView;
}

async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await request('/mcp', {
    method: 'POST',
    headers: { ...MCP_HEADERS, 'mcp-protocol-version': '2025-11-25', ...bearer(token) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  expect(res.status).toBe(200);
  const { result } = (await res.json()) as {
    result?: { content?: { text: string }[]; isError?: boolean };
  };
  const text = result?.content?.[0]?.text ?? '';
  return { isError: result?.isError === true, text, value: result?.isError ? undefined : JSON.parse(text) };
}

describe('Archify artifact writes', () => {
  it('rejects an invalid REST create with diagnostics and stores nothing', async () => {
    const { token } = await createTestUser();
    const res = await send(token, 'POST', '/api/artifacts', { title: 'Broken', type: 'archify', content: '{' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/^Archify candidate is invalid:\n\[archify-json\]/) });
    const list = await (await send(token, 'GET', '/api/artifacts')).json() as { items: ArtifactSummary[] };
    expect(list.items).toEqual([]);
  });

  it('returns MCP diagnostics and stores nothing for an invalid create', async () => {
    const { token } = await createTestUser();
    const result = await callTool(token, 'create_artifact', { title: 'Broken', type: 'archify', content: '{' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^Archify candidate is invalid:\n\[archify-json\]/);
    expect((await callTool(token, 'list_artifacts')).value.items).toEqual([]);
  });

  it('stores a valid candidate unchanged and permits a title-only update without rendering', async () => {
    const { user, token } = await createTestUser();
    const artifact = await create(token);
    expect(await (await send(token, 'GET', `/api/artifacts/${artifact.id}/content`)).text()).toBe(ARCHIFY_JSON);
    const stored = await getArtifact(env, user.id, artifact.id);
    await env.BUCKET.put(stored.versions[0].key, '{');
    const renamed = await updateArtifact(env, user.id, artifact.id, { title: 'Renamed' });
    expect(renamed).toMatchObject({ title: 'Renamed', version: 1 });
  });

  it('rejects an old_str edit that breaks the candidate and keeps the previous version latest', async () => {
    const { token } = await createTestUser();
    const artifact = await create(token);
    const res = await send(token, 'PATCH', `/api/artifacts/${artifact.id}`, {
      old_str: '"Sample Web App"',
      new_str: 'broken',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.stringContaining('[archify-json]') });
    expect(await (await send(token, 'GET', `/api/artifacts/${artifact.id}`)).json()).toMatchObject({ version: 1 });
    expect(await (await send(token, 'GET', `/api/artifacts/${artifact.id}/content`)).text()).toBe(ARCHIFY_JSON);
  });

  it('rejects a full-content update and keeps the previous version latest', async () => {
    const { token } = await createTestUser();
    const artifact = await create(token);
    const res = await send(token, 'PATCH', `/api/artifacts/${artifact.id}`, { content: '{' });
    expect(res.status).toBe(400);
    expect(await (await send(token, 'GET', `/api/artifacts/${artifact.id}`)).json()).toMatchObject({ version: 1 });
    expect(await (await send(token, 'GET', `/api/artifacts/${artifact.id}/content`)).text()).toBe(ARCHIFY_JSON);
  });

  it('rolls back both version objects after an etag failure', async () => {
    const { user, token } = await createTestUser();
    const artifact = await create(token);
    const metaKey = `artifacts/${artifact.id}/meta.json`;
    const attemptedKeys: string[] = [];
    let failed = false;
    const racing = new Proxy(env.BUCKET, {
      get(target, prop) {
        if (prop === 'put') {
          return async (key: string, value: string, options?: R2PutOptions) => {
            if (key.startsWith(`artifacts/${artifact.id}/v/`) && !key.endsWith('.html')) attemptedKeys.push(key);
            if (key === metaKey && options?.onlyIf && !failed) {
              failed = true;
              return null;
            }
            return target.put(key, value, options);
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const updated = await updateArtifact({ ...env, BUCKET: racing }, user.id, artifact.id, {
      content: ARCHIFY_JSON.replace('Sample Web App', 'Second Version'),
    });
    expect(updated.version).toBe(2);
    expect(attemptedKeys).toHaveLength(2);
    expect(await env.BUCKET.get(attemptedKeys[0])).toBeNull();
    expect(await env.BUCKET.get(archifyCacheKey(attemptedKeys[0]))).toBeNull();
    expect(await env.BUCKET.get(attemptedKeys[1])).not.toBeNull();
    expect(await env.BUCKET.get(archifyCacheKey(attemptedKeys[1]))).not.toBeNull();
  });
});

describe('Archify artifact reads', () => {
  it('wraps the upstream document with theme synchronization and print readiness', async () => {
    const { token } = await createTestUser();
    const artifact = await create(token);
    const res = await request(`/r/${artifact.id}?print=1`, { headers: bearer(token) });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<h1>Sample Web App</h1>');
    expect(body).not.toContain(THEME_CSS);
    const bridge = body.indexOf("window.addEventListener('artifact-theme'");
    const theme = body.indexOf(THEME_SCRIPT);
    const ready = body.indexOf('<script>window.__artifactReady = true</script>');
    expect(bridge).toBeGreaterThan(-1);
    expect(theme).toBeGreaterThan(bridge);
    expect(ready).toBeGreaterThan(theme);
    expect(body.indexOf('window.print()')).toBeGreaterThan(ready);
  });

  it('returns a themed escaped diagnostic document for a render-time ArchifyError', async () => {
    const { user, token } = await createTestUser();
    const artifact = await create(token);
    const stored = await getArtifact(env, user.id, artifact.id);
    await env.BUCKET.delete(archifyCacheKey(stored.versions[0].key));
    await env.BUCKET.put(stored.versions[0].key, '{ <');
    const res = await request(`/r/${artifact.id}`, { headers: bearer(token) });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Archify could not render this candidate.');
    expect(body).toContain('[archify-json]');
    expect(body).toContain(THEME_CSS);
    expect(body).toContain(':root{color-scheme:light}:root[data-theme=dark]{color-scheme:dark}');
    expect(body).not.toContain('{ <');
  });

  it('uses content-aware download extensions and Markdown fences', async () => {
    const { token } = await createTestUser();
    const json = await create(token);
    const markdown = await create(token, ARCHIFY_MARKDOWN, 'Cache behavior');
    const jsonDownload = await send(token, 'GET', `/api/artifacts/${json.id}/content?download=1`);
    expect(jsonDownload.headers.get('Content-Disposition')).toBe('attachment; filename="sample-web-app.json"');
    const markdownDownload = await send(token, 'GET', `/api/artifacts/${markdown.id}/content?download=1`);
    expect(markdownDownload.headers.get('Content-Disposition')).toBe('attachment; filename="cache-behavior.archify.md"');
    expect(await (await send(token, 'GET', `/api/artifacts/${json.id}/export?format=md`)).text()).toContain('```json\n' + ARCHIFY_JSON);
    expect(await (await send(token, 'GET', `/api/artifacts/${markdown.id}/export?format=md`)).text()).toContain('```markdown\n' + ARCHIFY_MARKDOWN);
  });

  it('serves and exports the cached HTML for the requested version', async () => {
    const { user, token } = await createTestUser();
    const artifact = await create(token);
    const first = await getArtifact(env, user.id, artifact.id);
    const firstCacheKey = archifyCacheKey(first.versions[0].key);
    const cached = await env.BUCKET.get(firstCacheKey);
    expect(cached?.customMetadata).toMatchObject({ ARCHIFY_VERSION });

    const updated = await send(token, 'PATCH', `/api/artifacts/${artifact.id}`, {
      content: ARCHIFY_JSON.replace('Sample Web App', 'Second Version'),
    });
    expect(updated.status).toBe(200);
    await env.BUCKET.put(first.versions[0].key, '{');
    const oldView = await request(`/r/${artifact.id}?v=1`, { headers: bearer(token) });
    expect(await oldView.text()).toContain('<h1>Sample Web App</h1>');
    const oldExport = await send(token, 'GET', `/api/artifacts/${artifact.id}/export?format=html&version=1`);
    expect(await oldExport.text()).toContain('<h1>Sample Web App</h1>');

    await send(token, 'POST', `/api/artifacts/${artifact.id}/share`);
    const shared = await (await send(token, 'GET', `/api/artifacts/${artifact.id}`)).json() as ArtifactView;
    const publicView = await request(`/s/${shared.shareId}/render`);
    expect(await publicView.text()).toContain('<h1>Second Version</h1>');
  });

  it('fills a missing cache and replaces a renderer-version mismatch', async () => {
    const { user, token } = await createTestUser();
    const artifact = await create(token);
    const stored = await getArtifact(env, user.id, artifact.id);
    const cacheKey = archifyCacheKey(stored.versions[0].key);
    await env.BUCKET.delete(cacheKey);
    expect(await (await request(`/r/${artifact.id}`, { headers: bearer(token) })).text()).toContain('<h1>Sample Web App</h1>');
    expect((await env.BUCKET.get(cacheKey))?.customMetadata).toMatchObject({ ARCHIFY_VERSION });

    await env.BUCKET.put(cacheKey, '<html>stale</html>', { customMetadata: { ARCHIFY_VERSION: '0.0.0' } });
    const view = await request(`/r/${artifact.id}`, { headers: bearer(token) });
    expect(await view.text()).toContain('<h1>Sample Web App</h1>');
    expect((await env.BUCKET.get(cacheKey))?.customMetadata).toMatchObject({ ARCHIFY_VERSION });
  });

  it('serves the render when a cache write fails', async () => {
    const { user, token } = await createTestUser();
    const artifact = await create(token);
    const stored = await getArtifact(env, user.id, artifact.id);
    const cacheKey = archifyCacheKey(stored.versions[0].key);
    await env.BUCKET.delete(cacheKey);
    const broken = new Proxy(env.BUCKET, {
      get(target, prop) {
        if (prop === 'put') {
          return async (key: string, value: string, options?: R2PutOptions) => {
            if (key === cacheKey) throw new Error('R2 write failed');
            return target.put(key, value, options);
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const body = await renderStoredDocument({ ...env, BUCKET: broken }, stored, ARCHIFY_JSON);
    expect(body).toContain('<h1>Sample Web App</h1>');
    expect(await env.BUCKET.get(cacheKey)).toBeNull();
  });

  it('cleans a cache fill that finishes after artifact deletion', async () => {
    const { user, token } = await createTestUser();
    const artifact = await create(token);
    const stored = await getArtifact(env, user.id, artifact.id);
    const cacheKey = archifyCacheKey(stored.versions[0].key);
    await env.BUCKET.delete(cacheKey);
    const racing = new Proxy(env.BUCKET, {
      get(target, prop) {
        if (prop === 'put') {
          return async (key: string, value: string, options?: R2PutOptions) => {
            if (key === cacheKey) await deleteArtifact(env, user.id, artifact.id);
            return target.put(key, value, options);
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const body = await renderStoredDocument({ ...env, BUCKET: racing }, stored, ARCHIFY_JSON);
    expect(body).toContain('<h1>Sample Web App</h1>');
    expect(await env.BUCKET.get(cacheKey)).toBeNull();
  });

  it('deletes cached HTML with the artifact', async () => {
    const { user, token } = await createTestUser();
    const artifact = await create(token);
    const stored = await getArtifact(env, user.id, artifact.id);
    const cacheKey = archifyCacheKey(stored.versions[0].key);
    expect(await env.BUCKET.get(cacheKey)).not.toBeNull();
    expect((await send(token, 'DELETE', `/api/artifacts/${artifact.id}`)).status).toBe(204);
    expect(await env.BUCKET.get(cacheKey)).toBeNull();
  });

  it('deletes cached HTML during the expiry sweep', async () => {
    const { user } = await createTestUser();
    const artifact = await createArtifact(env, user.id, {
      title: 'Old Archify', type: 'archify', content: ARCHIFY_JSON,
    }, new Date('2020-01-01T00:00:00.000Z'));
    const cacheKey = archifyCacheKey(artifact.versions[0].key);
    expect(await env.BUCKET.get(cacheKey)).not.toBeNull();
    expect(await sweepExpired(env, new Date())).toBe(1);
    expect(await env.BUCKET.get(cacheKey)).toBeNull();
  });

  it('exposes Archify in the create-tool input schema', async () => {
    const { token } = await createTestUser();
    const res = await request('/mcp', {
      method: 'POST',
      headers: { ...MCP_HEADERS, 'mcp-protocol-version': '2025-11-25', ...bearer(token) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    const body = await res.json() as { result: { tools: { name: string; inputSchema: unknown }[] } };
    const createTool = body.result.tools.find((tool) => tool.name === 'create_artifact');
    expect(createTool).toBeDefined();
    expect(JSON.stringify(createTool?.inputSchema)).toContain('"archify"');
  });
});
