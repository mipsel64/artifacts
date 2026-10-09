import { env } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { createArtifact, shareArtifact, unshareArtifact, updateArtifact } from '../src/artifacts';
import { renderDocument } from '../src/render';
import { ARTIFACT_TYPES, type ArtifactType } from '../src/types';
import main from '../src/index';
import { ORIGIN, bearer, createTestUser, request } from './helpers';

afterEach(() => reset());

const meta = (type: ArtifactType, language: string | null = null, title = 'Demo') => ({ type, language, title });

function sourceData(doc: string): string {
  const match = /<script type="application\/json" id="artifact-source">([\s\S]*?)<\/script>/.exec(doc);
  if (!match) throw new Error('artifact-source not found');
  return match[1];
}

describe('renderDocument', () => {
  it('returns html content unchanged', () => {
    const html = '<!doctype html><title>x</title><h1>Hi</h1>';
    expect(renderDocument(meta('html'), html)).toBe(html);
  });

  it('inlines svg markup, centred and scaled to fit', () => {
    const svg = '<svg viewBox="0 0 10 10"><circle r="4"/></svg>';
    const doc = renderDocument(meta('svg'), svg);
    expect(doc).toContain(svg);
    expect(doc).toContain('place-items:center');
    expect(doc).toContain('max-width:100vw');
  });

  it('loads marked and github-markdown-css for markdown', () => {
    const doc = renderDocument(meta('markdown'), '# Hi');
    expect(doc).toContain('marked@');
    expect(doc).toContain('github-markdown-css@');
    expect(doc).toContain('class="markdown-body"');
    expect(doc).toContain('marked.parse(');
  });

  it('renders mermaid without startOnLoad and shows syntax errors', () => {
    const doc = renderDocument(meta('mermaid'), 'graph TD; A-->B');
    expect(doc).toContain('mermaid@');
    expect(doc).toContain('startOnLoad: false');
    expect(doc).toContain('mermaid.render(');
    expect(doc).toContain('showError(err)');
  });

  it('highlights code with highlight.js and the requested language', () => {
    const doc = renderDocument(meta('code', 'python'), 'print(1)');
    expect(doc).toContain('@highlightjs/cdn-assets@');
    expect(doc).toContain('data-language="python"');
    expect(doc).toContain('hljs.getLanguage(language)');
    expect(doc).toContain('highlightAuto');
    expect(renderDocument(meta('code'), 'print(1)')).toContain('data-language=""');
  });

  it('loads babel, tailwind and a single react import map for react', () => {
    const doc = renderDocument(meta('react'), 'export default () => <p/>;');
    expect(doc).toContain('@babel/standalone@');
    expect(doc).toContain('@tailwindcss/browser@4');
    const importMap = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(doc)![1]).imports;
    expect(Object.keys(importMap)).toEqual(['react', 'react/', 'react-dom', 'react-dom/']);
    expect(importMap.react).toMatch(/^https:\/\/esm\.sh\/react@19\.\d+\.\d+$/);
    expect(importMap['react/']).toBe(`${importMap.react}/`);
    expect(importMap['react-dom/']).toBe(`${importMap['react-dom']}/`);
    expect(doc).toContain("runtime: 'automatic'");
    expect(doc).toContain("'typescript'");
    expect(doc).toContain('?external=react,react-dom');
    expect(doc).toContain('ImportExpression: rewriteStatic');
    expect(doc).toContain("callee.type === 'Import'");
    expect(doc).toContain('createRoot(');
    expect(doc).toContain('onUncaughtError');
    expect(doc).toContain("addEventListener('unhandledrejection'");
  });

  it.each(ARTIFACT_TYPES.filter((t) => t !== 'html' && t !== 'svg'))(
    'embeds %s source as escaped JSON data that round-trips',
    (type) => {
      const content = 'a </script><script>alert(1)</script> & b\u2028c\u2029d <!-- "q" \\ é';
      const doc = renderDocument(meta(type), content);
      const data = sourceData(doc);
      expect(data).not.toMatch(/[<>&\u2028\u2029]/);
      expect(data.toLowerCase()).not.toContain('</script');
      expect(JSON.parse(data)).toBe(content);
      expect(doc.split(content)).toHaveLength(1);
    },
  );

  it.each(ARTIFACT_TYPES.filter((t) => t !== 'html'))('has charset, viewport and an escaped title for %s', (type) => {
    const doc = renderDocument(meta(type, null, '<b>"A" & \'B\'</b>'), 'x');
    expect(doc).toContain('<meta charset="utf-8">');
    expect(doc).toContain('<meta name="viewport"');
    expect(doc).toContain('<title>&#60;b&#62;&#34;A&#34; &#38; &#39;B&#39;&#60;/b&#62;</title>');
  });

  it('creates the error panel on demand, once, for every scripted type', () => {
    for (const type of ['react', 'markdown', 'mermaid', 'code'] as const) {
      const doc = renderDocument(meta(type), 'x');
      expect(doc.match(/artifact-error/g)).toHaveLength(3);
      expect(doc).not.toContain('<pre id="artifact-error"');
      expect(doc).toContain("document.createElement('pre')");
      expect(doc).toContain("addEventListener('error'");
    }
  });

  it('pins an exact version in every CDN URL', () => {
    for (const type of ['react', 'markdown', 'mermaid', 'code'] as const) {
      const doc = renderDocument(meta(type), 'x');
      const urls = (doc.replace(sourceData(doc), '').match(/https:\/\/[^\s"'`<>)]+/g) ?? []).filter((u) => u !== 'https://esm.sh/');
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) {
        expect(url).not.toContain('@latest');
        expect(url).toMatch(/\/\*?(@[\w-]+\/)?[\w.-]+@\d+\.\d+\.\d+/);
      }
    }
  });
});

const SANDBOX = 'sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads';

function expectSandboxResponse(res: Response, contentType: string) {
  expect(res.headers.get('Content-Type')).toBe(contentType);
  expectSandboxHeaders(res);
}

function expectSandboxHeaders(res: Response) {
  expect(res.headers.get('Content-Security-Policy')).toBe(SANDBOX);
  expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
  expect(res.headers.get('Cache-Control')).toBe('private, no-store');
}

describe('GET /render/:id', () => {
  it('renders the latest version for the owner with sandbox headers', async () => {
    const { user, token } = await createTestUser('alice', 1);
    const artifact = await createArtifact(env, user.id, { title: 'Page', type: 'html', content: '<h1>v1</h1>' });
    const res = await request(`/render/${artifact.id}`, { headers: bearer(token) });
    expect(res.status).toBe(200);
    expectSandboxResponse(res, 'text/html; charset=utf-8');
    expect(await res.text()).toBe('<h1>v1</h1>');
  });

  it('accepts the session cookie and renders non-html types as documents', async () => {
    const { user, cookie } = await createTestUser('alice', 1);
    const artifact = await createArtifact(env, user.id, { title: 'Notes', type: 'markdown', content: '# Hi' });
    const res = await request(`/render/${artifact.id}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<title>Notes</title>');
    expect(JSON.parse(sourceData(body))).toBe('# Hi');
  });

  it('renders the requested version with ?v=', async () => {
    const { user, token } = await createTestUser('alice', 1);
    const artifact = await createArtifact(env, user.id, { title: 'Page', type: 'html', content: '<h1>v1</h1>' });
    await updateArtifact(env, user.id, artifact.id, { content: '<h1>v2</h1>' });
    const v1 = await request(`/render/${artifact.id}?v=1`, { headers: bearer(token) });
    expect(await v1.text()).toBe('<h1>v1</h1>');
    const latest = await request(`/render/${artifact.id}`, { headers: bearer(token) });
    expect(await latest.text()).toBe('<h1>v2</h1>');
    expect((await request(`/render/${artifact.id}?v=3`, { headers: bearer(token) })).status).toBe(404);
  });

  it.each(['0', '-1', '1.5', 'abc', ''])('rejects v=%j with 400', async (v) => {
    const { user, token } = await createTestUser('alice', 1);
    const artifact = await createArtifact(env, user.id, { title: 'Page', type: 'html', content: '<p>x</p>' });
    const res = await request(`/render/${artifact.id}?v=${v}`, { headers: bearer(token) });
    expect(res.status).toBe(400);
    expectSandboxHeaders(res);
  });

  it('returns 404 for another user and for an unknown id', async () => {
    const alice = await createTestUser('alice', 1);
    const bob = await createTestUser('bob', 2);
    const artifact = await createArtifact(env, alice.user.id, { title: 'Page', type: 'html', content: '<p>x</p>' });
    const other = await request(`/render/${artifact.id}`, { headers: bearer(bob.token) });
    expect(other.status).toBe(404);
    expectSandboxHeaders(other);
    expect((await request('/render/nope', { headers: bearer(bob.token) })).status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const { user } = await createTestUser('alice', 1);
    const artifact = await createArtifact(env, user.id, { title: 'Page', type: 'html', content: '<p>x</p>' });
    const res = await request(`/render/${artifact.id}`);
    expect(res.status).toBe(401);
    expectSandboxHeaders(res);
  });
});

describe('shared artifact routes', () => {
  async function shared(type: 'html' | 'code' = 'html', content = '<h1>shared</h1>') {
    const { user } = await createTestUser('alice', 1);
    const artifact = await createArtifact(env, user.id, { title: 'My Page', type, content, language: 'python' });
    const { shareId } = await shareArtifact(env, user.id, artifact.id);
    return { user, artifact, shareId: shareId! };
  }

  it('renders a shared artifact without auth, latest version', async () => {
    const { user, artifact, shareId } = await shared();
    await updateArtifact(env, user.id, artifact.id, { content: '<h1>latest</h1>' });
    const res = await request(`/s/${shareId}/render`);
    expect(res.status).toBe(200);
    expectSandboxResponse(res, 'text/html; charset=utf-8');
    expect(await res.text()).toBe('<h1>latest</h1>');
  });

  it('serves raw text without auth', async () => {
    const { shareId } = await shared('html', '<h1>shared</h1>');
    const res = await request(`/s/${shareId}/raw`);
    expect(res.status).toBe(200);
    expectSandboxResponse(res, 'text/plain; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toBeNull();
    expect(await res.text()).toBe('<h1>shared</h1>');
  });

  it('adds an attachment disposition with download=1', async () => {
    const { shareId } = await shared('code', 'print(1)');
    const res = await request(`/s/${shareId}/raw?download=1`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="my-page.py"');
    expect(await res.text()).toBe('print(1)');
  });

  it('returns 404 for unknown, unshared and expired shares', async () => {
    for (const path of ['/s/unknown/render', '/s/unknown/raw']) {
      const res = await request(path);
      expect(res.status).toBe(404);
      expectSandboxHeaders(res);
    }

    const { user, artifact, shareId } = await shared();
    await unshareArtifact(env, user.id, artifact.id);
    expect((await request(`/s/${shareId}/render`)).status).toBe(404);
    expect((await request(`/s/${shareId}/raw`)).status).toBe(404);

    const old = new Date('2020-01-01T00:00:00.000Z');
    const expired = await createArtifact(env, user.id, { title: 'Old', type: 'html', content: '<p>old</p>' }, old);
    const { shareId: expiredShare } = await shareArtifact(env, user.id, expired.id, old);
    expect((await request(`/s/${expiredShare}/render`)).status).toBe(404);
    expect((await request(`/s/${expiredShare}/raw`)).status).toBe(404);
  });

  it('keeps sandbox headers on 500 responses', async () => {
    const { shareId } = await shared();
    const broken = new Proxy(env.BUCKET, {
      get(target, prop) {
        if (prop === 'get') return () => Promise.reject(new Error('R2 down'));
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const res = await main.fetch(new Request(`${ORIGIN}/s/${shareId}/raw`), { ...env, BUCKET: broken });
    expect(res.status).toBe(500);
    expectSandboxHeaders(res);
  });

  it('does not add sandbox headers to /s/:shareId or other paths', async () => {
    const { shareId } = await shared();
    for (const path of [`/s/${shareId}`, '/s/x', '/s/x/other', '/render', '/']) {
      const res = await request(path);
      expect(res.headers.get('Content-Security-Policy')).toBeNull();
      expect(res.headers.get('Cache-Control')).not.toBe('private, no-store');
    }
  });
});
