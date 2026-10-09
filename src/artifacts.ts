import {
  ARTIFACT_TYPES,
  type ArtifactMeta,
  type ArtifactSummary,
  type ArtifactType,
  type ArtifactView,
} from './types';

export const RETENTION_DAYS = 30;
export const MAX_CONTENT_BYTES = 1024 * 1024;
export const MAX_TITLE_LENGTH = 200;

const DAY_MS = 24 * 3600 * 1000;
const MAX_ATTEMPTS = 3;
const MAX_LANGUAGE_LENGTH = 32;
const LANGUAGE_PATTERN = /^[A-Za-z0-9+#._-]+$/;

export class ArtifactError extends Error {
  constructor(
    public status: 400 | 404 | 409 | 413,
    message: string,
  ) {
    super(message);
    this.name = 'ArtifactError';
  }
}

const notFound = () => new ArtifactError(404, 'Artifact not found');

export function randomId(bytes = 16): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const metaKey = (id: string) => `artifacts/${id}/meta.json`;
const indexKey = (ownerId: string, id: string) => `index:${ownerId}:${id}`;
const shareKey = (shareId: string) => `share:${shareId}`;
const INDEX_TITLE_LENGTH = 100;
const KV_RETRY_DELAY_MS = 1100;
const EPOCH = new Date(0).toISOString();

interface IndexMetadata {
  title: string;
  type: ArtifactType;
  version: number;
  updatedAt: string;
  expiresAt: string | null;
  shared: boolean;
}
const retentionEnd = (now: Date) => new Date(now.getTime() + RETENTION_DAYS * DAY_MS).toISOString();
const isExpired = (expiresAt: string | null, now: Date) => expiresAt !== null && new Date(expiresAt) <= now;
const byteLength = (s: string) => new TextEncoder().encode(s).length;

function validateTitle(title: unknown): string {
  if (typeof title !== 'string') throw new ArtifactError(400, 'title must be a string');
  const trimmed = title.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_TITLE_LENGTH) {
    throw new ArtifactError(400, `title must be 1..${MAX_TITLE_LENGTH} characters`);
  }
  return trimmed;
}

function validateType(type: unknown): ArtifactType {
  if (!ARTIFACT_TYPES.includes(type as ArtifactType)) {
    throw new ArtifactError(400, `type must be one of: ${ARTIFACT_TYPES.join(', ')}`);
  }
  return type as ArtifactType;
}

function validateContent(content: unknown): string {
  if (typeof content !== 'string' || content.length === 0) {
    throw new ArtifactError(400, 'content must be a non-empty string');
  }
  if (byteLength(content) > MAX_CONTENT_BYTES) {
    throw new ArtifactError(413, `content exceeds ${MAX_CONTENT_BYTES} bytes`);
  }
  return content;
}

function validateLanguage(language: unknown): string | null {
  if (language === undefined || language === null) return null;
  if (
    typeof language !== 'string' ||
    language.length < 1 ||
    language.length > MAX_LANGUAGE_LENGTH ||
    !LANGUAGE_PATTERN.test(language)
  ) {
    throw new ArtifactError(400, `language must be 1..${MAX_LANGUAGE_LENGTH} characters of [A-Za-z0-9+#._-]`);
  }
  return language;
}

async function readMeta(env: Env, id: string): Promise<{ meta: ArtifactMeta; etag: string } | null> {
  const object = await env.BUCKET.get(metaKey(id));
  if (!object) return null;
  return { meta: await object.json<ArtifactMeta>(), etag: object.etag };
}

// KV allows one write per second per key and may throw after the R2 commit; the index must never fail a committed mutation.
async function bestEffort(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, KV_RETRY_DELAY_MS));
    try {
      await operation();
    } catch (err) {
      console.error(err);
    }
  }
}

