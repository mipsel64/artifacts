import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

const REPO = 'https://github.com/tt-a1i/archify';
const TAG = 'v3.2.0';
const PINNED_COMMIT = '208acba8d412335185b2056fedf54b3405df43fb';
const TYPES = [
  'architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle',
  'erd', 'class', 'tree', 'timeline', 'waterfall', 'explainer',
];
const ROOT = resolve(import.meta.dir, '..');
const sourcePin = readFileSync(join(ROOT, 'vendor', 'archify', 'SOURCE'), 'utf8');
const recordedCommit = /^commit: ([a-f0-9]{40})$/m.exec(sourcePin)?.[1] ?? PINNED_COMMIT;
const recordedTag = /^tag: (.+)$/m.exec(sourcePin)?.[1] ?? 'none';
const ref = process.argv[2] ?? recordedCommit;
const temp = mkdtempSync(join(tmpdir(), 'archify-sync-'));
// Staged in the repository so the final rename stays on one file system.
const stage = mkdtempSync(join(ROOT, '.archify-sync-'));
function resolveCommit(value: string): string {
  if (/^[a-f0-9]{40}$/i.test(value)) return value;
  const output = execFileSync('git', ['ls-remote', REPO, value, `${value}^{}`], { encoding: 'utf8' });
  const rows = output.trim().split('\n').filter(Boolean).map((line) => line.split(/\s+/));
  const commit = rows.find(([, name]) => name.endsWith('^{}'))?.[0] ?? rows[0]?.[0];
  if (!commit) throw new Error(`Could not resolve Archify ref ${value}.`);
  return commit;
}

function sourceTag(): string {
  if (/^v\d/.test(ref)) return ref;
  if (ref === recordedCommit) return recordedTag;
  if (ref === PINNED_COMMIT) return TAG;
  return 'none';
}

async function main() {
  const commit = resolveCommit(ref);
  const archive = join(temp, 'archify.tar.gz');
  const response = await fetch(`https://codeload.github.com/tt-a1i/archify/tar.gz/${commit}`);
  if (!response.ok) throw new Error(`Archify download failed: ${response.status} ${response.statusText}`);
  await Bun.write(archive, response);
  execFileSync('tar', ['-xzf', archive, '-C', temp], { stdio: 'inherit' });
  const archiveRoot = readdirSync(temp, { withFileTypes: true }).find((entry) => entry.isDirectory());
  if (!archiveRoot) throw new Error('Archify archive had no source directory.');
  const source = join(temp, archiveRoot.name, 'archify');
  const files = new Set<string>(['LICENSE', 'THIRD_PARTY_NOTICES.md', 'package.json']);
  const pending = [
    ...TYPES.map((type) => `renderers/${type}/render-${type}.mjs`),
    'scripts/check-render-output.mjs',
  ];
  const importPattern = /(?:import|export)\b\s*(?:[^'"]*?from\s*)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  while (pending.length) {
    const path = pending.pop()!;
    if (files.has(path)) continue;
    const absolute = join(source, path);
    const text = readFileSync(absolute, 'utf8');
    files.add(path);
    for (const match of text.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2];
      if (!specifier?.startsWith('.')) continue;
      const dependency = relative('.', resolve(dirname(path), specifier));
      pending.push(dependency);
    }
  }

  const runtimeFiles = [
    'assets/template.html',
    'brand-marks/catalog.json',
    'explainer/reader.js',
    'explainer/reader.css',
  ];
  for (const path of runtimeFiles) files.add(path);
  for (const entry of await Array.fromAsync(new Bun.Glob('locales/*.json').scan({ cwd: source })).then((paths) => paths.sort())) {
    files.add(entry);
  }

  const vendor = join(ROOT, 'vendor', 'archify');
  const stagedVendor = join(stage, 'vendor');
  for (const path of [...files].sort()) {
    await Bun.write(join(stagedVendor, path), Bun.file(join(source, path)));
  }
  await Bun.write(join(stagedVendor, 'SOURCE'), `repo: ${REPO}\ntag: ${sourceTag()}\ncommit: ${commit}\n`);
  const references = join(ROOT, 'skills', 'artifacts', 'references', 'archify');
  const stagedReferences = join(stage, 'references');
  // A nested SKILL.md would be discovered as a second skill by recursive skill loaders.
  const skillFiles = [
    'schemas/README.md',
    'references/authoring-defaults.md',
    'references/authoring-contract.md',
    'references/architecture-layout-repair.md',
    'references/explainer-authoring.md',
    'references/brand-marks.md',
    'references/viewer-runtime.md',
    'references/repository-authoring.md',
    'references/delivery-contract.md',
  ];
  for (const entry of await Array.fromAsync(new Bun.Glob('schemas/*.json').scan({ cwd: source })).then((paths) => paths.sort())) {
    skillFiles.push(entry);
  }
  for (const entry of await Array.fromAsync(new Bun.Glob('examples/*.json').scan({ cwd: source })).then((paths) => paths.sort())) {
    skillFiles.push(entry);
  }
  for (const entry of await Array.fromAsync(new Bun.Glob('renderers/*/README.md').scan({ cwd: source })).then((paths) => paths.sort())) {
    skillFiles.push(entry);
  }
  for (const path of skillFiles.sort()) {
    await Bun.write(join(stagedReferences, path), Bun.file(join(source, path)));
  }
  rmSync(vendor, { recursive: true, force: true });
  renameSync(stagedVendor, vendor);
  rmSync(references, { recursive: true, force: true });
  renameSync(stagedReferences, references);
  console.log(`Synced ${files.size} render files and ${skillFiles.length} skill files from ${ref}.`);
}

try {
  await main();
} finally {
  rmSync(temp, { recursive: true, force: true });
  rmSync(stage, { recursive: true, force: true });
}
