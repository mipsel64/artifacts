import { AuthorizationError, type ConsentDescription, type GrantSummary, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { Hono, type Context } from 'hono';
import { ArtifactError } from '../artifacts';
import { isAllowed, readSession, requireSession } from '../auth';
import type { AppEnv } from '../types';
import { pageHeaders, setPageHeaders } from '../ui/headers';
import { Layout } from '../ui/layout';

export function oauthHelpers(c: Context<AppEnv>): OAuthHelpers {
  if (!c.env.OAUTH_PROVIDER) throw new Error('OAUTH_PROVIDER is not available');
  return c.env.OAUTH_PROVIDER;
}

export async function listGrants(oauth: OAuthHelpers, userId: string): Promise<GrantSummary[]> {
  const grants: GrantSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await oauth.listUserGrants(userId, { cursor });
    grants.push(...page.items);
    cursor = page.cursor;
  } while (cursor);
  return grants;
}

// The browser applies form-action to the redirect that answers the form POST, so the consent page must allow the
// client's redirect target (its origin, or its scheme for a native app) on top of 'self'.
function redirectSource(redirectUri: string): string {
  const url = new URL(redirectUri);
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : url.protocol;
}

function ErrorPage({ message }: { message: string }) {
  return (
    <Layout title="Authorization error" me={null}>
      <h1>Authorization failed</h1>
      <p>{message}</p>
      <p class="muted">Go back to the app and start signing in again.</p>
    </Layout>
  );
}

function ConsentPage({ details, email, handle }: { details: ConsentDescription; email: string; handle: string }) {
  return (
    <Layout title="Authorize" me={null}>
      <form class="form" method="post" action="/authorize">
        <h1>Allow {details.clientName} to access your artifacts?</h1>
        <p>This app registered itself, so its name is not verified.</p>
        <p>
          Access will be sent to <strong>{details.redirectHost}</strong>.
        </p>
        {details.redirectIsLoopback && (
          <p class="alert">
            <strong>This sends access to an app on your computer.</strong> Continue only if you just started signing in from it.
          </p>
        )}
        <p class="muted">
          Signed in as <strong>{email}</strong>. The app can list, read, create, change, share and delete your artifacts until you revoke it in Settings.
        </p>
        <input type="hidden" name="handle" value={handle} />
        <div class="actions">
          <button type="submit" name="decision" value="approve" class="button button-primary">
            Allow
          </button>
          <button type="submit" name="decision" value="deny" class="button">
            Deny
          </button>
        </div>
      </form>
    </Layout>
  );
}

const routes = new Hono<AppEnv>();

routes.get('/authorize', pageHeaders, async (c) => {
  const oauth = oauthHelpers(c);
  try {
    const authRequest = await oauth.parseAuthRequest(c.req.raw);
    // Only the browser session counts here, never an Authorization header.
    const session = await readSession(c.env, c.req.header('Cookie'));
    if (!session || !isAllowed(c.env, session.email)) {
      const url = new URL(c.req.url);
      return c.redirect(`/auth/login?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
    }
    const details = await oauth.describeConsent(authRequest);
    const consent = await oauth.beginConsent(authRequest);
    for (const [name, value] of consent.headers) c.header(name, value, { append: name === 'set-cookie' });
    setPageHeaders(c, `'self' ${redirectSource(details.redirectUri)}`);
    return c.html(<ConsentPage details={details} email={session.email} handle={consent.handle} />);
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    if (error.redirectTo) return c.redirect(error.redirectTo, 302);
    return c.html(<ErrorPage message={error.description} />, 400);
  }
});

routes.post('/authorize', pageHeaders, requireSession, async (c) => {
  const oauth = oauthHelpers(c);
  const { user } = c.var;
  const form = await c.req.parseBody();
  const handle = typeof form.handle === 'string' ? form.handle : '';
  try {
    if (form.decision !== 'approve') {
      const denied = await oauth.denyConsent(c.req.raw, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await oauth.approveConsent(c.req.raw, handle);
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: user.id,
      metadata: { email: user.email },
      scope: approved.request.scope,
      props: { userId: user.id, email: user.email },
    });
    approved.headers.set('Location', redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    return c.html(<ErrorPage message={error.description} />, 400);
  }
});

routes.delete('/api/grants/:id', requireSession, async (c) => {
  const oauth = oauthHelpers(c);
  const id = c.req.param('id');
  if (!(await listGrants(oauth, c.var.user.id)).some((grant) => grant.id === id)) throw new ArtifactError(404, 'Grant not found');
  await oauth.revokeGrant(id, c.var.user.id);
  return c.body(null, 204);
});

export default routes;
