import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const VENDOR = join(ROOT, 'vendor', 'archify');
const TYPES = [
  'architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle',
  'erd', 'class', 'tree', 'timeline', 'waterfall', 'explainer',
];
const RUNTIME_FILES = [
  'assets/template.html',
  'brand-marks/catalog.json',
  'explainer/reader.js',
  'explainer/reader.css',
  ...await Array.fromAsync(new Bun.Glob('locales/*.json').scan({ cwd: VENDOR })).then((paths) => paths.sort()),
];
const entries = Object.fromEntries([
  ...TYPES.map((type) => [
    `/archify/renderers/${type}/render-${type}.mjs`,
    `./vendor/archify/renderers/${type}/render-${type}.mjs`,
  ]),
  ['/archify/scripts/check-render-output.mjs', './vendor/archify/scripts/check-render-output.mjs'],
] as const);
const source = `
const entries = {
${Object.entries(entries).map(([path, request]) => `  ${JSON.stringify(path)}: () => import(${JSON.stringify(request)}),`).join('\n')}
};
const runtimeFiles = ${JSON.stringify(Object.fromEntries(RUNTIME_FILES.map((path) => [
  `/archify/${path}`,
  readFileSync(join(VENDOR, path), 'utf8'),
])))};
async function run(scriptPath, argv) {
  const load = entries[scriptPath];
  if (!load) throw new Error('Unsupported Archify script: ' + scriptPath);
  __archifyHost.process.argv = [__archifyHost.process.execPath, scriptPath, ...argv];
  await load();
}
export { run, runtimeFiles };
`;

const builtins = new Set([
  'fs', 'path', 'url', 'crypto', 'zlib', 'util', 'buffer', 'os', 'process',
  'child_process', 'dns/promises', 'http', 'https', 'net', 'timers/promises',
]);
const exportsByModule: Record<string, string[]> = {
  crypto: ['createHash', 'randomUUID', 'randomBytes'],
  url: ['fileURLToPath'],
  zlib: ['gzipSync', 'gunzipSync'],
  util: ['promisify'],
  buffer: ['Buffer'],
  child_process: ['execFile', 'spawnSync'],
  'dns/promises': ['lookup'],
  'timers/promises': ['setTimeout'],
};

const result = await build({
  stdin: { contents: source, resolveDir: ROOT, sourcefile: 'archify-entry.js', loader: 'js' },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  minify: false,
  define: {
    process: '__archifyHost.process',
    console: '__archifyHost.console',
    Buffer: '__archifyHost.buffer.Buffer',
  },
  plugins: [
    {
      name: 'archify-host-builtins',
      setup(build) {
        build.onResolve({ filter: /^(?:node:)?[a-z_/]+$/ }, (args) => {
          const name = args.path.replace(/^node:/, '');
          if (!builtins.has(name)) return null;
          return { path: name, namespace: 'archify-host' };
        });
        build.onLoad({ filter: /.*/, namespace: 'archify-host' }, (args) => {
          const host = `__archifyHost[${JSON.stringify(args.path)}]`;
          const named = exportsByModule[args.path] ?? [];
          return {
            loader: 'js',
            contents: [
              `const value = ${host};`,
              'export default value;',
              ...named.map((name) => `export const ${name} = value.${name};`),
            ].join('\n'),
          };
        });
      },
    },
    {
      name: 'archify-import-meta',
      setup(build) {
        build.onLoad({ filter: /\.mjs$/ }, (args) => {
          if (!args.path.startsWith(VENDOR)) return null;
          const url = `file:///archify/${relative(VENDOR, args.path).replaceAll('\\', '/')}`;
          return {
            loader: 'js',
            contents: readFileSync(args.path, 'utf8').replaceAll('import.meta.url', JSON.stringify(url)),
          };
        });
      },
    },
  ],
});

const bundled = result.outputFiles[0].text.replace(/export\s*\{\s*run,\s*runtimeFiles\s*\};?\s*$/, '');
const output = `export function instantiate(__archifyHost) {\n${bundled}\nreturn { run, runtimeFiles };\n}\n`;
const target = join(ROOT, 'src', 'archify', 'engine.gen.js');
const unchanged = await Bun.file(target).text().then((text) => text === output, () => false);
if (!unchanged) await Bun.write(target, output);
console.log(`${unchanged ? 'Unchanged' : 'Built'} src/archify/engine.gen.js (${Buffer.byteLength(output)} bytes).`);
