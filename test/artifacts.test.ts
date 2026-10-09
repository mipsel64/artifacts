import { env } from 'cloudflare:workers';
import { createExecutionContext, createScheduledController, reset, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ArtifactError,
  MAX_CONTENT_BYTES,
  createArtifact,
  deleteArtifact,
  fileName,
  getArtifact,
  getContent,
  getSharedArtifact,
  listArtifacts,
  setRetention,
  shareArtifact,
  sweepExpired,
  toView,
  unshareArtifact,
  updateArtifact,
} from '../src/artifacts';
import main from '../src/index';
import type { ArtifactMeta } from '../src/types';

afterEach(() => reset());

const T0 = new Date('2026-01-01T00:00:00.000Z');
const days = (n: number) => new Date(T0.getTime() + n * 24 * 3600 * 1000);
const input = { title: 'Hello', type: 'html' as const, content: '<p>hi</p>' };

async function allKeys(): Promise<string[]> {
  const r2 = (await env.BUCKET.list()).objects.map((o) => `r2:${o.key}`);
  const kv = (await env.KV.list()).keys.map((k) => `kv:${k.name}`);
  return [...r2, ...kv];
}

function flakyKv(failures: { put?: number; delete?: number }): Env {
  const remaining = { put: failures.put ?? 0, delete: failures.delete ?? 0 };
  const kv = new Proxy(env.KV, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        if ((prop === 'put' || prop === 'delete') && remaining[prop]-- > 0) throw new Error('KV 429');
        return value.apply(target, args);
      };
    },
  });
  return { ...env, KV: kv };
}

function failingBucketDelete(): Env {
  const bucket = new Proxy(env.BUCKET, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        if (prop === 'delete') throw new Error('purge interrupted');
        return value.apply(target, args);
      };
    },
  });
  return { ...env, BUCKET: bucket };
}

async function status(promise: Promise<unknown>): Promise<number | undefined> {
  try {
    await promise;
  } catch (err) {
    return err instanceof ArtifactError ? err.status : undefined;
  }
  return undefined;
}

describe('create and read', () => {
  it('creates version 1 expiring in 30 days and reads it back', async () => {
    const meta = await createArtifact(env, 'u1', { ...input, language: 'html' }, T0);
    expect(meta.version).toBe(1);
    expect(meta.versions).toHaveLength(1);
    expect(meta.expiresAt).toBe(days(30).toISOString());
    expect(meta.shareId).toBeNull();
    expect(meta.id).toHaveLength(22);
    expect(await getArtifact(env, 'u1', meta.id, T0)).toEqual(meta);
    expect(await getContent(env, meta)).toBe('<p>hi</p>');
  });

  it('keeps only meta.json and version objects in R2 and the index in KV', async () => {
    const meta = await createArtifact(env, 'u1', input, T0);
    const keys = await allKeys();
    expect(keys).toHaveLength(3);
    expect(keys).toContain(`r2:artifacts/${meta.id}/meta.json`);
    expect(keys).toContain(`kv:index:u1:${meta.id}`);
    expect(meta.versions[0].key).toMatch(new RegExp(`^artifacts/${meta.id}/v/1-`));
  });

  it('trims the title and rejects invalid input with 400', async () => {
    expect((await createArtifact(env, 'u1', { ...input, title: '  Hi  ' }, T0)).title).toBe('Hi');
    const bad = [
      { ...input, title: '   ' },
      { ...input, title: 'x'.repeat(201) },
      { ...input, type: 'pdf' as never },
      { ...input, content: '' },
      { ...input, content: 5 as never },
      { ...input, language: 'x'.repeat(33) },
      { ...input, language: 'bad lang!' },
    ];
    for (const value of bad) expect(await status(createArtifact(env, 'u1', value, T0))).toBe(400);
  });

  it('accepts 1 MiB of content and rejects more with 413 (UTF-8 bytes)', async () => {
    await createArtifact(env, 'u1', { ...input, content: 'a'.repeat(MAX_CONTENT_BYTES) }, T0);
    expect(await status(createArtifact(env, 'u1', { ...input, content: 'a'.repeat(MAX_CONTENT_BYTES + 1) }, T0))).toBe(413);
    const multibyte = 'é'.repeat(MAX_CONTENT_BYTES / 2 + 1);
    expect(multibyte.length).toBeLessThan(MAX_CONTENT_BYTES);
    expect(await status(createArtifact(env, 'u1', { ...input, content: multibyte }, T0))).toBe(413);
  });

  it('is 404 for another owner or a missing id', async () => {
    const meta = await createArtifact(env, 'u1', input, T0);
    expect(await status(getArtifact(env, 'u2', meta.id, T0))).toBe(404);
    expect(await status(getArtifact(env, 'u1', 'missing', T0))).toBe(404);
    expect(await status(updateArtifact(env, 'u2', meta.id, { title: 'x' }, T0))).toBe(404);
    expect(await status(deleteArtifact(env, 'u2', meta.id))).toBe(404);
  });
});