function putIndex(env: Env, meta: ArtifactMeta) {
  const metadata: IndexMetadata = {
    title: meta.title.slice(0, INDEX_TITLE_LENGTH),
    type: meta.type,
    version: meta.version,
    updatedAt: meta.updatedAt,
    expiresAt: meta.expiresAt,
    shared: meta.shareId !== null,
  };
  return bestEffort(() => env.KV.put(indexKey(meta.ownerId, meta.id), '', { metadata }));
}

async function listIndex(env: Env, prefix: string, onPage: (keys: KVNamespaceListKey<IndexMetadata>[]) => Promise<boolean | void>) {
  let cursor: string | undefined;
  do {
    const page = await env.KV.list<IndexMetadata>({ prefix, cursor });
    if ((await onPage(page.keys)) === false) return;
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}

async function claim(env: Env, current: { meta: ArtifactMeta; etag: string }): Promise<boolean> {
  const claimed = await env.BUCKET.put(metaKey(current.meta.id), JSON.stringify({ ...current.meta, expiresAt: EPOCH }), {
    onlyIf: { etagMatches: current.etag },
    httpMetadata: { contentType: 'application/json' },
  });
  return claimed !== null;
}

async function purge(env: Env, ownerId: string, id: string, shareId: string | null) {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.BUCKET.list({ prefix: `artifacts/${id}/`, cursor });
    keys.push(...page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  for (let i = 0; i < keys.length; i += 1000) await env.BUCKET.delete(keys.slice(i, i + 1000));
  await bestEffort(() => env.KV.delete(indexKey(ownerId, id)));
  if (shareId) await bestEffort(() => env.KV.delete(shareKey(shareId)));
}

interface Change {
  next: ArtifactMeta;
  rollback?: () => Promise<unknown>;
}

async function modify(
  env: Env,
  ownerId: string,
  id: string,
  now: Date,
  change: (meta: ArtifactMeta) => Promise<Change>,
): Promise<ArtifactMeta> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const current = await readMeta(env, id);
    if (!current || current.meta.ownerId !== ownerId || isExpired(current.meta.expiresAt, now)) throw notFound();
    const { next, rollback } = await change(current.meta);
    if (next === current.meta) return next;
    const written = await env.BUCKET.put(metaKey(id), JSON.stringify(next), {
      onlyIf: { etagMatches: current.etag },
      httpMetadata: { contentType: 'application/json' },
    });
    if (written) {
      await putIndex(env, next);
      return next;
    }
    await rollback?.();
  }
  throw new ArtifactError(409, 'Artifact was modified concurrently, retry');
}

function newVersionKey(id: string, version: number) {
  return `artifacts/${id}/v/${version}-${randomId(8)}`;
}

export async function createArtifact(
  env: Env,
  ownerId: string,
  input: { title: string; type: ArtifactType; content: string; language?: string | null },
  now: Date = new Date(),
): Promise<ArtifactMeta> {
  const title = validateTitle(input.title);
  const type = validateType(input.type);
  const content = validateContent(input.content);
  const language = validateLanguage(input.language);
  const id = randomId();
  const createdAt = now.toISOString();
  const key = newVersionKey(id, 1);
  await env.BUCKET.put(key, content);
  const meta: ArtifactMeta = {
    id,
    ownerId,
    title,
    type,
    language,
    version: 1,
    versions: [{ version: 1, key, size: byteLength(content), createdAt }],
    createdAt,
    updatedAt: createdAt,
    expiresAt: retentionEnd(now),
    shareId: null,
  };
  await env.BUCKET.put(metaKey(id), JSON.stringify(meta), { httpMetadata: { contentType: 'application/json' } });
  await putIndex(env, meta);
  return meta;
}

export async function getArtifact(
  env: Env,
  ownerId: string,
  id: string,
  now: Date = new Date(),
): Promise<ArtifactMeta> {
  const current = await readMeta(env, id);
  if (!current || current.meta.ownerId !== ownerId || isExpired(current.meta.expiresAt, now)) throw notFound();
  return current.meta;
}

