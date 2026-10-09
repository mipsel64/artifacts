# Design: Artifacts on Cloudflare Workers + R2 + KV

A self-hosted clone of Claude Artifacts. Agents create and update artifacts over MCP; people view, share and manage them in the browser.

## Scope

In scope:

- Artifact types: `html`, `react`, `svg`, `mermaid`, `markdown`, `code`.
- Preview/Code view, version history, copy, download, open in a new tab, edit (new version), remix a shared artifact into your own account.
- Google sign-in (OpenID Connect) restricted to an email allowlist, personal API tokens, and OAuth 2.1 for MCP clients (Claude.ai, Claude Desktop, Claude Code) using the Google session for consent.
- Share links (public, revocable).
- Retention: 30 days by default, make permanent, set back to expiring, delete. A daily cron deletes expired artifacts.
- MCP server (Streamable HTTP, stateless) with OAuth access tokens or Bearer API tokens.

Out of scope: AI-powered artifacts (`window.claude`), artifact persistent storage (`window.storage`), shadcn/ui imports, collaborative editing.

## Stack

- TypeScript, Cloudflare Workers, Hono (routing + `hono/jsx` SSR). One R2 bucket `BUCKET` holds artifact metadata and content (strongly consistent, conditional writes). One KV namespace `KV` holds the owner index, share lookups, users and API tokens. A second namespace `OAUTH_KV` belongs to `@cloudflare/workers-oauth-provider` (clients, grants, tokens, consent state). It must stay separate because the library hardcodes the binding name and both stores use `token:` keys. No D1.
- Static assets: Workers static assets from `public/` (`assets.directory`).
- Tests: vitest 5 + `@cloudflare/vitest-plugin` (real R2 and KV via Miniflare; `afterEach(reset)` from `cloudflare:test` isolates storage).
- Package manager: bun. Scripts: `bun run test`, `bun run typecheck`, `bun run build` (= `wrangler deploy --dry-run --outdir dist`).

## Environment

| Name | Kind | Meaning |
| --- | --- | --- |
| `BUCKET` | R2 binding | Artifact `meta.json` and version content |
| `KV` | KV binding | Owner index, shares, users, API tokens |
| `OAUTH_KV` | KV binding | OAuth provider storage (clients, grants, hashed tokens); the name is fixed by the library |
| `GOOGLE_CLIENT_ID` | var | Google OAuth client id (Web application) |
| `GOOGLE_CLIENT_SECRET` | secret | Google OAuth client secret |
| `SESSION_SECRET` | secret | HMAC key for session cookies (>= 32 random bytes) |
| `ALLOWED_EMAILS` | var | Comma-separated email addresses allowed to sign in (exact match, case-insensitive). No wildcards or domains. Empty = nobody. |

## Source layout and ownership

| Path | Owner | Contents |
| --- | --- | --- |
| `src/index.ts` | foundation | App assembly, `OAuthProvider` wrapper, `onError`, `scheduled` |
| `src/types.ts` | foundation | Shared types |
| `src/artifacts.ts` | foundation | Domain + R2/KV storage |
| `src/auth.ts` | foundation | Sessions, API tokens, users, middleware |
| `src/routes/auth.ts` | lane auth | Google sign-in routes, `/api/tokens` |
| `src/routes/api.ts` | lane api | REST artifacts API |
| `src/routes/mcp.ts` | lane mcp | MCP tools and handler (called by the provider) |
| `src/routes/oauth.tsx` | lane auth | `/authorize` consent page, `/api/grants/:id` |
| `src/render.ts`, `src/routes/render.ts` | lane render | Sandboxed render documents and routes |
| `src/routes/ui.tsx`, `src/ui/**`, `public/**` | lane ui | SSR pages and client JS/CSS |
| `test/helpers.ts` | foundation | Test helpers |
| `test/<area>.test.ts` | each lane | Tests for its own area |

Each route module exports `default` a `new Hono<AppEnv>()` that declares full paths. `src/index.ts` mounts every module at `/`. Lanes never edit files they do not own, `package.json` or `bun.lock`.

## Shared types (`src/types.ts`)

