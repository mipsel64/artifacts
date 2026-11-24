import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const output = join(process.env.ARTIFACTS_CLIENT_PUBLIC_DIR ?? 'public', 'static', 'build');

// wrangler uploads every file in public/, so outputs from older builds must not stay behind.
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

await Promise.all([
  build({
    entryPoints: ['src/ui/app/client.tsx'],
    outfile: join(output, 'client.js'),
    bundle: true,
    format: 'esm',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    // app.css loads the registry's stylesheets in cascade order for the server and client.
    loader: { '.css': 'empty' },
  }),
  build({
    entryPoints: ['src/ui/app/app.css'],
    outfile: join(output, 'app.css'),
    bundle: true,
    minify: true,
    external: ['/static/fonts/*'],
  }),
]);
