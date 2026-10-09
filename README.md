# Artifacts

A self-hosted take on Claude Artifacts for Cloudflare Workers. Agents create and update artifacts over MCP; you view, version, share and manage them in the browser.

- **Types:** HTML, React (JSX/TSX with Tailwind and npm imports via esm.sh), SVG, Mermaid, Markdown, code.
- **Viewer:** Preview/Code tabs, version history, copy, download, open in a new tab, edit, remix a shared artifact.
- **Auth:** Google sign-in restricted to an email allowlist; personal API tokens for agents.
- **Share:** public read-only links, revocable at any time.
- **Retention:** artifacts expire 30 days after their last content change. Make one permanent, set it back to expiring, or delete it. A daily cron (03:00 UTC) removes expired artifacts.
- **MCP:** a stateless Streamable HTTP endpoint at `/mcp` with tools to list, get, create, update, delete, share and set retention.

Storage: R2 holds artifact metadata and every version; KV holds the per-user index, share links, users and API tokens. See [docs/design.md](docs/design.md) for the full contract.

## Deploy

Requirements: [bun](https://bun.sh) and a Cloudflare account.

```sh
bun install
bunx wrangler login

bunx wrangler r2 bucket create artifacts
bunx wrangler kv namespace create KV     # put the printed id into wrangler.jsonc (kv_namespaces[0].id)
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
- KV is eventually consistent: the artifact list can lag for up to about a minute in other locations, and a revoked token can keep working there for about a minute. Share revocation is immediate.
- Rendering loads React, Babel, Tailwind, Mermaid, marked and highlight.js from public CDNs (jsDelivr, esm.sh) at pinned versions; npm packages that React artifacts import resolve from esm.sh at view time.

## Develop

```sh
cp .dev.vars.example .dev.vars   # set SESSION_SECRET, GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET (redirect URI http://localhost:8787/auth/callback), ALLOWED_EMAILS
bunx wrangler dev

bun run test        # vitest with real R2/KV in Miniflare
bun run typecheck
bun run build       # wrangler deploy --dry-run
bun run types       # regenerate worker-configuration.d.ts after changing wrangler.jsonc
```
