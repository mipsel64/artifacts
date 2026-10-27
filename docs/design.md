# Design: Artifacts on Cloudflare Workers + R2 + KV

A self-hosted clone of Claude Artifacts. Agents create and update artifacts over MCP; people view, share and manage them in the browser.

## Scope

In scope:

- Artifact types: `html`, `react`, `svg`, `mermaid`, `markdown`, `code`, `slides`, `design`, `motion`, `archify`.
- Preview/Code view, version history, copy, download, open in a new tab, edit (new version), remix a shared artifact into your own account.
- Google sign-in (OpenID Connect) for an email allowlist and restricted share viewers, personal API tokens, and OAuth 2.1 for MCP clients (Claude.ai, Claude Desktop, Claude Code) using the Google session for consent.
- Share links (open to anyone or restricted to listed viewers, revocable).
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
| `BUCKET` | R2 binding | Artifact `meta.json`, version content and cached Archify HTML |
| `KV` | KV binding | Owner index, shares, users, API tokens |
| `OAUTH_KV` | KV binding | OAuth provider storage (clients, grants, hashed tokens); the name is fixed by the library |
| `GOOGLE_CLIENT_ID` | var | Google OAuth client id (Web application) |
| `GOOGLE_CLIENT_SECRET` | secret | Google OAuth client secret |
| `SESSION_SECRET` | secret | HMAC key for session cookies (>= 32 random bytes) |
| `ALLOWED_EMAILS` | var | Comma-separated email addresses allowed to sign in (exact match, case-insensitive). No wildcards or domains. Empty = nobody. |

The Worker config sets `preview_urls: false`. This stops version preview URLs from serving old code with production R2 and KV.

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
| `src/archify/**` | lane render | Archify engine host, validation and generated engine declaration |
| `scripts/archify-*.ts` | lane render | Deterministic engine build and pinned upstream sync |
| `vendor/archify/**` | lane render | Vendored upstream renderers, runtime data and source pin |
| `src/routes/ui.tsx`, `src/ui/**`, `public/**` | lane ui | SSR pages and client JS/CSS |
| `test/helpers.ts` | foundation | Test helpers |
| `test/<area>.test.ts` | each lane | Tests for its own area |

Each route module exports `default` a `new Hono<AppEnv>()` that declares full paths. `src/index.ts` mounts every module at `/`. Lanes never edit files they do not own, `package.json` or `bun.lock`.

## Shared types (`src/types.ts`)

```ts
export type ArtifactType = 'html' | 'react' | 'svg' | 'mermaid' | 'markdown' | 'code' | 'slides' | 'design' | 'motion' | 'archify';
export const ARTIFACT_TYPES: readonly ArtifactType[];

export interface SessionUser { id: string; email: string }            // id = `google_<sub>`; email is lowercased
export interface Session extends SessionUser { hostedDomain: string | null }
export interface User extends SessionUser { name: string | null; avatarUrl: string | null; createdAt: string }

export interface VersionInfo { version: number; key: string; size: number; createdAt: string }
export interface ArtifactMeta {
  id: string; ownerId: string; title: string; type: ArtifactType; language: string | null;
  version: number;                 // latest version number, starts at 1
  versions: VersionInfo[];         // ascending
  createdAt: string; updatedAt: string;   // ISO 8601
  expiresAt: string | null;        // null = permanent
  shareId: string | null;
  shareAudience: string[] | null;  // null = anyone; entries = listed viewers plus owner
}
export interface ArtifactSummary {
  id: string; title: string; type: ArtifactType; version: number;
  updatedAt: string; expiresAt: string | null; shared: boolean;
}
export interface ArtifactView extends ArtifactMeta { url: string; renderUrl: string; shareUrl: string | null }

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser; authMethod: 'session' | 'token' } };
```

## Storage layout

R2 (`BUCKET`):

| Key | Body | Notes |
| --- | --- | --- |
| `artifacts/{id}/meta.json` | `ArtifactMeta` JSON | Source of truth |
| `artifacts/{id}/v/{version}-{rand}` | content | Unique key per write; `VersionInfo.key` points to it |
| `artifacts/{id}/v/{version}-{rand}.html` | rendered Archify HTML | Only for Archify; `customMetadata.ARCHIFY_VERSION` tags the renderer version; serve-time theme and print scripts are not stored |

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