describe('updateArtifact', () => {
  it('writes a new version and keeps old versions readable', async () => {
    const v1 = await createArtifact(env, 'u1', input, T0);
    const v2 = await updateArtifact(env, 'u1', v1.id, { content: 'second' }, days(1));
    expect(v2.version).toBe(2);
    expect(v2.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(v2.updatedAt).toBe(days(1).toISOString());
    expect(await getContent(env, v2)).toBe('second');
    expect(await getContent(env, v2, 1)).toBe('<p>hi</p>');
    expect(await getContent(env, v2, 2)).toBe('second');
    expect(await status(getContent(env, v2, 3))).toBe(404);
  });

  it('updates title and content together', async () => {
    const meta = await createArtifact(env, 'u1', input, T0);
    const next = await updateArtifact(env, 'u1', meta.id, { title: 'New', content: 'c' }, days(1));
    expect(next.title).toBe('New');
    expect(next.version).toBe(2);
  });

  it('replaces old_str exactly once', async () => {
    const meta = await createArtifact(env, 'u1', { ...input, content: 'one two three' }, T0);
    const next = await updateArtifact(env, 'u1', meta.id, { oldStr: 'two', newStr: '2' }, days(1));
    expect(next.version).toBe(2);
    expect(await getContent(env, next)).toBe('one 2 three');
  });

  it('rejects old_str with 0 or 2 matches', async () => {
    const meta = await createArtifact(env, 'u1', { ...input, content: 'ab ab' }, T0);
    const none = updateArtifact(env, 'u1', meta.id, { oldStr: 'zz', newStr: 'y' }, days(1));
    await expect(none).rejects.toThrow(/found 0 matches/);
    expect(await status(updateArtifact(env, 'u1', meta.id, { oldStr: 'zz', newStr: 'y' }, days(1)))).toBe(400);
    const twice = updateArtifact(env, 'u1', meta.id, { oldStr: 'ab', newStr: 'y' }, days(1));
    await expect(twice).rejects.toThrow(/more than one match/);
    expect((await getArtifact(env, 'u1', meta.id, days(1))).version).toBe(1);
  });

  it('rejects overlapping old_str matches', async () => {
    const meta = await createArtifact(env, 'u1', { ...input, content: 'banana' }, T0);
    expect(await status(updateArtifact(env, 'u1', meta.id, { oldStr: 'ana', newStr: 'x' }, days(1)))).toBe(400);
    expect(await status(updateArtifact(env, 'u1', meta.id, { oldStr: 'nan', newStr: 'x' }, days(1)))).toBeUndefined();
  });

  it('allows an empty new_str to delete text', async () => {
    const meta = await createArtifact(env, 'u1', { ...input, content: 'keep drop' }, T0);
    const next = await updateArtifact(env, 'u1', meta.id, { oldStr: ' drop', newStr: '' }, days(1));
    expect(await getContent(env, next)).toBe('keep');
  });

  it('renames with title alone and keeps the version', async () => {
    const meta = await createArtifact(env, 'u1', input, T0);
    const next = await updateArtifact(env, 'u1', meta.id, { title: 'Renamed' }, days(1));
    expect(next.title).toBe('Renamed');
    expect(next.version).toBe(1);
    expect(next.versions).toEqual(meta.versions);
    expect((await listArtifacts(env, 'u1', days(1)))[0].title).toBe('Renamed');
  });

  it('rejects mutually exclusive input and empty updates with 400', async () => {
    const meta = await createArtifact(env, 'u1', input, T0);
    expect(await status(updateArtifact(env, 'u1', meta.id, { content: 'x', oldStr: 'a', newStr: 'b' }, T0))).toBe(400);
    expect(await status(updateArtifact(env, 'u1', meta.id, {}, T0))).toBe(400);
    expect(await status(updateArtifact(env, 'u1', meta.id, { title: ' ' }, T0))).toBe(400);
    expect(await status(updateArtifact(env, 'u1', meta.id, { content: '' }, T0))).toBe(400);
  });

  it('rejects oversized replacement content with 413', async () => {
    const meta = await createArtifact(env, 'u1', input, T0);
    expect(await status(updateArtifact(env, 'u1', meta.id, { content: 'a'.repeat(MAX_CONTENT_BYTES + 1) }, T0))).toBe(413);
  });

  it('lands two concurrent updates as distinct versions', async () => {
    const meta = await createArtifact(env, 'u1', input, T0);
    const [a, b] = await Promise.all([
      updateArtifact(env, 'u1', meta.id, { content: 'A' }, days(1)),
      updateArtifact(env, 'u1', meta.id, { content: 'B' }, days(1)),
    ]);
    expect([a.version, b.version].sort()).toEqual([2, 3]);
    const final = await getArtifact(env, 'u1', meta.id, days(1));
    expect(final.version).toBe(3);
    expect(final.versions.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(new Set(final.versions.map((v) => v.key)).size).toBe(3);
    expect([await getContent(env, final, 2), await getContent(env, final, 3)].sort()).toEqual(['A', 'B']);
  });
});

describe('listArtifacts', () => {
  it('lists the owner artifacts by updatedAt desc with index metadata', async () => {
    const a = await createArtifact(env, 'u1', { ...input, title: 'A' }, T0);
    const b = await createArtifact(env, 'u1', { ...input, title: 'B', type: 'svg' }, days(1));
    await createArtifact(env, 'u2', input, days(1));
    await updateArtifact(env, 'u1', a.id, { content: 'new' }, days(2));
    const items = await listArtifacts(env, 'u1', days(2));
    expect(items.map((i) => i.id)).toEqual([a.id, b.id]);
    expect(items[0]).toEqual({
      id: a.id,
      title: 'A',
      type: 'html',
      version: 2,
      updatedAt: days(2).toISOString(),
      expiresAt: days(32).toISOString(),
      shared: false,
    });
    expect(items[1].type).toBe('svg');
  });

  it('cuts long titles in the index only', async () => {
    const meta = await createArtifact(env, 'u1', { ...input, title: 'x'.repeat(200) }, T0);
    expect((await listArtifacts(env, 'u1', T0))[0].title).toHaveLength(100);
    expect((await getArtifact(env, 'u1', meta.id, T0)).title).toHaveLength(200);
  });

  it('shows the shared flag and follows KV list cursors', async () => {
    const first = await createArtifact(env, 'u1', input, T0);
    await shareArtifact(env, 'u1', first.id, T0);
    for (let i = 0; i < 1001; i++) await env.KV.put(`index:u1:fill${i}`, '', { metadata: { title: 't', type: 'html', version: 1, updatedAt: T0.toISOString(), expiresAt: null, shared: false } });
    const items = await listArtifacts(env, 'u1', T0);
    expect(items).toHaveLength(1002);
    expect(items.find((i) => i.id === first.id)?.shared).toBe(true);
  });
});

describe('retention', () => {
  it('treats an artifact as 404 once expired, everywhere', async () => {
    const meta = await createArtifact(env, 'u1', input, T0);
    const shared = await shareArtifact(env, 'u1', meta.id, T0);
    const before = days(30);
    before.setTime(before.getTime() - 1);
    expect(await getArtifact(env, 'u1', meta.id, before)).toBeTruthy();
    expect(await listArtifacts(env, 'u1', before)).toHaveLength(1);
    const after = days(30);
    expect(await status(getArtifact(env, 'u1', meta.id, after))).toBe(404);
    expect(await listArtifacts(env, 'u1', after)).toEqual([]);
    expect(await status(getSharedArtifact(env, shared.shareId!, after))).toBe(404);
    expect(await status(updateArtifact(env, 'u1', meta.id, { title: 'x' }, after))).toBe(404);
    expect(await status(setRetention(env, 'u1', meta.id, true, after))).toBe(404);
    expect(await status(shareArtifact(env, 'u1', meta.id, after))).toBe(404);
  });

  it('resets expiry on a new version but not on a rename', async () => {
    const meta = await createArtifact(env, 'u1', input, T0);
    const renamed = await updateArtifact(env, 'u1', meta.id, { title: 'x' }, days(10));
    expect(renamed.expiresAt).toBe(days(30).toISOString());
    const next = await updateArtifact(env, 'u1', meta.id, { content: 'y' }, days(10));
    expect(next.expiresAt).toBe(days(40).toISOString());
  });

  it('keeps permanent artifacts permanent across updates and sweeps', async () => {
    const meta = await createArtifact(env, 'u1', input, T0);
    const permanent = await setRetention(env, 'u1', meta.id, true, days(1));
    expect(permanent.expiresAt).toBeNull();
    const next = await updateArtifact(env, 'u1', meta.id, { content: 'y' }, days(2));
    expect(next.expiresAt).toBeNull();
    expect((await listArtifacts(env, 'u1', days(1000)))[0].expiresAt).toBeNull();
    expect(await sweepExpired(env, days(1000))).toBe(0);
    expect(await getArtifact(env, 'u1', meta.id, days(1000))).toBeTruthy();
  });

  it('setRetention(false) expires 30 days from now', async () => {
    const meta = await createArtifact(env, 'u1', input, T0);
    await setRetention(env, 'u1', meta.id, true, days(1));
    const back = await setRetention(env, 'u1', meta.id, false, days(5));
    expect(back.expiresAt).toBe(days(35).toISOString());
    expect((await listArtifacts(env, 'u1', days(5)))[0].expiresAt).toBe(days(35).toISOString());
  });
});

describe('sharing', () => {
  it('is idempotent, readable by share id, and updates with the artifact', async () => {
    const meta = await createArtifact(env, 'u1', input, T0);
    const shared = await shareArtifact(env, 'u1', meta.id, T0);
    expect(shared.shareId).toHaveLength(22);
    expect((await shareArtifact(env, 'u1', meta.id, T0)).shareId).toBe(shared.shareId);
    await updateArtifact(env, 'u1', meta.id, { content: 'new' }, days(1));
    const viaShare = await getSharedArtifact(env, shared.shareId!, days(1));
    expect(viaShare.id).toBe(meta.id);
    expect(await getContent(env, viaShare)).toBe('new');
  });

  it('unshare is idempotent and revokes the link immediately', async () => {
    const meta = await createArtifact(env, 'u1', input, T0);
    const shared = await shareArtifact(env, 'u1', meta.id, T0);
    expect((await unshareArtifact(env, 'u1', meta.id, T0)).shareId).toBeNull();
    expect((await unshareArtifact(env, 'u1', meta.id, T0)).shareId).toBeNull();
    expect(await status(getSharedArtifact(env, shared.shareId!, T0))).toBe(404);
    expect(await env.KV.get(`share:${shared.shareId}`)).toBeNull();
    expect((await listArtifacts(env, 'u1', T0))[0].shared).toBe(false);
  });

  it('gets a new share id when reshared', async () => {
    const meta = await createArtifact(env, 'u1', input, T0);
    const first = await shareArtifact(env, 'u1', meta.id, T0);
    await unshareArtifact(env, 'u1', meta.id, T0);
    const second = await shareArtifact(env, 'u1', meta.id, T0);
    expect(second.shareId).not.toBe(first.shareId);
    expect(await status(getSharedArtifact(env, first.shareId!, T0))).toBe(404);
    expect((await getSharedArtifact(env, second.shareId!, T0)).id).toBe(meta.id);
  });

  it('rejects a share entry whose artifact no longer points at it', async () => {
    const meta = await createArtifact(env, 'u1', input, T0);
    await env.KV.put('share:stale', JSON.stringify({ artifactId: meta.id, ownerId: 'u1' }));
    expect(await status(getSharedArtifact(env, 'stale', T0))).toBe(404);
    expect(await status(getSharedArtifact(env, 'unknown', T0))).toBe(404);
  });

  it('is 404 for another owner', async () => {
    const meta = await createArtifact(env, 'u1', input, T0);
    expect(await status(shareArtifact(env, 'u2', meta.id, T0))).toBe(404);
    expect(await status(unshareArtifact(env, 'u2', meta.id, T0))).toBe(404);
  });
});

describe('deleteArtifact', () => {
  it('removes every R2 and KV key including versions, index and share', async () => {
    const meta = await createArtifact(env, 'u1', input);
    await updateArtifact(env, 'u1', meta.id, { content: 'two' });
    await shareArtifact(env, 'u1', meta.id);
    const other = await createArtifact(env, 'u1', { ...input, title: 'other' });
    expect((await allKeys()).length).toBeGreaterThan(6);
    await deleteArtifact(env, 'u1', meta.id);
    const keys = await allKeys();
    expect(keys.filter((k) => k.includes(meta.id))).toEqual([]);
    expect(keys.filter((k) => k.includes('share:'))).toEqual([]);
    expect(keys.filter((k) => k.includes(other.id))).toHaveLength(3);
    expect(await status(getArtifact(env, 'u1', meta.id))).toBe(404);
  });
});

describe('sweepExpired', () => {
  it('deletes only expired artifacts, with all their keys', async () => {
    const old = await createArtifact(env, 'u1', input, T0);
    await shareArtifact(env, 'u1', old.id, T0);
    const fresh = await createArtifact(env, 'u2', input, days(20));
    const permanent = await createArtifact(env, 'u1', input, T0);
    await setRetention(env, 'u1', permanent.id, true, T0);
    expect(await sweepExpired(env, days(31))).toBe(1);
    const keys = await allKeys();
    expect(keys.filter((k) => k.includes(old.id))).toEqual([]);
    expect(keys.filter((k) => k.includes('share:'))).toEqual([]);
    expect(keys.filter((k) => k.includes(fresh.id))).toHaveLength(3);
    expect(keys.filter((k) => k.includes(permanent.id))).toHaveLength(3);
  });

  it('respects the limit', async () => {
    for (let i = 0; i < 3; i++) await createArtifact(env, 'u1', input, T0);
    expect(await sweepExpired(env, days(31), 2)).toBe(2);
    expect(await sweepExpired(env, days(31), 2)).toBe(1);
    expect(await allKeys()).toEqual([]);
  });

  it('keeps an artifact whose index is stale but whose meta was renewed', async () => {
    const meta = await createArtifact(env, 'u1', input, T0);
    const renewed: ArtifactMeta = { ...meta, expiresAt: days(60).toISOString() };
    await env.BUCKET.put(`artifacts/${meta.id}/meta.json`, JSON.stringify(renewed));
    expect(await sweepExpired(env, days(31))).toBe(0);
    expect(await getArtifact(env, 'u1', meta.id, days(31))).toBeTruthy();
  });

  it('cleans up an index entry whose meta is missing', async () => {
    const meta = await createArtifact(env, 'u1', input, T0);
    await env.BUCKET.delete(`artifacts/${meta.id}/meta.json`);
    expect(await sweepExpired(env, days(31))).toBe(1);
    expect((await env.KV.list()).keys).toEqual([]);
  });

  it('runs from the scheduled handler', async () => {
    await createArtifact(env, 'u1', input, new Date('2020-01-01T00:00:00.000Z'));
    const ctx = createExecutionContext();
    await main.scheduled(createScheduledController({ cron: '0 3 * * *' }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(await allKeys()).toEqual([]);
  });
});

describe('claim before purge', () => {
  it('makes a concurrent update 404 once the artifact is claimed for deletion', async () => {
    const meta = await createArtifact(env, 'u1', input);
    await expect(deleteArtifact(failingBucketDelete(), 'u1', meta.id)).rejects.toThrow('purge interrupted');
    expect(await status(updateArtifact(env, 'u1', meta.id, { content: 'late' }))).toBe(404);
    expect(await status(getArtifact(env, 'u1', meta.id))).toBe(404);
    expect(await sweepExpired(env, days(1000))).toBe(1);
    expect(await allKeys()).toEqual([]);
  });

  it('publishes an expired index entry when the purge fails so a later sweep retries it', async () => {
    const meta = await createArtifact(env, 'u1', input, T0);
    await setRetention(env, 'u1', meta.id, true, T0);
    await expect(deleteArtifact(failingBucketDelete(), 'u1', meta.id)).rejects.toThrow('purge interrupted');
    const entry = (await env.KV.list({ prefix: `index:u1:${meta.id}` })).keys[0];
    expect(entry.metadata).toMatchObject({ expiresAt: new Date(0).toISOString() });
    expect(await sweepExpired(env, days(1))).toBe(1);
    expect(await allKeys()).toEqual([]);
  });

  it('does the same when a sweep purge fails', async () => {
    const meta = await createArtifact(env, 'u1', input, T0);
    await expect(sweepExpired(failingBucketDelete(), days(31))).rejects.toThrow('purge interrupted');
    const entry = (await env.KV.list({ prefix: `index:u1:${meta.id}` })).keys[0];
    expect(entry.metadata).toMatchObject({ expiresAt: new Date(0).toISOString() });
    expect(await sweepExpired(env, days(31))).toBe(1);
    expect(await allKeys()).toEqual([]);
  });
});

describe('best-effort KV index writes', () => {
  it('retries a failed index put once and the index is correct', async () => {
    const meta = await createArtifact(env, 'u1', input, T0);
    const next = await updateArtifact(flakyKv({ put: 1 }), 'u1', meta.id, { content: 'two' }, days(1));
    expect(next.version).toBe(2);
    expect((await listArtifacts(env, 'u1', days(1)))[0].version).toBe(2);
  });

  it('republishes the latest meta when a delayed retry runs after a newer operation', async () => {
    const meta = await createArtifact(env, 'u1', input, T0);
    const first = setRetention(flakyKv({ put: 1 }), 'u1', meta.id, true, days(1));
    await vi.waitFor(async () => expect((await getArtifact(env, 'u1', meta.id, days(1))).expiresAt).toBeNull());
    await setRetention(env, 'u1', meta.id, false, days(2));
    await first;
    const [item] = await listArtifacts(env, 'u1', days(2));
    expect(item.expiresAt).toBe(days(32).toISOString());
  });

  it('skips the retry write when the meta is gone', async () => {
    const meta = await createArtifact(env, 'u1', input, T0);
    const pending = updateArtifact(flakyKv({ put: 1 }), 'u1', meta.id, { content: 'two' }, days(1));
    await vi.waitFor(async () => expect((await getArtifact(env, 'u1', meta.id, days(1))).version).toBe(2));
    await env.BUCKET.delete(`artifacts/${meta.id}/meta.json`);
    await env.KV.delete(`index:u1:${meta.id}`);
    await pending;
    expect((await env.KV.list()).keys).toEqual([]);
  });

  it('retries a failed index delete once and removes the entry', async () => {
    const meta = await createArtifact(env, 'u1', input);
    await deleteArtifact(flakyKv({ delete: 1 }), 'u1', meta.id);
    expect(await allKeys()).toEqual([]);
  });

  it('still returns the committed meta when KV always fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const always = flakyKv({ put: Infinity, delete: Infinity });
    const meta = await createArtifact(always, 'u1', input);
    expect(await getArtifact(env, 'u1', meta.id)).toEqual(meta);
    await deleteArtifact(always, 'u1', meta.id);
    expect(await status(getArtifact(env, 'u1', meta.id))).toBe(404);
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });
});

describe('toView and fileName', () => {
  const base: ArtifactMeta = {
    id: 'abc',
    ownerId: 'u1',
    title: 'My Cool Chart!',
    type: 'html',
    language: null,
    version: 1,
    versions: [],
    createdAt: '',
    updatedAt: '',
    expiresAt: null,
    shareId: null,
  };

  it('builds urls', () => {
    expect(toView(base, 'https://x.test')).toMatchObject({ url: 'https://x.test/a/abc', shareUrl: null });
    expect(toView({ ...base, shareId: 's1' }, 'https://x.test').shareUrl).toBe('https://x.test/s/s1');
  });

  it('slugs the title and picks the extension by type and language', () => {
    expect(fileName(base)).toBe('my-cool-chart.html');
    expect(fileName({ ...base, type: 'react' })).toBe('my-cool-chart.jsx');
    expect(fileName({ ...base, type: 'svg' })).toBe('my-cool-chart.svg');
    expect(fileName({ ...base, type: 'mermaid' })).toBe('my-cool-chart.mmd');
    expect(fileName({ ...base, type: 'markdown' })).toBe('my-cool-chart.md');
    expect(fileName({ ...base, type: 'code', language: 'Python' })).toBe('my-cool-chart.py');
    expect(fileName({ ...base, type: 'code', language: 'typescript' })).toBe('my-cool-chart.ts');
    expect(fileName({ ...base, type: 'code', language: 'js' })).toBe('my-cool-chart.js');
    expect(fileName({ ...base, type: 'code', language: 'brainfuck' })).toBe('my-cool-chart.txt');
    expect(fileName({ ...base, type: 'code' })).toBe('my-cool-chart.txt');
  });

  it('ignores inherited object properties as languages', () => {
    expect(fileName({ ...base, type: 'code', language: 'constructor' })).toBe('my-cool-chart.txt');
    expect(fileName({ ...base, type: 'code', language: '__proto__' })).toBe('my-cool-chart.txt');
    expect(fileName({ ...base, type: 'code', language: 'toString' })).toBe('my-cool-chart.txt');
  });

  it('falls back to "artifact" and caps the slug at 60 characters', () => {
    expect(fileName({ ...base, title: '***' })).toBe('artifact.html');
    const long = fileName({ ...base, title: 'a'.repeat(100) });
    expect(long).toBe(`${'a'.repeat(60)}.html`);
    expect(fileName({ ...base, title: `${'a'.repeat(59)} b` })).toBe(`${'a'.repeat(59)}.html`);
  });
});