```ts
export type ArtifactType = 'html' | 'react' | 'svg' | 'mermaid' | 'markdown' | 'code';
export const ARTIFACT_TYPES: readonly ArtifactType[];

export interface SessionUser { id: string; email: string }            // id = `google_<sub>`; email is lowercased
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

## Storage layout

R2 (`BUCKET`):

| Key | Body | Notes |
| --- | --- | --- |
| `artifacts/{id}/meta.json` | `ArtifactMeta` JSON | Source of truth |
| `artifacts/{id}/v/{version}-{rand}` | content | Unique key per write; `VersionInfo.key` points to it |

KV (`KV`):

| Key | Value | Notes |
| --- | --- | --- |
| `index:{ownerId}:{id}` | `''` | metadata: `{ title, type, version, updatedAt, expiresAt, shared }` (`title` cut to 100 chars to stay under the 1024-byte KV metadata limit; `expiresAt` null = permanent) |
| `share:{shareId}` | `{ artifactId, ownerId }` JSON | |
| `user:{userId}` | `User` JSON | |
| `token:{sha256hex(token)}` | `{ id, userId, email, name, createdAt }` JSON | |
| `user-token:{userId}:{tokenId}` | `''` | metadata: `{ name, createdAt, hash }` |

No KV key uses a TTL: the sweep finds expired artifacts through the index.

KV is eventually consistent (changes can take about 60 s to reach other locations). Accepted effects: the list can lag behind a create/update/delete; a revoked API token can keep working for up to about 60 s in other locations. Share revocation is immediate because `getSharedArtifact` also checks `meta.shareId` in R2.

Ids, share ids and token ids: 16 random bytes, base64url (22 chars). API tokens: `art_` + 32 random bytes base64url. Only the SHA-256 hex of a token is stored.

## Domain API (`src/artifacts.ts`)

```ts
export const RETENTION_DAYS = 30;
export const MAX_CONTENT_BYTES = 1024 * 1024;  // UTF-8 bytes
export const MAX_TITLE_LENGTH = 200;
export class ArtifactError extends Error { status: 400 | 404 | 409 | 413 }

