import { ARCHIFY_VERSION, ArchifyError, archifyCacheKey, archifyContentIsJson, formatArchifyDiagnostics, renderArchify } from './archify';
import {
  ARTIFACT_TYPES,
  type ArtifactMeta,
  type ArtifactSummary,
  type ArtifactType,
  type ArtifactView,
  type Session,
} from './types';

export const RETENTION_DAYS = 30;
export const MAX_CONTENT_BYTES = 1024 * 1024;
export const MAX_TITLE_LENGTH = 200;
export const MAX_SHARE_AUDIENCE = 50;

const DAY_MS = 24 * 3600 * 1000;
const MAX_ATTEMPTS = 3;
const MAX_LANGUAGE_LENGTH = 32;
const LANGUAGE_PATTERN = /^[A-Za-z0-9+#._-]+$/;
const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const EMAIL_LOCAL_PATTERN = /^[^\s@,;<>()"]{1,64}$/;

export class ArtifactError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409 | 413,
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

async function validateArchify(type: ArtifactType, content: string): Promise<string | undefined> {
  if (type !== 'archify') return undefined;
  try {
    return (await renderArchify(content)).html;
  } catch (error) {
    if (error instanceof ArchifyError) {
      throw new ArtifactError(400, `Archify candidate is invalid:\n${formatArchifyDiagnostics(error.diagnostics)}`);
    }
    throw error;
  }
}

async function cacheArchifyHtml(env: Env, versionKey: string, html: string | undefined): Promise<void> {
  if (html === undefined) return;
  try {
    await env.BUCKET.put(archifyCacheKey(versionKey), html, { customMetadata: { ARCHIFY_VERSION } });
  } catch {}
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
  const stored = await object.json<Omit<ArtifactMeta, 'shareAudience'> & { shareAudience?: string[] | null }>();
  return { meta: { ...stored, shareAudience: stored.shareAudience ?? null }, etag: object.etag };
}

function validateShareAudience(audience: unknown): string[] | null {
  if (audience === null) return null;
  if (!Array.isArray(audience) || audience.some((entry) => typeof entry !== 'string')) {
    throw new ArtifactError(400, 'audience must be null or a list of emails and @domains');
  }
  if (audience.length === 0) {
    throw new ArtifactError(400, 'audience must list at least one email or @domain; use null to let anyone with the link view');
  }
  const trimmed = audience.map((entry) => entry.trim());
  const nonAscii = trimmed.find((entry) => !/^[\x21-\x7e]+$/.test(entry));
  if (nonAscii !== undefined) {
    throw new ArtifactError(400, `audience entries must be emails (alice@example.com) or domains (@example.com): ${nonAscii.slice(0, 100)}`);
  }
  const entries = [...new Set(trimmed.map((entry) => entry.toLowerCase()))];
  if (entries.length > MAX_SHARE_AUDIENCE) throw new ArtifactError(400, 'audience can list at most 50 entries');
  for (const entry of entries) {
    const parts = entry.split('@');
    const domainEntry = entry.startsWith('@');
    const domain = domainEntry ? entry.slice(1) : parts[1];
    const validDomain = domain !== undefined && domain.length <= 253 && DOMAIN_PATTERN.test(domain);
    const validLocal = parts[0].length <= 64 && EMAIL_LOCAL_PATTERN.test(parts[0]) && !parts[0].includes('*');
    if (entry.length > 254 || (domainEntry ? !validDomain : parts.length !== 2 || !validLocal || !validDomain)) {
      throw new ArtifactError(400, `audience entries must be emails (alice@example.com) or domains (@example.com): ${entry.slice(0, 100)}`);
    }
  }
  return entries;
}

// KV allows one write per second per key and may throw after the R2 commit; the index must never fail a committed mutation.
async function bestEffort(operation: () => Promise<unknown>, retry: () => Promise<unknown> = operation) {
  try {
    await operation();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, KV_RETRY_DELAY_MS));
    try {
      await retry();
    } catch (err) {
      console.error(err);
    }
  }
}

function writeIndex(env: Env, meta: ArtifactMeta) {
  const metadata: IndexMetadata = {
    title: meta.title.length > INDEX_TITLE_LENGTH ? `${meta.title.slice(0, INDEX_TITLE_LENGTH - 1)}…` : meta.title,
    type: meta.type,
    version: meta.version,
    updatedAt: meta.updatedAt,
    expiresAt: meta.expiresAt,
    shared: meta.shareId !== null,
  };
  return env.KV.put(indexKey(meta.ownerId, meta.id), '', { metadata });
}