export async function getContent(env: Env, meta: ArtifactMeta, version?: number): Promise<string> {
  const info = meta.versions.find((v) => v.version === (version ?? meta.version));
  const object = info && (await env.BUCKET.get(info.key));
  if (!object) throw new ArtifactError(404, 'Version not found');
  return object.text();
}

export async function listArtifacts(env: Env, ownerId: string, now: Date = new Date()): Promise<ArtifactSummary[]> {
  const items: ArtifactSummary[] = [];
  const prefix = `index:${ownerId}:`;
  await listIndex(env, prefix, async (keys) => {
    for (const key of keys) {
      const m = key.metadata;
      if (!m || isExpired(m.expiresAt, now)) continue;
      items.push({
        id: key.name.slice(prefix.length),
        title: m.title,
        type: m.type,
        version: m.version,
        updatedAt: m.updatedAt,
        expiresAt: m.expiresAt,
        shared: m.shared,
      });
    }
  });
  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function updateArtifact(
  env: Env,
  ownerId: string,
  id: string,
  input: { title?: string; content?: string; oldStr?: string; newStr?: string },
  now: Date = new Date(),
): Promise<ArtifactMeta> {
  const { content, oldStr, newStr } = input;
  const replacing = oldStr !== undefined || newStr !== undefined;
  if (content !== undefined && replacing) throw new ArtifactError(400, 'content and old_str/new_str are mutually exclusive');
  if (replacing && oldStr === undefined) throw new ArtifactError(400, 'new_str requires old_str');
  if (input.title === undefined && content === undefined && !replacing) throw new ArtifactError(400, 'nothing to update');
  const title = input.title === undefined ? undefined : validateTitle(input.title);
  if (content !== undefined) validateContent(content);
  if (oldStr !== undefined && (typeof oldStr !== 'string' || oldStr.length === 0)) {
    throw new ArtifactError(400, 'old_str must be a non-empty string');
  }
  if (newStr !== undefined && typeof newStr !== 'string') throw new ArtifactError(400, 'new_str must be a string');

  return modify(env, ownerId, id, now, async (meta) => {
    let nextContent = content;
    if (oldStr !== undefined) {
      const latest = await getContent(env, meta);
      const first = latest.indexOf(oldStr);
      if (first === -1) throw new ArtifactError(400, 'old_str must match exactly once, found 0 matches');
      if (latest.indexOf(oldStr, first + 1) !== -1) {
        throw new ArtifactError(400, 'old_str must match exactly once, found more than one match');
      }
      nextContent = validateContent(latest.slice(0, first) + (newStr ?? '') + latest.slice(first + oldStr.length));
    }
    const at = now.toISOString();
    if (nextContent === undefined) return { next: { ...meta, title: title ?? meta.title, updatedAt: at } };
    const version = meta.version + 1;
    const key = newVersionKey(id, version);
    await env.BUCKET.put(key, nextContent);
    const next: ArtifactMeta = {
      ...meta,
      title: title ?? meta.title,
      version,
      versions: [...meta.versions, { version, key, size: byteLength(nextContent), createdAt: at }],
      updatedAt: at,
      expiresAt: meta.expiresAt === null ? null : retentionEnd(now),
    };
    return { next, rollback: () => env.BUCKET.delete(key) };
  });
}

export function setRetention(
  env: Env,
  ownerId: string,
  id: string,
  permanent: boolean,
  now: Date = new Date(),
): Promise<ArtifactMeta> {
  return modify(env, ownerId, id, now, async (meta) => ({
    next: { ...meta, expiresAt: permanent ? null : retentionEnd(now) },
  }));
}

export async function deleteArtifact(env: Env, ownerId: string, id: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const current = await readMeta(env, id);
    if (!current || current.meta.ownerId !== ownerId || isExpired(current.meta.expiresAt, new Date())) throw notFound();
    if (await claim(env, current)) return purge(env, ownerId, id, current.meta.shareId);
  }
  throw new ArtifactError(409, 'Artifact was modified concurrently, retry');
}

