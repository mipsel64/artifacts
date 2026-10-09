// Secrets are not in wrangler.jsonc, so `wrangler types` cannot see them.
declare namespace Cloudflare {
  interface Env {
    SESSION_SECRET: string;
    GOOGLE_CLIENT_SECRET: string;
  }
}
interface Env extends Cloudflare.Env {}
