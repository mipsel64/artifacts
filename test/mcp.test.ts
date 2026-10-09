import { env } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiToken } from '../src/auth';
import { ORIGIN, bearer, createTestUser, request } from './helpers';

afterEach(() => reset());

const MCP_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
const PROTOCOL_VERSION = '2025-11-25';

interface RpcResponse {
  result?: { content?: { type: string; text: string }[]; isError?: boolean; tools?: { name: string; inputSchema: unknown }[]; [key: string]: unknown };
  error?: { message: string };
}

function rpc(token: string, method: string, params?: unknown): Promise<Response> {
  return request('/mcp', {
    method: 'POST',
    headers: { ...MCP_HEADERS, 'mcp-protocol-version': PROTOCOL_VERSION, ...bearer(token) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}

async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await rpc(token, 'tools/call', { name, arguments: args });
  expect(res.status).toBe(200);
  const { result } = (await res.json()) as RpcResponse;
  const text = result?.content?.[0]?.text ?? '';
  return { isError: result?.isError === true, text, value: result?.isError ? undefined : JSON.parse(text) };
}

describe('POST /mcp protocol', () => {
  it('initializes with server info and instructions', async () => {
    const { token } = await createTestUser();
    const res = await request('/mcp', {
      method: 'POST',
      headers: { ...MCP_HEADERS, ...bearer(token) },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'test', version: '0' } },
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const { result } = (await res.json()) as { result: { serverInfo: { name: string; version: string }; instructions: string } };
    expect(result.serverInfo).toMatchObject({ name: 'artifacts', version: '1.0.0' });
    expect(result.instructions.length).toBeGreaterThan(0);
  });

  it('lists the 8 tools with input schemas', async () => {
    const { token } = await createTestUser();
    const { result } = (await (await rpc(token, 'tools/list')).json()) as RpcResponse;
    expect(result?.tools?.map((t) => t.name)).toEqual([
      'list_artifacts',
      'get_artifact',
      'create_artifact',
      'update_artifact',
      'delete_artifact',
      'set_artifact_retention',
      'share_artifact',
      'unshare_artifact',
    ]);
    for (const tool of result?.tools ?? []) expect(tool.inputSchema).toMatchObject({ type: 'object' });
  });
});

describe('MCP tools', () => {
  it('runs the whole artifact lifecycle', async () => {
    const { token } = await createTestUser();

    const created = await callTool(token, 'create_artifact', { title: 'Page', type: 'html', content: '<p>one</p>' });
    expect(created.value).toMatchObject({ title: 'Page', type: 'html', version: 1, shareUrl: null });
    const id = created.value.id as string;
    expect(created.value.url).toBe(`${ORIGIN}/a/${id}`);

    const got = await callTool(token, 'get_artifact', { id });
    expect(got.value).toMatchObject({ id, content: '<p>one</p>', url: `${ORIGIN}/a/${id}` });

    const rewritten = await callTool(token, 'update_artifact', { id, content: '<p>two</p>' });
    expect(rewritten.value.version).toBe(2);

    const edited = await callTool(token, 'update_artifact', { id, old_str: 'two', new_str: 'three' });
    expect(edited.value.version).toBe(3);
    expect((await callTool(token, 'get_artifact', { id })).value.content).toBe('<p>three</p>');
    expect((await callTool(token, 'get_artifact', { id, version: 1 })).value.content).toBe('<p>one</p>');

    const renamed = await callTool(token, 'update_artifact', { id, title: 'Renamed' });
    expect(renamed.value).toMatchObject({ title: 'Renamed', version: 3 });

    const list = await callTool(token, 'list_artifacts');
    expect(list.value.items).toEqual([
      expect.objectContaining({ id, title: 'Renamed', version: 3, shared: false, url: `${ORIGIN}/a/${id}` }),
    ]);

    const shared = await callTool(token, 'share_artifact', { id });
    expect(shared.value.shareUrl.startsWith(`${ORIGIN}/s/`)).toBe(true);
    expect((await callTool(token, 'unshare_artifact', { id })).value.shareUrl).toBeNull();

    expect((await callTool(token, 'set_artifact_retention', { id, permanent: true })).value.expiresAt).toBeNull();
    expect((await callTool(token, 'set_artifact_retention', { id, permanent: false })).value.expiresAt).toEqual(expect.any(String));

    expect((await callTool(token, 'delete_artifact', { id })).value).toEqual({ deleted: id });
    const gone = await callTool(token, 'get_artifact', { id });
    expect(gone).toMatchObject({ isError: true, text: 'Artifact not found' });
  });

  it('returns domain errors as isError results', async () => {
    const { token } = await createTestUser();
    const { value } = await callTool(token, 'create_artifact', { title: 'Page', type: 'html', content: '<p>x</p>' });

    const noMatch = await callTool(token, 'update_artifact', { id: value.id, old_str: 'missing', new_str: 'y' });
    expect(noMatch.isError).toBe(true);
    expect(noMatch.text).toContain('0 matches');

    expect(await callTool(token, 'get_artifact', { id: 'unknown' })).toMatchObject({ isError: true, text: 'Artifact not found' });
    expect((await callTool(token, 'create_artifact', { title: 'Bad', type: 'pdf', content: 'x' })).isError).toBe(true);
    expect((await callTool(token, 'create_artifact', { title: ' ', type: 'html', content: 'x' })).isError).toBe(true);
  });

  it("does not expose one user's artifacts to another", async () => {
    const alice = await createTestUser('alice@example.com', '1');
    const bob = await createTestUser('bob@example.com', '2');
    const { value } = await callTool(alice.token, 'create_artifact', { title: 'Secret', type: 'markdown', content: '# hi' });

    expect((await callTool(bob.token, 'list_artifacts')).value.items).toEqual([]);
    expect(await callTool(bob.token, 'get_artifact', { id: value.id })).toMatchObject({ isError: true, text: 'Artifact not found' });
    expect((await callTool(bob.token, 'delete_artifact', { id: value.id })).isError).toBe(true);
    expect((await callTool(alice.token, 'list_artifacts')).value.items).toHaveLength(1);
  });
});

describe('/mcp authentication and methods', () => {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

  async function expectUnauthorized(res: Response) {
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    );
  }

  it('rejects a missing Authorization header', async () => {
    await expectUnauthorized(await request('/mcp', { method: 'POST', headers: MCP_HEADERS, body }));
  });

  it('rejects an invalid token', async () => {
    await expectUnauthorized(await rpc('art_nope', 'tools/list'));
  });

  it('ignores a valid session cookie', async () => {
    const { cookie } = await createTestUser();
    await expectUnauthorized(await request('/mcp', { method: 'POST', headers: { ...MCP_HEADERS, Cookie: cookie, Origin: ORIGIN }, body }));
  });

  it('rejects a token of a user outside ALLOWED_EMAILS', async () => {
    const { token } = await createApiToken(env, { id: 'google_99', email: 'mallory@example.com' }, 'test');
    await expectUnauthorized(await rpc(token, 'tools/list'));
  });

  it('answers GET and DELETE with 405 for a valid token and with the 401 challenge without one', async () => {
    const { token } = await createTestUser();
    for (const method of ['GET', 'DELETE']) {
      const res = await request('/mcp', { method, headers: bearer(token) });
      expect(res.status).toBe(405);
      expect(res.headers.get('Allow')).toBe('POST');
      await expectUnauthorized(await request('/mcp', { method }));
    }
  });
});
