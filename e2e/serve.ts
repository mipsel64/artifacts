import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { origin, ownerEmail, sessionSecret } from './settings';

const project = fileURLToPath(new URL('..', import.meta.url));
const address = new URL(origin);
const secret = sessionSecret();
const temp = await mkdtemp(join(tmpdir(), 'artifacts-e2e-'));
const publicSource = join(project, 'public');
const publicDir = join(temp, 'public');

try {
  // Build into this copy, never into the regular dev server's assets.
  const buildSource = join(publicSource, 'static', 'build');
  await cp(publicSource, publicDir, {
    recursive: true,
    filter: source => source !== buildSource,
  });

  // Keep the config outside the checkout so Wrangler cannot load project .dev.vars.
  const config = join(temp, 'wrangler.json');
  await writeFile(config, JSON.stringify({
    name: 'artifacts-browser-test',
    main: join(project, 'src/index.ts'),
    compatibility_date: '2026-10-09',
    compatibility_flags: ['nodejs_compat'],
    rules: [{ type: 'Text', globs: ['**/themes/claude/*.css'], fallthrough: true }],
    build: { command: 'bun run archify:build && bun run client:build', cwd: project, watch_dir: relative(temp, join(project, 'src')) },
    assets: { directory: publicDir },
    r2_buckets: [{ binding: 'BUCKET', bucket_name: 'browser-test' }],
    kv_namespaces: [
      { binding: 'KV', id: '00000000000000000000000000000001' },
      { binding: 'OAUTH_KV', id: '00000000000000000000000000000002' },
    ],
    vars: {
      SESSION_SECRET: secret,
      ALLOWED_EMAILS: ownerEmail,
      // The real login route fails locally when no Google OAuth client is configured.
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
    },
  }), { mode: 0o600 });

  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(CLOUDFLARE_|WRANGLER_|CF_)/i.test(name)));

  const worker = Bun.spawn([
    'node', join(project, 'node_modules/wrangler/bin/wrangler.js'),
    'dev', '--config', config, '--local', '--ip', address.hostname, '--port', address.port,
    '--local-upstream', address.host, '--upstream-protocol', 'http', '--persist-to', join(temp, 'state'),
    '--tsconfig', join(project, 'tsconfig.json'), '--inspector-port', '0', '--show-interactive-dev-session=false',
  ], {
    cwd: project,
    env: {
      ...env,
      ARTIFACTS_CLIENT_PUBLIC_DIR: publicDir,
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
      CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
      WRANGLER_SEND_METRICS: 'false',
    },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const stop = () => worker.kill();
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  process.exitCode = await worker.exited;
} finally {
  await rm(temp, { recursive: true, force: true });
}
