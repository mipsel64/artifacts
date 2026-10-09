import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { Hono } from 'hono';
import { ArtifactError, sweepExpired } from './artifacts';
import { isAllowed, verifyApiToken } from './auth';
import auth from './routes/auth';
import api from './routes/api';
import { handleMcp, type McpProps } from './routes/mcp';
import oauth from './routes/oauth';
import render from './routes/render';
import ui from './routes/ui';
import type { AppEnv } from './types';

const app = new Hono<AppEnv>();

app.route('/', auth);
app.route('/', api);
app.route('/', oauth);
app.route('/', render);
app.route('/', ui);

app.onError((err, c) => {
  const isJson = c.req.path.startsWith('/api');
  if (err instanceof ArtifactError) {
    return isJson ? c.json({ error: err.message }, err.status) : c.text(err.message, err.status);
  }
  console.error(err);
  return isJson ? c.json({ error: 'Internal Server Error' }, 500) : c.text('Internal Server Error', 500);
});

// `artifacts` is the only scope and gates nothing; `offline_access` is only accepted from clients that ask for it.
const SCOPES = ['artifacts', 'offline_access'];
// Purging does not depend on the origin; the provider only needs a valid one to be constructed.
const PURGE_ORIGIN = 'https://localhost';

// The resource and issuer must match the request origin, so there is one provider per origin (in practice one).
const providers = new Map<string, OAuthProvider<Env>>();

function providerFor(origin: string): OAuthProvider<Env> {
  let provider = providers.get(origin);
  if (!provider) {
    const resource = `${origin}/mcp`;
    provider = new OAuthProvider<Env>({
      apiRoute: '/mcp',
      apiHandler: {
        // SAFETY: the provider sets ctx.props to what resolveExternalToken or completeAuthorization stored, always McpProps.
        fetch: (request, env, ctx) => handleMcp(request, env, (ctx as unknown as ExecutionContext<McpProps>).props),
      },
      defaultHandler: { fetch: (request, env, ctx) => app.fetch(request, env, ctx) },
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/token',
      clientRegistrationEndpoint: '/register',
      scopesSupported: SCOPES,
      requiredScopes: ['artifacts'],
      resourceMetadata: { resource, authorization_servers: [origin] },
      // Called only for bearers that are not OAuth access tokens: the personal `art_` API tokens.
      resolveExternalToken: async ({ token, env }) => {
        if (!token.startsWith('art_')) return null;
        const user = await verifyApiToken(env, token);
        if (!user || !isAllowed(env, user.email)) return null;
        return { props: { userId: user.id, email: user.email } satisfies McpProps, audience: resource };
      },
    });
    providers.set(origin, provider);
  }
  return provider;
}

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => providerFor(new URL(request.url).origin).fetch(request, env, ctx),
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(sweepExpired(env));
    ctx.waitUntil(providerFor(PURGE_ORIGIN).purgeExpiredData(env));
  },
} satisfies ExportedHandler<Env>;
