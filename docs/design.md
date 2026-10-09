# Design: Artifacts on Cloudflare Workers + R2

A self-hosted clone of Claude Artifacts. Agents create and update artifacts over MCP; people view, share and manage them in the browser.

## Scope

In scope:

- Artifact types: `html`, `react`, `svg`, `mermaid`, `markdown`, `code`.
- Preview/Code view, version history, copy, download, open in a new tab, edit (new version), remix a shared artifact into your own account.
- GitHub OAuth sign-in (allowlist), personal API tokens.
- Share links (public, revocable).
- Retention: 30 days by default, make permanent, set back to expiring, delete. A daily cron deletes expired artifacts.
- MCP server (Streamable HTTP, stateless) with Bearer API tokens.

Out of scope: AI-powered artifacts (`window.claude`), artifact persistent storage (`window.storage`), shadcn/ui imports, MCP OAuth, collaborative editing.

## Stack

- TypeScript, Cloudflare Workers, Hono (routing + `hono/jsx` SSR), one R2 bucket binding `BUCKET`. No D1/KV.
- Static assets: Workers static assets from `public/` (`assets.directory`).
- Tests: vitest 5 + `@cloudflare/vitest-plugin` (real R2 via Miniflare; `afterEach(reset)` from `cloudflare:test` isolates storage).
- Package manager: bun. Scripts: `bun run test`, `bun run typecheck`, `bun run build` (= `wrangler deploy --dry-run --outdir dist`).

## Environment

| Name | Kind | Meaning |
| --- | --- | --- |
| `BUCKET` | R2 binding | All storage |
| `GITHUB_CLIENT_ID` | var | GitHub OAuth app client id |
| `GITHUB_CLIENT_SECRET` | secret | GitHub OAuth app secret |
| `SESSION_SECRET` | secret | HMAC key for session cookies (>= 32 random bytes) |
| `ALLOWED_USERS` | var | Comma-separated GitHub logins (case-insensitive) allowed to sign in, or `*` for anyone. Empty = nobody. |

## Source layout and ownership

| Path | Owner | Contents |
| --- | --- | --- |
| `src/index.ts` | foundation | App assembly, `onError`, `scheduled` |
| `src/types.ts` | foundation | Shared types |
| `src/artifacts.ts` | foundation | Domain + R2 storage |
| `src/auth.ts` | foundation | Sessions, API tokens, users, middleware |
| `src/routes/auth.ts` | lane auth | GitHub OAuth routes, `/api/tokens` |
| `src/routes/api.ts` | lane api | REST artifacts API |
| `src/routes/mcp.ts` | lane mcp | MCP endpoint |
| `src/render.ts`, `src/routes/render.ts` | lane render | Sandboxed render documents and routes |
| `src/routes/ui.tsx`, `src/ui/**`, `public/**` | lane ui | SSR pages and client JS/CSS |
| `test/helpers.ts` | foundation | Test helpers |
| `test/<area>.test.ts` | each lane | Tests for its own area |

Each route module exports `default` a `new Hono<AppEnv>()` that declares full paths. `src/index.ts` mounts every module at `/`. Lanes never edit files they do not own, `package.json` or `bun.lock`.

## Shared types (`src/types.ts`)

```ts
export type ArtifactType = 'html' | 'react' | 'svg' | 'mermaid' | 'markdown' | 'code';
export const ARTIFACT_TYPES: readonly ArtifactType[];

export interface SessionUser { id: string; login: string }            // id = `gh_<github numeric id>`
export interface User extends SessionUser { name: string | null; avatarUrl: string | null; createdAt: string }

export interface VersionInfo { version: number; key: string; size: number; createdAt: string }
export interface ArtifactMeta {
  id: string; ownerId: string; title: string; type: ArtifactType; language: string | null;
  version: number;                 // latest version number, starts at 1
  versions: VersionInfo[];         // ascending
  createdAt: string; updatedAt: string;   // ISO 8601
  expiresAt: string | null;        // null = permanent
  shareId: string | null;
}
export interface ArtifactSummary {
  id: string; title: string; type: ArtifactType; version: number;
  updatedAt: string; expiresAt: string | null; shared: boolean;
}
export interface ArtifactView extends ArtifactMeta { url: string; shareUrl: string | null }

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser; authMethod: 'session' | 'token' } };
```

## R2 key layout

| Key | Body | Notes |
| --- | --- | --- |
| `artifacts/{id}/meta.json` | `ArtifactMeta` JSON | Source of truth |
| `artifacts/{id}/v/{version}-{rand}` | content | Unique key per write; `VersionInfo.key` points to it |
| `index/{ownerId}/{id}` | empty | `customMetadata`: `title`, `type`, `version`, `updatedAt`, `expiresAt` (`''` = permanent), `shared` (`'1'`/`'0'`) |
| `shares/{shareId}` | `{ artifactId, ownerId }` JSON | |
| `users/{userId}.json` | `User` JSON | |
| `tokens/{sha256hex(token)}` | `{ id, userId, login, name, createdAt }` JSON | |
| `user-tokens/{userId}/{tokenId}` | empty | `customMetadata`: `name`, `createdAt`, `hash` |