// The retry republishes the latest meta, not the snapshot, so a delayed retry cannot overwrite a newer index entry.
function putIndex(env: Env, meta: ArtifactMeta) {
  return bestEffort(
    () => writeIndex(env, meta),
    async () => {
      const latest = await readMeta(env, meta.id);
      if (latest) await writeIndex(env, latest.meta);
    },
  );
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

async function purgeClaimed(env: Env, meta: ArtifactMeta) {
  try {
    await purge(env, meta.ownerId, meta.id, meta.shareId);
  } catch (err) {
    await putIndex(env, { ...meta, expiresAt: EPOCH });
    throw err;
  }
}

async function purge(env: Env, ownerId: string, id: string, shareId: string | null) {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.BUCKET.list({ prefix: `artifacts/${id}/`, cursor });
    keys.push(...page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  // meta.json goes last so a failed purge leaves a claimed meta that recovery can republish.
  const versions = keys.filter((key) => key !== metaKey(id));
  for (let i = 0; i < versions.length; i += 1000) await env.BUCKET.delete(versions.slice(i, i + 1000));
  await env.BUCKET.delete(metaKey(id));
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
  const archifyHtml = await validateArchify(type, content);
  const id = randomId();
  const createdAt = now.toISOString();
  const key = newVersionKey(id, 1);
  await env.BUCKET.put(key, content);
  await cacheArchifyHtml(env, key, archifyHtml);
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
    shareAudience: null,
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

  let validatedContent: string | undefined;
  let validatedHtml: string | undefined;
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
    if (nextContent !== validatedContent) {
      validatedHtml = await validateArchify(meta.type, nextContent);
      validatedContent = nextContent;
    }
    const version = meta.version + 1;
    const key = newVersionKey(id, version);
    await env.BUCKET.put(key, nextContent);
    await cacheArchifyHtml(env, key, validatedHtml);
    const next: ArtifactMeta = {
      ...meta,
      title: title ?? meta.title,
      version,
      versions: [...meta.versions, { version, key, size: byteLength(nextContent), createdAt: at }],
      updatedAt: at,
      expiresAt: meta.expiresAt === null ? null : retentionEnd(now),
    };
    return { next, rollback: () => env.BUCKET.delete([key, archifyCacheKey(key)]) };
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
    if (await claim(env, current)) return purgeClaimed(env, current.meta);
  }
  throw new ArtifactError(409, 'Artifact was modified concurrently, retry');
}

export function canViewShare(meta: ArtifactMeta, viewer: Session | null): boolean {
  if (meta.shareAudience === null) return true;
  if (viewer === null) return false;
  if (viewer.id === meta.ownerId) return true;
  const email = viewer.email.toLowerCase();
  return meta.shareAudience.some((entry) =>
    entry.startsWith('@') ? email.endsWith(entry) && viewer.hostedDomain === entry.slice(1) : email === entry,
  );
}

export async function shareArtifact(
  env: Env,
  ownerId: string,
  id: string,
  options: { audience?: unknown } = {},
  now: Date = new Date(),
): Promise<ArtifactMeta> {
  const audience = options.audience === undefined ? undefined : validateShareAudience(options.audience);
  return modify(env, ownerId, id, now, async (meta) => {
    const sameAudience = audience === undefined || meta.shareAudience === audience ||
      (meta.shareAudience !== null && audience !== null && meta.shareAudience.length === audience.length &&
        meta.shareAudience.every((entry, index) => entry === audience[index]));
    if (meta.shareId && sameAudience) return { next: meta };
    const shareId = meta.shareId ?? randomId();
    if (!meta.shareId) await env.KV.put(shareKey(shareId), JSON.stringify({ artifactId: id, ownerId }));
    const shareAudience = meta.shareId && audience === undefined ? meta.shareAudience : audience ?? null;
    return {
      next: { ...meta, shareId, shareAudience },
      rollback: meta.shareId ? undefined : () => env.KV.delete(shareKey(shareId)),
    };
  });
}

export async function unshareArtifact(env: Env, ownerId: string, id: string, now: Date = new Date()): Promise<ArtifactMeta> {
  let revoked: string | null = null;
  const next = await modify(env, ownerId, id, now, async (meta) => {
    revoked = meta.shareId;
    return { next: meta.shareId || meta.shareAudience !== null ? { ...meta, shareId: null, shareAudience: null } : meta };
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
      if (current) {
        if (!isExpired(current.meta.expiresAt, now) || !(await claim(env, current))) continue;
        await purgeClaimed(env, current.meta);
      } else {
        await purge(env, ownerId, id, null);
      }
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
  slides: 'md',
  design: 'html',
  motion: 'html',
  archify: 'json',
};

// Title slugged for file names; shared by fileName and the export routes.
export function fileSlug(meta: ArtifactMeta): string {
  const slug = meta.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || 'artifact';
}

export function fileName(meta: ArtifactMeta, content: string): string {
  let extension: string;
  if (meta.type === 'archify' && !archifyContentIsJson(content)) {
    extension = 'archify.md';
  } else if (meta.type === 'code') {
    extension = (meta.language && Object.hasOwn(LANGUAGE_EXTENSIONS, meta.language.toLowerCase()) && LANGUAGE_EXTENSIONS[meta.language.toLowerCase()]) || 'txt';
  } else {
    extension = TYPE_EXTENSIONS[meta.type];
  }
  return `${fileSlug(meta)}.${extension}`;
}