export function shareArtifact(env: Env, ownerId: string, id: string, now: Date = new Date()): Promise<ArtifactMeta> {
  return modify(env, ownerId, id, now, async (meta) => {
    if (meta.shareId) return { next: meta };
    const shareId = randomId();
    await env.KV.put(shareKey(shareId), JSON.stringify({ artifactId: id, ownerId }));
    return { next: { ...meta, shareId }, rollback: () => env.KV.delete(shareKey(shareId)) };
  });
}

export async function unshareArtifact(env: Env, ownerId: string, id: string, now: Date = new Date()): Promise<ArtifactMeta> {
  let revoked: string | null = null;
  const next = await modify(env, ownerId, id, now, async (meta) => {
    revoked = meta.shareId;
    return { next: meta.shareId ? { ...meta, shareId: null } : meta };
  });
  const revokedShareId = revoked as string | null;
  if (revokedShareId) await bestEffort(() => env.KV.delete(shareKey(revokedShareId)));
  return next;
}

export async function getSharedArtifact(env: Env, shareId: string, now: Date = new Date()): Promise<ArtifactMeta> {
  const entry = await env.KV.get<{ artifactId: string }>(shareKey(shareId), 'json');
  if (!entry) throw notFound();
  const current = await readMeta(env, entry.artifactId);
  if (!current || current.meta.shareId !== shareId || isExpired(current.meta.expiresAt, now)) throw notFound();
  return current.meta;
}

export async function sweepExpired(env: Env, now: Date = new Date(), limit = 100): Promise<number> {
  let deleted = 0;
  await listIndex(env, 'index:', async (keys) => {
    for (const key of keys) {
      if (deleted >= limit) return false;
      if (!key.metadata || !isExpired(key.metadata.expiresAt, now)) continue;
      const [, ownerId, id] = key.name.split(':');
      const current = await readMeta(env, id);
      if (current && (!isExpired(current.meta.expiresAt, now) || !(await claim(env, current)))) continue;
      await purge(env, ownerId, id, current?.meta.shareId ?? null);
      deleted++;
    }
  });
  return deleted;
}

export function toView(meta: ArtifactMeta, origin: string): ArtifactView {
  return {
    ...meta,
    url: `${origin}/a/${meta.id}`,
    shareUrl: meta.shareId ? `${origin}/s/${meta.shareId}` : null,
  };
}

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  js: 'js',
  javascript: 'js',
  jsx: 'jsx',
  ts: 'ts',
  typescript: 'ts',
  tsx: 'tsx',
  py: 'py',
  python: 'py',
  rb: 'rb',
  ruby: 'rb',
  go: 'go',
  rs: 'rs',
  rust: 'rs',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  'c++': 'cpp',
  cs: 'cs',
  csharp: 'cs',
  'c#': 'cs',
  sh: 'sh',
  bash: 'sh',
  shell: 'sh',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  html: 'html',
  css: 'css',
  sql: 'sql',
  php: 'php',
  kt: 'kt',
  kotlin: 'kt',
  swift: 'swift',
};

const TYPE_EXTENSIONS: Record<Exclude<ArtifactType, 'code'>, string> = {
  html: 'html',
  react: 'jsx',
  svg: 'svg',
  mermaid: 'mmd',
  markdown: 'md',
};

export function fileName(meta: ArtifactMeta): string {
  const slug = meta.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  const extension =
    meta.type === 'code' ? (meta.language && Object.hasOwn(LANGUAGE_EXTENSIONS, meta.language.toLowerCase()) && LANGUAGE_EXTENSIONS[meta.language.toLowerCase()]) || 'txt' : TYPE_EXTENSIONS[meta.type];
  return `${slug || 'artifact'}.${extension}`;
}
