import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { origin } from './settings';

process.env.ARTIFACTS_E2E_SESSION_SECRET ??= randomBytes(32).toString('hex');

export default defineConfig({
  testDir: '.',
  outputDir: './test-results',
  workers: 1,
  use: {
    browserName: 'chromium',
    baseURL: origin,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'bun e2e/serve.ts',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: `${origin}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
  },
});