Ids, share ids and token ids: 16 random bytes, base64url (22 chars). API tokens: `art_` + 32 random bytes base64url. Only the SHA-256 hex of a token is stored.

## Domain API (`src/artifacts.ts`)

```ts
export const RETENTION_DAYS = 30;
export const MAX_CONTENT_BYTES = 1024 * 1024;  // UTF-8 bytes
export const MAX_TITLE_LENGTH = 200;
export class ArtifactError extends Error { status: 400 | 404 | 409 | 413 }

createArtifact(bucket, ownerId, input: { title: string; type: ArtifactType; content: string; language?: string | null }, now?: Date): Promise<ArtifactMeta>
getArtifact(bucket, ownerId, id, now?): Promise<ArtifactMeta>            // 404: missing, other owner, or expired
getContent(bucket, meta, version?: number): Promise<string>                // default latest; 404 unknown version
listArtifacts(bucket, ownerId, now?): Promise<ArtifactSummary[]>           // non-expired, updatedAt desc
updateArtifact(bucket, ownerId, id, input: { title?: string; content?: string; oldStr?: string; newStr?: string }, now?): Promise<ArtifactMeta>
setRetention(bucket, ownerId, id, permanent: boolean, now?): Promise<ArtifactMeta>
deleteArtifact(bucket, ownerId, id): Promise<void>                          // 404 if not visible
shareArtifact(bucket, ownerId, id, now?): Promise<ArtifactMeta>             // idempotent: keeps existing shareId
unshareArtifact(bucket, ownerId, id, now?): Promise<ArtifactMeta>           // idempotent
getSharedArtifact(bucket, shareId, now?): Promise<ArtifactMeta>             // 404: unknown, revoked, or expired
sweepExpired(bucket, now?, limit = 100): Promise<number>                    // deletes up to `limit` expired artifacts
toView(meta, origin): ArtifactView                                           // url = {origin}/a/{id}, shareUrl = {origin}/s/{shareId}
fileName(meta): string                                                       // slug(title) + extension by type/language
```

Rules:

- Validation (400): title trimmed, 1..200 chars; `type` in `ARTIFACT_TYPES`; content non-empty string; `language` optional, max 32 chars of `[A-Za-z0-9+#._-]`. Content over `MAX_CONTENT_BYTES` → 413.
- Update: `content` and `oldStr`/`newStr` are mutually exclusive (400). `oldStr` must occur exactly once in the latest content (400 otherwise; message says 0 or N matches). Either form writes a new version. `title` alone renames without a new version. An update with nothing to change is 400.
- Retention: create sets `expiresAt = now + 30d`. A new version resets `expiresAt = now + 30d` unless permanent. `setRetention(true)` sets `null`; `setRetention(false)` sets `now + 30d`. An artifact is expired when `expiresAt !== null && expiresAt <= now`; expired artifacts are 404 everywhere before the sweep deletes them.
- Concurrency: write the version object first (unique key), then put `meta.json` with `onlyIf: { etagMatches }` from the read. On precondition failure, retry the whole read-modify-write up to 3 times, then 409. Update the index entry after meta (index may briefly lag; meta wins).
- Delete removes every key under `artifacts/{id}/`, the index entry and the share entry.
- Sweep lists `index/` with custom metadata, re-reads `meta.json` for each candidate, and deletes it only when meta is missing or expired.

## Auth (`src/auth.ts`)

```ts
export const SESSION_COOKIE = 'session';
export const SESSION_TTL_SECONDS = 7 * 24 * 3600;

isAllowed(env, login): boolean
upsertUser(bucket, user: { githubId: number; login: string; name: string | null; avatarUrl: string | null }, now?): Promise<User>
getUser(bucket, userId): Promise<User | null>
createSessionCookie(env, user: SessionUser, now?): Promise<string>   // full Set-Cookie header value
clearSessionCookie(): string                                           // Set-Cookie value that expires it
readSession(env, cookieHeader: string | undefined, now?): Promise<SessionUser | null>
createApiToken(bucket, user: SessionUser, name: string, now?): Promise<{ token: string; id: string; name: string; createdAt: string }>
listApiTokens(bucket, userId): Promise<{ id: string; name: string; createdAt: string }[]>
revokeApiToken(bucket, userId, tokenId): Promise<void>                 // 404 if not owned
verifyApiToken(bucket, token): Promise<SessionUser | null>
authenticate(c): Promise<{ user: SessionUser; method: 'session' | 'token' } | null>
requireUser: MiddlewareHandler<AppEnv>                                 // sets c.var.user / c.var.authMethod, else 401 JSON
requireSession: MiddlewareHandler<AppEnv>                              // like requireUser but rejects Bearer tokens (403)
```