createArtifact(env, ownerId, input: { title: string; type: ArtifactType; content: string; language?: string | null }, now?: Date): Promise<ArtifactMeta>
getArtifact(env, ownerId, id, now?): Promise<ArtifactMeta>            // 404: missing, other owner, or expired
getContent(env, meta, version?: number): Promise<string>                // default latest; 404 unknown version
listArtifacts(env, ownerId, now?): Promise<ArtifactSummary[]>           // non-expired, updatedAt desc
updateArtifact(env, ownerId, id, input: { title?: string; content?: string; oldStr?: string; newStr?: string }, now?): Promise<ArtifactMeta>
setRetention(env, ownerId, id, permanent: boolean, now?): Promise<ArtifactMeta>
deleteArtifact(env, ownerId, id): Promise<void>                          // 404 if not visible
shareArtifact(env, ownerId, id, now?): Promise<ArtifactMeta>             // idempotent: keeps existing shareId
unshareArtifact(env, ownerId, id, now?): Promise<ArtifactMeta>           // idempotent
getSharedArtifact(env, shareId, now?): Promise<ArtifactMeta>             // 404: unknown, revoked, or expired
sweepExpired(env, now?, limit = 100): Promise<number>                    // deletes up to `limit` expired artifacts
toView(meta, origin): ArtifactView                                           // url = {origin}/a/{id}, shareUrl = {origin}/s/{shareId}
fileName(meta): string                                                       // slug(title) + extension by type/language
```

Rules:

- Validation (400): title trimmed, 1..200 chars; `type` in `ARTIFACT_TYPES`; content non-empty string; `language` optional, max 32 chars of `[A-Za-z0-9+#._-]`. Content over `MAX_CONTENT_BYTES` → 413.
- Update: `content` and `oldStr`/`newStr` are mutually exclusive (400). `oldStr` must occur exactly once in the latest content (400 otherwise; message says 0 or N matches). Either form writes a new version. `title` alone renames without a new version. An update with nothing to change is 400.
- All functions take `env: Env` (they use `env.BUCKET` and `env.KV`).
- Retention: create sets `expiresAt = now + 30d`. A new version resets `expiresAt = now + 30d` unless permanent. `setRetention(true)` sets `null`; `setRetention(false)` sets `now + 30d`. An artifact is expired when `expiresAt !== null && expiresAt <= now`; expired artifacts are 404 everywhere before the sweep deletes them.
- Concurrency: write the version object first (unique key), then put `meta.json` with `onlyIf: { etagMatches }` from the read. On precondition failure, retry the whole read-modify-write up to 3 times, then 409. Update the KV index entry after meta (the index may lag; meta wins).
- Delete removes every R2 key under `artifacts/{id}/`, the KV index entry and the KV share entry.
- Sweep lists KV `index:` (all owners) with metadata, re-reads `meta.json` for each candidate, and deletes it only when meta is missing or expired.

## Auth (`src/auth.ts`)

```ts
export const SESSION_COOKIE = 'session';
export const SESSION_TTL_SECONDS = 7 * 24 * 3600;

isAllowed(env, email): boolean
upsertUser(env, user: { sub: string; email: string; name: string | null; avatarUrl: string | null }, now?): Promise<User>
getUser(env, userId): Promise<User | null>
createSessionCookie(env, user: SessionUser, now?): Promise<string>   // full Set-Cookie header value
clearSessionCookie(): string                                           // Set-Cookie value that expires it
readSession(env, cookieHeader: string | undefined, now?): Promise<SessionUser | null>
createApiToken(env, user: SessionUser, name: string, now?): Promise<{ token: string; id: string; name: string; createdAt: string }>
listApiTokens(env, userId): Promise<{ id: string; name: string; createdAt: string }[]>
revokeApiToken(env, userId, tokenId): Promise<void>                 // 404 if not owned
verifyApiToken(env, token): Promise<SessionUser | null>
authenticate(c): Promise<{ user: SessionUser; method: 'session' | 'token' } | null>
requireUser: MiddlewareHandler<AppEnv>                                 // sets c.var.user / c.var.authMethod, else 401 JSON
requireSession: MiddlewareHandler<AppEnv>                              // like requireUser but rejects Bearer tokens (403)
```

- Session cookie value: `base64url(JSON {uid, email, exp})` + `.` + `base64url(HMAC-SHA256(SESSION_SECRET, payload))`; `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`. Verify with constant-time comparison (`crypto.subtle.verify`).
- `authenticate`: `Authorization: Bearer <token>` first, else the session cookie. Every successful path re-checks `isAllowed(env, email)`.
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
| `GET /settings` | Connected apps (OAuth grants), API tokens, MCP setup (OAuth first, API token as the alternative) |
| `GET /authorize` | OAuth consent page (see OAuth below) |

Auth (lane auth):

| Route | Behaviour |
| --- | --- |
| `GET /auth/login` | Random `state`, `nonce` and PKCE `code_verifier` in one signed cookie `oauth_state` (HMAC with `SESSION_SECRET`; HttpOnly, Secure, SameSite=Lax, Path=/auth, Max-Age=600); redirect to `https://accounts.google.com/o/oauth2/v2/auth` (`response_type=code`, `scope=openid email profile`, `redirect_uri={origin}/auth/callback`, `state`, `nonce`, `code_challenge` S256, `prompt=select_account`). `?next=` is accepted only if it starts with `/authorize?` (anything else is ignored) and is appended to the `oauth_state` cookie value (`state.nonce.verifier.next`) |
| `GET /auth/callback` | Clear `oauth_state`; check `state`; exchange the code at `https://oauth2.googleapis.com/token` (form body with `code_verifier`); validate the ID token claims (`iss`, `aud`, `exp`, `nonce`, `email_verified === true`); 403 if the email is not allowed; `upsertUser`; set session; redirect to `next` if one was saved by `/auth/login`, else `/` |
| `POST /auth/logout` | Clear session (CSRF origin check applies); redirect `/` |
| `GET /api/tokens` | `requireSession`; `{ items }` |
| `POST /api/tokens` | `requireSession`; body `{ name }` (1..100 chars); 201 `{ token, id, name, createdAt }` (token shown once) |
| `DELETE /api/tokens/:id` | `requireSession`; 204 |
| `DELETE /api/grants/:id` | `requireSession`; `revokeGrant(id, user.id)`; 204, 404 if the grant is not the user's |

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

### MCP and OAuth

`src/index.ts` wraps the Hono app in `OAuthProvider` (`@cloudflare/workers-oauth-provider`), built once per request origin because the resource (`{origin}/mcp`) and issuer (`{origin}`) must match it. The provider owns these paths and sends everything else to the Hono app:

| Path | Handled by |
| --- | --- |
| `/mcp` (`apiRoute`) | Provider validates the bearer token, then calls the MCP handler with `ctx.props = { userId, email }` |
| `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/mcp` | Provider (RFC 8414, RFC 9728) |
| `POST /token`, `POST /register` | Provider (token, refresh, revocation; dynamic client registration) |
| `GET`/`POST /authorize` | Hono (`src/routes/oauth.tsx`) using the provider helpers in `env.OAUTH_PROVIDER` |

Two kinds of bearer token reach `/mcp`, both resolved to the same props:

- OAuth access tokens issued by the provider (1 h, refresh tokens rotate, 30 days from consent). Scope `artifacts` is advertised in the `401` challenge and metadata but nothing is gated on scopes. `offline_access` is accepted but not needed: refresh tokens are issued to clients that register the `refresh_token` grant.
- Personal `art_` API tokens, through `resolveExternalToken`: `verifyApiToken` + `isAllowed`, audience `{origin}/mcp`.

The handler re-checks `isAllowed(env, email)` on every request (403 `{ error: 'Forbidden' }`), so removing an address from `ALLOWED_EMAILS` also stops its OAuth tokens. Cookies are never accepted on `/mcp`. Without a valid token, any method gets the provider's `401` with `WWW-Authenticate: Bearer ... resource_metadata="{origin}/.well-known/oauth-protected-resource/mcp"`. With a valid token, `GET`/`DELETE` → 405.

`GET /authorize`: `parseAuthRequest` (a validation error without a safe redirect renders a 400 page; one with a validated redirect URI redirects to the client with the error). Then it needs a Google browser session (the `session` cookie only; an `Authorization` header is ignored): without one it redirects to `/auth/login?next=<path+query of the request>`. With a session it renders the consent page: the client name (escaped; stated as unverified), the redirect host, a warning for a loopback redirect, the signed-in email, and Allow/Deny in one POST form that carries only the library's consent `handle`. The page sends the library's headers (browser-bound `__Host-oauth-consent-…` cookie, no framing) and the app's page headers, except that `form-action` is `'self'` plus the redirect URI's origin (its scheme for a native app): browsers apply `form-action` to the redirect that answers the form POST, so a stricter policy would block the redirect to the client.

`POST /authorize` (`requireSession`, so same-origin `Origin` check and no Bearer): `denyConsent` redirects with `access_denied`; `approveConsent` then `completeAuthorization({ userId: user.id, metadata: { email }, scope: request.scope, props: { userId, email } })` redirects with the code. The request comes from provider storage, never from the form. Consent is asked every time (no remembered consent). Handle errors (expired, reused, missing binding cookie) render a 400 page.

Revoking: `DELETE /api/grants/:id` or deleting the client. Revoked tokens stop working once the KV deletion propagates (KV is eventually consistent, about 60 s in other locations). The daily cron also runs the provider's `purgeExpiredData`.

MCP tools (`POST /mcp`, stateless Streamable HTTP, JSON responses):

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

`src/index.ts` `onError`: `ArtifactError` → its status; JSON `{ error }` for `/api/*`, plain text otherwise. Errors on `/mcp` are the provider's or the MCP tool results. Other errors → 500 with a generic message (log the error).

## Cron

`triggers.crons = ["0 3 * * *"]`. `scheduled` runs `sweepExpired(env)` and the OAuth provider's `purgeExpiredData(env)`, each in `ctx.waitUntil`.
