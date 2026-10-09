// Set with `wrangler secret put`, so `wrangler types` cannot see them; kept out of the public config.
declare namespace Cloudflare {
  interface Env {
    SESSION_SECRET: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    ALLOWED_EMAILS: string;
  }
}
interface Env extends Cloudflare.Env {}