Share audiences live only in R2 `meta.json`; there are no new KV keys. `createArtifact` writes `shareAudience: null`. `readMeta` normalizes a missing field in old metadata to `null`. The KV index metadata and `share:{shareId}` value do not change.

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
shareArtifact(env, ownerId, id, options: { audience?: unknown } = {}, now = new Date()): Promise<ArtifactMeta> // idempotent: keeps existing shareId
unshareArtifact(env, ownerId, id, now?): Promise<ArtifactMeta>           // idempotent; clears shareAudience
getSharedArtifact(env, shareId, now?): Promise<ArtifactMeta>             // 404: unknown, revoked, or expired
canViewShare(meta: ArtifactMeta, viewer: Session | null): boolean         // open link, owner, or matching viewer
sweepExpired(env, now?, limit = 100): Promise<number>                    // deletes up to `limit` expired artifacts
toView(meta, origin): ArtifactView                                           // url = {origin}/a/{id}, renderUrl = {origin}/r/{id}, shareUrl = {origin}/s/{shareId}
fileName(meta, content): string                                             // slug(title) + extension by type/language; Archify also uses JSON vs Markdown source
```

Rules:

- Validation (400): title trimmed, 1..200 chars; `type` in `ARTIFACT_TYPES`; content non-empty string; `language` optional, max 32 chars of `[A-Za-z0-9+#._-]`. Content over `MAX_CONTENT_BYTES` → 413.
- Update: `content` and `oldStr`/`newStr` are mutually exclusive (400). `oldStr` must occur exactly once in the latest content (400 otherwise; message says 0 or N matches). Either form writes a new version. `title` alone renames without a new version. An update with nothing to change is 400.
- Archify: create and every content update call `renderArchify` before any new content is stored. `ArchifyError` becomes a 400 with formatted diagnostics. A rejected content edit leaves the previous version latest. Title-only updates do not render. JSON candidates need no authored `meta.output`; the engine supplies virtual output names, including for inline explainer diagrams. The validated HTML is written to `{versionKey}.html` after the version object. An etag retry reuses the HTML when the candidate is unchanged and rolls back both objects after a failed meta write.
- All functions take `env: Env` (they use `env.BUCKET` and `env.KV`).
- Retention: create sets `expiresAt = now + 30d`. A new version resets `expiresAt = now + 30d` unless permanent. `setRetention(true)` sets `null`; `setRetention(false)` sets `now + 30d`. An artifact is expired when `expiresAt !== null && expiresAt <= now`; expired artifacts are 404 everywhere before the sweep deletes them.
- Sharing: `shareAudience: null` lets anyone with the link view. A non-empty array limits access to its entries and the owner. When `shareId` is `null`, `shareAudience` is also `null`. An audience entry is an exact email (`alice@example.com`) or a domain (`@example.com`). Audience entries use ASCII only. An email has exactly one `@`. Its local part has 1..64 printable ASCII chars (`\x21`–`\x7e`) and excludes `@,;<>()"`. A domain has at least two labels that match `[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?`, with at most 253 chars in total. A whole entry has at most 254 chars. Wildcards and bare domains are invalid. Entries are trimmed, lowercased and deduplicated in input order. A restricted list has 1..50 entries after dedupe. Matching is case-insensitive. The owner always has access.
- Domain entries require Google Workspace. `@example.com` matches only when the viewer email ends with `@example.com` and the Google ID token `hd` claim equals `example.com`. It does not match `x@eng.example.com`. Google requires the `hd` check for domain restriction because a consumer account can have any verified email address ([Google OpenID Connect reference](https://developers.google.com/identity/openid-connect/reference)). Exact-email entries require a verified email.
- `shareArtifact` validates `options.audience` only when it is present. An omitted audience keeps the current setting; a new link gets `null`. `null` opens the link to anyone. An array restricts it. An empty array is invalid. The share id stays unchanged when only the audience changes. An unchanged share or audience does not write metadata. `unshareArtifact` clears both fields. `getSharedArtifact` reads the audience from R2 on every request, so an audience change applies on the next request.
- Concurrency: write the version object first (unique key), then put `meta.json` with `onlyIf: { etagMatches }` from the read. On precondition failure, retry the whole read-modify-write up to 3 times, then 409. Update the KV index entry after meta (the index may lag; meta wins).
- Delete removes every R2 key under `artifacts/{id}/`, including each Archify HTML cache object, the KV index entry and the KV share entry. The expiry sweep and orphan cleanup use the same prefix purge.
- Sweep lists KV `index:` (all owners) with metadata, re-reads `meta.json` for each candidate, and deletes it only when meta is missing or expired.

## Auth (`src/auth.ts`)

```ts
export const SESSION_COOKIE = '__Host-session';
export const SESSION_TTL_SECONDS = 7 * 24 * 3600;
export const VIEWER_SESSION_TTL_SECONDS = 3600;

isAllowed(env, email): boolean
upsertUser(env, user: { sub: string; email: string; name: string | null; avatarUrl: string | null }, now?): Promise<User>
getUser(env, userId): Promise<User | null>
createSessionCookie(env, user: SessionUser & { hostedDomain?: string | null }, now?, ttlSeconds = SESSION_TTL_SECONDS): Promise<string> // full Set-Cookie header value
clearSessionCookie(): string                                           // Set-Cookie value that expires it
readSession(env, cookieHeader: string | undefined, now?): Promise<Session | null>
createApiToken(env, user: SessionUser, name: string, now?): Promise<{ token: string; id: string; name: string; createdAt: string }>
listApiTokens(env, userId): Promise<{ id: string; name: string; createdAt: string }[]>
revokeApiToken(env, userId, tokenId): Promise<void>                 // 404 if not owned
verifyApiToken(env, token): Promise<SessionUser | null>
authenticate(c): Promise<{ user: SessionUser; method: 'session' | 'token' } | null>
requireUser: MiddlewareHandler<AppEnv>                                 // sets c.var.user / c.var.authMethod, else 401 JSON
requireSession: MiddlewareHandler<AppEnv>                              // like requireUser but rejects Bearer tokens (403)
```

- The session cookie is named `__Host-session`. `readSession` rejects a Cookie header with more than one `__Host-session` part. It ignores the old `session` cookie.
- Session cookie value: `base64url(JSON {uid, email, hd, exp})` + `.` + `base64url(HMAC-SHA256(SESSION_SECRET, payload))`; `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<TTL>`. Verify with constant-time comparison (`crypto.subtle.verify`). `hd` is the lowercased Google hosted domain or `null`. An old cookie without `hd` has `hostedDomain: null`; any other non-string value rejects the cookie.
- Owner sessions last 7 days. Viewer sessions last 1 hour. The signed `exp` and `Max-Age` use the same TTL.
- The callback checks `email_verified`. It then requires printable ASCII (`\x21`–`\x7e`) in the raw email claim. It rejects other addresses before the allowlist check.
- A person outside `ALLOWED_EMAILS` gets a viewer session only through a share-page sign-in. The callback does not create a KV user record for this session. `authenticate` still re-checks `isAllowed` on every request, so the session cannot open the library, `/api/*`, Settings, `/mcp` or the `/authorize` consent page.
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
| `GET /s/:shareId` | Read-only viewer + "Remix" for signed-in allowlisted users. A restricted link returns a 403 "Restricted link" page when the viewer lacks access; it shows no artifact details or audience |
| `GET /settings` | Connected apps (OAuth grants), API tokens, MCP setup (OAuth first, API token as the alternative) |
| `GET /authorize` | OAuth consent page (see OAuth below) |

Auth (lane auth):

| Route | Behaviour |
| --- | --- |
| `GET /auth/login` | Random `state`, `nonce` and PKCE `code_verifier` in one signed cookie `__Host-oauth_state` (HMAC with `SESSION_SECRET`; HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age=600); redirect to `https://accounts.google.com/o/oauth2/v2/auth` (`response_type=code`, `scope=openid email profile`, `redirect_uri={origin}/auth/callback`, `state`, `nonce`, `code_challenge` S256, `prompt=select_account`). `?next=` accepts only a path that starts with `/authorize?` or an exact `/s/:shareId` path (anything else is ignored) and is appended to the `__Host-oauth_state` cookie value (`state.nonce.verifier.next`) |
| `GET /auth/callback` | Clear `__Host-oauth_state`; check `state`; exchange the code at `https://oauth2.googleapis.com/token` (form body with `code_verifier`); validate the ID token claims (`iss`, `aud`, `exp`, `nonce`, `email_verified === true`); read `hd` as the lowercased hosted domain or `null`. An allowlisted email follows `upsertUser`, sets the session and redirects to `next` or `/`. A non-allowlisted email with a share-page `next` gets a viewer session without `upsertUser` and redirects to that page. Any other non-allowlisted email gets 403 |
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
| `POST /api/artifacts/:id/share` | Optional body `{ audience?: string[] | null }`; empty body = `{}` and a non-object body = 400. Omitted `audience` keeps the current setting (new link = `null`), `null` opens to anyone, and an array restricts access. The share id does not change when only the audience changes. Returns `ArtifactView` with `shareUrl` and `shareAudience` |
| `DELETE /api/artifacts/:id/share` | `ArtifactView` with `shareId: null` and `shareAudience: null` |

Render (lane render):

| Route | Behaviour |
| --- | --- |
| `GET /r/:id` | Owner only; unauthenticated top-level browser navigations redirect to sign-in with `next=/r/{id}`, other unauthenticated requests get 401; `?v=n`; HTML render document |
| `GET /s/:shareId/render` | Shared; latest version; HTML render document; 403 when a restricted-link viewer lacks access |
| `GET /s/:shareId/raw` | Shared; latest content as `text/plain`, `nosniff`; 403 when a restricted-link viewer lacks access; `?download=1` adds attachment disposition |

Render responses carry `Content-Security-Policy: sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store, no-transform` (`no-transform` stops Cloudflare from injecting its Web Analytics beacon and bot-detection script, which fail inside the sandbox). The sandbox (no `allow-same-origin`) gives the document an opaque origin, so artifact code cannot read app cookies, call the API with credentials or touch the parent page. The viewer iframe also sets the same `sandbox` attribute.

Share routes read the viewer from the session cookie only. They ignore the `Authorization` header.

Theme: every non-Archify render document gets `THEME_CSS` (Claude-style tokens such as `--bg`, `--fg`, `--surface`, `--accent`, `--chart-1`…`--chart-6`, `--font`, `--sans`, `--mono`, only custom properties, in `@layer artifact-theme`) and `THEME_SCRIPT`. `--font` is the default serif reading font, `--sans` is for interface text and diagrams, and `--mono` is for code. The script moves the token `<style>` to the start of `<head>`, so the layer is declared first and every artifact style, layered or not, wins over it. It sets `data-theme="light|dark"` on `<html>` unless the artifact set its own value. Shells (markdown, code, mermaid, slides, design, svg) carry them in `<head>`; html and motion get them appended after the content. The opaque-origin document cannot read the app's choice, so it posts `{ type: 'artifact-theme-request' }` to its parent and accepts only `{ type: 'artifact-theme', theme: 'light'|'dark'|'system' }` whose `source` is the parent; `app.js` answers the request and resends on iframe load and on every theme switch. Without a parent it follows `prefers-color-scheme`, except the `?print=1` tab, which is always light. The markdown, code and slides shells style themselves from the tokens and set `color-scheme`; the design and mermaid canvas chrome uses the tokens, but design artboards stay white and sans by default. html, react and motion get no colors or `color-scheme` from the theme. React and design map the tokens to Tailwind colors (`bg-surface`, `text-fg`, …) with a `dark:` variant on `[data-theme=dark]`; `font-serif`, `font-sans` and `font-mono` map to the three font tokens. React text defaults to serif, while design artboards default to sans. Mermaid uses theme `base` with variables read from the tokens, including the sans font, and redraws the SVG on a theme change.

Archify rendering is asynchronous (`renderDocument` returns `Promise<string>` for every type). Writes validate with the real upstream renderer, run the same `scripts/check-render-output.mjs <output.html>` strict check as upstream finalize (including the explainer page), and reject output over 10 MiB with `archify-output-too-large`. The quality profile is the authored one (`meta.quality_profile` in JSON, the last `@meta quality_profile` outside code fences in a Markdown draft), else `showcase`. It is passed as `ARCHIFY_QUALITY_PROFILE`, as upstream finalize passes the `--quality` that its skill tells the agent to match to the authored profile. Render routes and HTML export read `{versionKey}.html` for the exact requested version when its `ARCHIFY_VERSION` custom metadata matches. Otherwise they render, serve and best-effort store the raw upstream HTML. Cached HTML never contains the serve-time wrappers.

The serve-time wrapper appends the theme bridge, then `THEME_SCRIPT`; it adds the ready flag and print waiter only for `?print=1`. It does not add `THEME_CSS` to a successful Archify document: Archify owns variables with the same names, including `--bg`. The bridge receives `artifact-theme` and clicks an explainer's matching `[data-theme-choice]` button, calls `Archify.theme.toggle()` for a native diagram, or sets `data-theme` as a fallback. After an OS theme change it re-asserts the viewer choice because Archify also follows the OS. Thus print mode ends light, the upstream toolbar toggle still works, and the next viewer theme change takes precedence. A render-time `ArchifyError` returns an escaped diagnostics document with `THEME_HEAD` and the renderer-shell `color-scheme` CSS, with status 200 inside the sandbox; other errors propagate. Raw Archify downloads use `.json` for JSON source and `.archify.md` for Markdown drafts; Markdown export fences use `json` or `markdown` by the same source rule.

Diagram zoom: html and react documents also get `DIAGRAM_ZOOM_SCRIPT`. A `MutationObserver` finds Mermaid SVGs that the artifact draws itself (`.mermaid > svg`, `svg[aria-roledescription][role~="graphics-document"]`) and adds pan and zoom by changing their `viewBox`, so the page layout never changes: drag, pinch or ctrl/cmd-wheel (a plain wheel still scrolls the page), `0` to reset, `+`/`-`/`f` when focused, and a hover toolbar (−, +, Fit, full screen) in a shadow root.

Lightbox: html, react, markdown and slides documents get `LIGHTBOX_SCRIPT`. Loaded images at least 48 CSS px in one dimension, Mermaid diagrams, and sufficiently large top-level SVGs open in a modal click-to-zoom viewer unless they are inside an interactive element, have an author-set pointer cursor, or have `data-artifact-no-zoom` on the element or an ancestor. The viewer supports wheel, double-click, drag, pinch and keyboard zoom/pan, restores focus and scroll on close, and is hidden from print. SVG, mermaid, design, code, motion and archify documents do not receive it.

Section links: markdown headings get github-slugger ids (lowercase; characters other than letters, marks, decimal digits, connector punctuation, `-` and space removed; spaces become `-`; repeats get `-1`, `-2`; ids already in the document count as taken), so `[Install](#install)` links written for GitHub work. Each heading (except inside `<summary>`) is wrapped in `div.markdown-heading` with a sibling `a.anchor` permalink that shows on hover or keyboard focus. After rendering, the document scrolls to `location.hash` again, because the browser looked for it before the headings existed. In the viewer, the opaque-origin document posts `{ type: 'artifact-hash-request' }` and, on every `hashchange`, `{ type: 'artifact-hash', hash }` to its parent; it accepts `{ type: 'artifact-hash', hash: '#…' }` only from the parent and applies it with `location.replace`. `app.js` answers the request (and sends once at start and on its own `hashchange`, unless the fragment names an element of the page such as the skip link's `#main`) with its own `location.hash`, and mirrors reported fragments into the page URL with `history.replaceState`, accepting only `''` or `#…` from the preview frame. The Share popover link gets the same fragment, so the owner can copy a link to a section.

html documents get `SECTION_LINKS_SCRIPT` with the same bridge and slug rules, but the artifact DOM is never changed: a heading without an `id` keeps none, and the script resolves a fragment that matches no `id` or `<a name>` to the heading whose computed slug equals it (on `hashchange`, on a click of a link to the current fragment, at script run and at `load` unless the reader has already scrolled). Hovering an `h1`–`h6` shows a permalink in a fixed shadow-root host after the last line of the heading text; it has no keyboard entry point, because the script does not make artifact headings focusable. Headings inside `a[href]`, `button`, `summary` or `label`, or that contain an `a[href^="#"]`, get none. Fragment jumps use absolute URLs (`location.href` without its fragment), so an artifact `<base href>` cannot send them to another document.

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

`GET /authorize`: `parseAuthRequest` (a validation error without a safe redirect renders a 400 page; one with a validated redirect URI redirects to the client with the error). Then it needs a Google browser session (the `__Host-session` cookie only; an `Authorization` header is ignored): without one it redirects to `/auth/login?next=<path+query of the request>`. With a session it renders the consent page: the client name (escaped; stated as unverified), the redirect host, a warning for a loopback redirect, the signed-in email, and Allow/Deny in one POST form that carries only the library's consent `handle`. The page sends the library's headers (browser-bound `__Host-oauth-consent-…` cookie, no framing) and the app's page headers, except that `form-action` is `'self'` plus the redirect URI's origin (its scheme for a native app): browsers apply `form-action` to the redirect that answers the form POST, so a stricter policy would block the redirect to the client.

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
| `share_artifact` | `id`, `audience?: string[] | null` | `ArtifactView` with `shareUrl` and `shareAudience`; uses the same audience rules as the REST API |
| `unshare_artifact` | `id` | `ArtifactView` |

Domain errors become tool results with `isError: true` and the error message.

## Error handling

`src/index.ts` `onError`: `ArtifactError` → its status; JSON `{ error }` for `/api/*`, plain text otherwise. Errors on `/mcp` are the provider's or the MCP tool results. Other errors → 500 with a generic message (log the error).

## Cron

`triggers.crons = ["0 3 * * *"]`. `scheduled` runs `sweepExpired(env)` and the OAuth provider's `purgeExpiredData(env)`, each in `ctx.waitUntil`.
