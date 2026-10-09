# Artifacts

A self-hosted take on Claude Artifacts for Cloudflare Workers. Agents create and update artifacts over MCP; you view, version, share and manage them in the browser.

- **Types:** HTML, React (JSX/TSX with Tailwind and npm imports via esm.sh), SVG, Mermaid, Markdown, code.
- **Viewer:** Preview/Code tabs, version history, copy, download, open in a new tab, edit, remix a shared artifact.
- **Auth:** Google sign-in restricted to an email allowlist; OAuth 2.1 for MCP clients (consent through your Google session); personal API tokens for agents.
- **Share:** public read-only links, revocable at any time.
- **Retention:** artifacts expire 30 days after their last content change. Make one permanent, set it back to expiring, or delete it. A daily cron (03:00 UTC) removes expired artifacts.
- **MCP:** a stateless Streamable HTTP endpoint at `/mcp` with tools to list, get, create, update, delete, share and set retention.

Storage: R2 holds artifact metadata and every version; KV holds the per-user index, share links, users and API tokens; a second KV namespace (`OAUTH_KV`) holds OAuth clients, grants and tokens. See [docs/design.md](docs/design.md) for the full contract.

## Cost

**$5 per month covers personal and small-team use.** That is the minimum charge of the [Workers Paid plan](https://developers.cloudflare.com/workers/platform/pricing/), and every usage counter of a typical deployment stays inside what the plan includes. Usage charges start only at millions of requests per month.

### Measured on artifacts.m64.sh

CPU time per request over 24 hours (2026-10-09, 945 Worker invocations, 0 errors), from Workers Observability:

| Route | Requests | Mean CPU | p90 CPU |
| --- | ---: | ---: | ---: |
| MCP `/mcp` | 439 | 8.9 ms | 18 ms |
| Artifact list `/` | 69 | 16.8 ms | 36 ms |
| Viewer `/a/:id` | 20 | 13.1 ms | 27 ms |
| Public share page `/s/:id` | 10 | 19.6 ms | 41 ms |
| Render iframe and REST API | 51 | ~3 ms | ~6 ms |

Static files (`/static/*`) are served as [Workers static assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/): free and not counted as requests. About 300 of the 945 invocations were bots probing paths such as `/.env`; they used 0–1 ms each.

**Use Workers Paid, not Workers Free.** The Free plan stops each request at 10 ms of CPU time, and the server-rendered pages above use 13–20 ms on average. Paid allows 30 s per request by default (up to 5 min) and includes 10 million requests and 30 million CPU milliseconds per month. The $5 is per Cloudflare account and also covers your other Workers.

### What one action uses

| Action | Worker requests | CPU | KV | R2 |
| --- | ---: | ---: | --- | --- |
| Create or update an artifact (MCP) | ~1.5 | ~9 ms | 1 write, 1 read | 2 Class A, 0–2 Class B |
| Open an artifact in the viewer | 2 | ~16 ms | 1 read | 4 Class B |
| Open a public share link | 2 | ~23 ms | 2 reads | 4 Class B |
| Open the artifact list | 1 | ~17 ms | 1 list, 1 read | — |

MCP clients also send `initialize` and `tools/list`, hence ~1.5 requests per tool call. These ratios are consistent with the R2 and KV counters of the same 24 hours.

### Monthly estimates

| Scenario | Assumptions | Monthly cost |
| --- | --- | ---: |
| Personal | 60 artifact writes, 100 views, 50 public share views per day; 20 KB per version | **$5.00** |
| Small team | ~20 people + agents: 2,000 writes, 5,000 views, 5,000 share views per day; 30 KB per version (~1.8 GB stored) | **$5.00** |
| Viral share link | Personal use + 1 million public share views per month | **$5.00** |
| Very heavy | 1 million writes, 10 million share views, 300,000 views per month; 35 GB stored | **~$35** |

The "very heavy" total is $5 + $3.64 requests + $4.29 CPU + $5.67 KV + $16.48 R2. Beyond the included amounts, each additional million costs about:

- artifact writes: **$15.50** (R2 Class A writes and KV writes dominate)
- viewer opens: **$2.90**
- public share views: **$3.50**
- stored data above 10 GB: **$0.015 per GB-month**; R2 egress is free

Retention keeps storage small: stored data is roughly *writes per day × version size × 30 days*, plus the artifacts you made permanent.

Not included: domain registration (optional; the free `workers.dev` subdomain works, and a custom domain on a Cloudflare zone costs nothing extra) and taxes. Prices are from Cloudflare's [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [KV](https://developers.cloudflare.com/kv/platform/pricing/) and [R2](https://developers.cloudflare.com/r2/pricing/) pricing pages as of 2026-10-09; the CPU sample is small and mostly MCP uploads, so treat the per-action numbers as estimates.

## Deploy

Requirements: [bun](https://bun.sh) and a Cloudflare account.

```sh
bun install
bunx wrangler login

bunx wrangler r2 bucket create artifacts
bunx wrangler kv namespace create KV         # put the printed id into wrangler.jsonc (binding KV)
bunx wrangler kv namespace create OAUTH_KV   # put the printed id into wrangler.jsonc (binding OAUTH_KV; the name is fixed)
```

Set up Google sign-in in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials):

1. Configure the OAuth consent screen (Google Auth Platform → Branding/Audience) with the scopes `openid`, `email` and `profile`. While the app is in "Testing" status, add your own address as a test user.
2. Create an OAuth client ID of type "Web application" with these authorized redirect URIs:
   - `https://<your-worker-host>/auth/callback`
   - `http://localhost:8787/auth/callback` (local development)

Configure the Worker:

```sh
# wrangler.jsonc → routes: set your domain (or remove "routes" to use workers.dev)

bunx wrangler secret put GOOGLE_CLIENT_ID
bunx wrangler secret put GOOGLE_CLIENT_SECRET
bunx wrangler secret put ALLOWED_EMAILS     # comma-separated addresses (exact match, case-insensitive; empty = nobody)
openssl rand -base64 48 | bunx wrangler secret put SESSION_SECRET

bunx wrangler deploy
```

All four values are Worker secrets, so the committed config holds no personal data.

## Connect an agent

### With OAuth (recommended)

Add `https://<your-worker-host>/mcp` as a connector and sign in with Google when asked (you must be in `ALLOWED_EMAILS`):

- **Claude.ai** (custom connector) and **Claude Desktop**: add the URL under Connectors.
- **Claude Code:**

  ```sh
  claude mcp add --transport http artifacts https://<your-worker-host>/mcp
  ```

  then run `/mcp` inside Claude Code and choose `artifacts` to sign in.

The consent page names the app and where access will be sent. Connected apps are listed in **Settings**, where you can revoke each one.

### With an API token

Sign in, open **Settings**, create an API token, then:

```sh
claude mcp add --transport http artifacts https://<your-worker-host>/mcp \
  --header "Authorization: Bearer <YOUR_TOKEN>"
```

Other MCP clients:

```json
{ "mcpServers": { "artifacts": { "type": "http", "url": "https://<your-worker-host>/mcp",
  "headers": { "Authorization": "Bearer <YOUR_TOKEN>" } } } }
```

Tools: `list_artifacts`, `get_artifact`, `create_artifact`, `update_artifact` (full rewrite or `old_str`/`new_str` edit), `delete_artifact`, `set_artifact_retention`, `share_artifact`, `unshare_artifact`.

The same token works with the REST API under `/api/artifacts` (see [docs/design.md](docs/design.md#http-surface)).

## Security model

- Artifact code runs in a sandboxed document (`Content-Security-Policy: sandbox` without `allow-same-origin`). It gets an opaque origin, so it cannot read your cookies, call the API as you or touch the app page.
- Sign-in is Google OpenID Connect (authorization code flow with PKCE, `state` and `nonce`; the ID token must have a verified email). Only addresses listed in `ALLOWED_EMAILS` can sign in: an exact match, no wildcards or domains. The allowlist is re-checked on every request. Your identity is bound to the Google account id (`sub`), not the email address. Sessions are HMAC-signed cookies (`HttpOnly`, `Secure`, `SameSite=Lax`) and cookie-authenticated writes require a same-origin `Origin` header.
- API tokens are stored only as SHA-256 hashes and are shown once.
- MCP OAuth (`@cloudflare/workers-oauth-provider`): PKCE S256, dynamic client registration, consent on every authorization behind your Google session, a browser-bound single-use consent handle, no framing. Self-registered client names are not verified, so the consent page shows where access goes and warns about localhost redirects. Tokens are stored hashed. The allowlist is re-checked on every `/mcp` request, and revoking an app in Settings stops it (within about a minute in other locations, as with API tokens).
- KV is eventually consistent: the artifact list can lag for up to about a minute in other locations, and a revoked token can keep working there for about a minute. Share revocation is immediate.
- Rendering loads React, Babel, Tailwind, Mermaid, marked and highlight.js from public CDNs (jsDelivr, esm.sh) at pinned versions; npm packages that React artifacts import resolve from esm.sh at view time.

## Develop

```sh
cp .dev.vars.example .dev.vars   # set SESSION_SECRET, GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET (redirect URI http://localhost:8787/auth/callback), ALLOWED_EMAILS
bun run dev         # wrangler dev on http://localhost:8787 (keeps the request origin local despite the custom-domain route; OAuth needs it)
bun run test        # vitest with real R2/KV in Miniflare
bun run typecheck
bun run build       # wrangler deploy --dry-run
bun run types       # regenerate worker-configuration.d.ts after changing wrangler.jsonc
```
