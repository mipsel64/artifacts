import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';

// wrangler uploads every file in public/, so outputs from older builds must not stay behind.
await rm('public/static/build', { recursive: true, force: true });
await mkdir('public/static/build', { recursive: true });

await Promise.all([
  build({
    entryPoints: ['src/ui/app/client.tsx'],
    outfile: 'public/static/build/client.js',
    bundle: true,
    format: 'esm',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    external: ['/static/fonts/*'],
  }),
  build({
    entryPoints: ['src/ui/app/app.css'],
    outfile: 'public/static/build/app.css',
    bundle: true,
    minify: true,
    external: ['/static/fonts/*'],
  }),
]);
