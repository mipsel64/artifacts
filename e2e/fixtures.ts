import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test as base, type BrowserContext } from '@playwright/test';
import type { SessionUser } from '../src/types';
import { origin, ownerEmail } from './settings';

const exec = promisify(execFile);
const signer = fileURLToPath(new URL('./mint-session.ts', import.meta.url));

export async function installSession(context: BrowserContext, user: SessionUser) {
  // Bun loads the Worker's JSON imports; Playwright's Node runner need not load the Worker graph.
  const { stdout } = await exec('bun', [signer, user.id, user.email], { timeout: 10_000 });
  const [pair] = stdout.trim().split(';', 1);
  const separator = pair.indexOf('=');
  await context.addCookies([{
    name: pair.slice(0, separator),
    value: pair.slice(separator + 1),
    // Install a host-only Secure cookie; Chromium treats loopback HTTP as trustworthy.
    url: origin.replace('http:', 'https:') + '/',
    httpOnly: true,
    sameSite: 'Lax',
  }]);
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      return route.abort();
    });
    await installSession(context, { id: `google_fixture_${randomUUID()}`, email: ownerEmail });
    await use(context);
  },
});
