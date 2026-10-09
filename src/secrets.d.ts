// Secrets are not in wrangler.jsonc, so `wrangler types` cannot see them.
declare namespace Cloudflare {
  interface Env {
    SESSION_SECRET: string;
    GITHUB_CLIENT_SECRET: string;
  }
}
interface Env extends Cloudflare.Env {}