- Session cookie value: `base64url(JSON {uid, login, exp})` + `.` + `base64url(HMAC-SHA256(SESSION_SECRET, payload))`; `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`. Verify with constant-time comparison (`crypto.subtle.verify`).
- `authenticate`: `Authorization: Bearer <token>` first, else the session cookie. Every successful path re-checks `isAllowed(env, login)`.
- CSRF: for cookie-authenticated requests with a method other than GET/HEAD/OPTIONS, the `Origin` header must equal the request URL origin, else 403.

## HTTP surface

Pages (lane ui; HTML; unauthenticated pages show the landing / sign-in link):

| Route | Page |
| --- | --- |
| `GET /` | Landing (signed out) or artifact list (signed in) |
| `GET /new` | Create form |
| `GET /a/:id` | Viewer: Preview/Code, version switcher (`?v=n`), copy, download, open in new tab, edit, share, retention, delete |
| `GET /a/:id/edit` | Edit form (title + content of latest version) |
| `GET /s/:shareId` | Public read-only viewer + "Remix" for signed-in users |
| `GET /settings` | API tokens + MCP setup snippet |

Auth (lane auth):

| Route | Behaviour |
| --- | --- |
| `GET /auth/login` | Random `state` in cookie `oauth_state` (HttpOnly, Secure, SameSite=Lax, Path=/auth, Max-Age=600); redirect to GitHub authorize (`scope=read:user`, `redirect_uri={origin}/auth/callback`) |
| `GET /auth/callback` | Check `state`; exchange code; fetch `/user`; 403 page if not allowed; `upsertUser`; set session; redirect `/` |
| `POST /auth/logout` | Clear session (CSRF origin check applies); redirect `/` |
| `GET /api/tokens` | `requireSession`; `{ items }` |
| `POST /api/tokens` | `requireSession`; body `{ name }` (1..100 chars); 201 `{ token, id, name, createdAt }` (token shown once) |
| `DELETE /api/tokens/:id` | `requireSession`; 204 |

REST API (lane api; `requireUser`; JSON errors `{ error }`):

| Route | Behaviour |
| --- | --- |
| `GET /api/artifacts` | `{ items: ArtifactSummary[] }` |
| `POST /api/artifacts` | body `{ title, type, content, language? }`; 201 `ArtifactView` |
| `GET /api/artifacts/:id` | `ArtifactView` |
| `GET /api/artifacts/:id/content` | `?version=n` (default latest), `?download=1` adds `Content-Disposition: attachment; filename=...`; `text/plain; charset=utf-8`, `X-Content-Type-Options: nosniff` |
| `PATCH /api/artifacts/:id` | body `{ title?, content?, old_str?, new_str? }`; `ArtifactView` |
| `DELETE /api/artifacts/:id` | 204 |
| `PUT /api/artifacts/:id/retention` | body `{ permanent: boolean }`; `ArtifactView` |
| `POST /api/artifacts/:id/share` | `ArtifactView` (with `shareUrl`) |
| `DELETE /api/artifacts/:id/share` | `ArtifactView` |

Render (lane render):

| Route | Behaviour |
| --- | --- |
| `GET /render/:id` | Owner only (`requireUser`); `?v=n`; HTML render document |
| `GET /s/:shareId/render` | Public; latest version; HTML render document |
| `GET /s/:shareId/raw` | Public; latest content as `text/plain`, `nosniff`; `?download=1` adds attachment disposition |

Render responses carry `Content-Security-Policy: sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store`. The sandbox (no `allow-same-origin`) gives the document an opaque origin, so artifact code cannot read app cookies, call the API with credentials or touch the parent page. The viewer iframe also sets the same `sandbox` attribute.

MCP (lane mcp): `POST /mcp`, stateless Streamable HTTP, JSON responses, Bearer token only (cookies are ignored). `GET`/`DELETE /mcp` → 405. Tools:

| Tool | Input | Result |
| --- | --- | --- |
| `list_artifacts` | — | summaries with `url` |
| `get_artifact` | `id`, `version?` | `ArtifactView` + `content` |
| `create_artifact` | `title`, `type`, `content`, `language?` | `ArtifactView` |
| `update_artifact` | `id`, `title?`, `content?`, `old_str?`, `new_str?` | `ArtifactView` |
| `delete_artifact` | `id` | confirmation |
| `set_artifact_retention` | `id`, `permanent` | `ArtifactView` |
| `share_artifact` | `id` | `ArtifactView` with `shareUrl` |
| `unshare_artifact` | `id` | `ArtifactView` |

Domain errors become tool results with `isError: true` and the error message.

## Error handling

`src/index.ts` `onError`: `ArtifactError` → its status; JSON `{ error }` for `/api/*` and `/mcp`, plain text otherwise. Other errors → 500 with a generic message (log the error).

## Cron

`triggers.crons = ["0 3 * * *"]`. `scheduled` runs `sweepExpired(env.BUCKET)` in `ctx.waitUntil`.
