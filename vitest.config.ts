import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          SESSION_SECRET: 'test-session-secret-0123456789abcdef0123456789',
          GOOGLE_CLIENT_ID: 'test-client',
          GOOGLE_CLIENT_SECRET: 'test-secret',
          ALLOWED_EMAILS: 'alice@example.com,bob@example.com',
        },
      },
    }),
  ],
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
  },
});
