// OAuthProvider injects its helpers into the env of the default handler (the Hono app).
declare namespace Cloudflare {
  interface Env {
    OAUTH_PROVIDER?: import('@cloudflare/workers-oauth-provider').OAuthHelpers;
  }
}
