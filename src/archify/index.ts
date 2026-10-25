/// <reference types="node" />
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { format, promisify } from 'node:util';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createFsFromVolume, Volume } from 'memfs';
import archifyPackage from '../../vendor/archify/package.json';
import type * as Engine from './engine.gen.js';

export const ARCHIFY_VERSION = archifyPackage.version;
export const ARCHIFY_OUTPUT_LIMIT = 10 * 1024 * 1024;

export function archifyContentIsJson(content: string): boolean {
  return content.trimStart().startsWith('{');
}

export function archifyCacheKey(versionKey: string): string {
  return `${versionKey}.html`;
}

export interface ArchifyDiagnostic {
  code: string;
  severity: string;
  message: string;
  pointer?: string;
  fixes?: string[];
  subject?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  supportedFixes?: string[];
  [key: string]: unknown;
}

export class ArchifyError extends Error {
  readonly diagnostics: ArchifyDiagnostic[];

  constructor(message: string, diagnostics: ArchifyDiagnostic[]) {
    super(message);
    this.name = 'ArchifyError';
    this.diagnostics = diagnostics;
  }
}

const DIAGRAM_TYPES = [
  'architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle',
  'erd', 'class', 'tree', 'timeline', 'waterfall', 'explainer',
] as const;
type DiagramType = typeof DIAGRAM_TYPES[number];

interface Listener {
  callback: (...args: unknown[]) => void;
  once: boolean;
}

interface Capture {
  stdout: string;
  stderr: string;
}

interface RunResult extends Capture {
  status: number;
  error?: unknown;
}

interface HostContext {
  capture: Capture;
  listeners: Map<string, Listener[]>;
  process: { exitCode: number };
  host: unknown;
}
const checkReceipts = new WeakMap<Volume, Map<string, RunResult>>();

class ExitSignal {
  constructor(readonly code: number) {}
}

let engineModule: Promise<typeof Engine> | undefined;
let renderQueue: Promise<void> = Promise.resolve();

function loadEngine() {
  engineModule ??= import('./engine.gen.js');
  return engineModule;
}

function diagnostic(code: string, message: string, fixes: string[] = []): ArchifyDiagnostic {
  return { code, severity: 'error', message, fixes, supportedFixes: fixes };
}

function normalizeDiagnostic(value: unknown): ArchifyDiagnostic {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const subject = raw.subject && typeof raw.subject === 'object' && !Array.isArray(raw.subject)
    ? raw.subject as Record<string, unknown>
    : undefined;
  const supportedFixes = Array.isArray(raw.supportedFixes) ? raw.supportedFixes.map(String) : undefined;
  let pointer: string | undefined;
  if (typeof raw.pointer === 'string') pointer = raw.pointer;
  else if (typeof subject?.path === 'string') pointer = subject.path;
  return {
    ...raw,
    code: String(raw.code ?? 'internal/unclassified'),
    severity: String(raw.severity ?? 'error'),
    message: String(raw.message ?? 'Archify could not classify this failure.'),
    ...(pointer ? { pointer } : {}),
    ...(supportedFixes ? { fixes: supportedFixes, supportedFixes } : {}),
  };
}

function diagnosticsFrom(value: unknown): ArchifyDiagnostic[] {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const diagnostics = record.diagnostics ?? record.archifyDiagnostics;
  return Array.isArray(diagnostics) ? diagnostics.map(normalizeDiagnostic) : [];
}

function parseReceipt(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {}
  for (const line of trimmed.split('\n').reverse()) {
    try {
      return JSON.parse(line);
    } catch {}
  }
  return undefined;
}

function failure(error: unknown, result: RunResult): ArchifyError {
  const receipt = diagnosticsFrom(parseReceipt(result.stderr))
    .concat(diagnosticsFrom(parseReceipt(result.stdout)));
  const attached = diagnosticsFrom(error);
  const diagnostics = receipt.length ? receipt : attached;
  const message = error instanceof Error ? error.message : 'Archify rendering failed.';
  return new ArchifyError(message, diagnostics.length ? diagnostics : [
    diagnostic('archify-render', message || `Renderer exited with status ${result.status}.`),
  ]);
}

export function formatArchifyDiagnostics(diagnostics: ArchifyDiagnostic[]): string {
  const visible = diagnostics.slice(0, 20).map((entry) => {
    const clean = (value: string) => value.replaceAll(/\s+/g, ' ').trim();
    const pointer = entry.pointer ? ` at ${clean(entry.pointer)}` : '';
    const fixes = entry.fixes?.length ? ` Fix: ${clean(entry.fixes.join('; '))}` : '';
    const severity = entry.severity === 'error' ? '' : `${clean(entry.severity)} `;
    return `[${severity}${clean(entry.code)}] ${clean(entry.message)}${pointer}${fixes}`;
  });
  if (diagnostics.length > visible.length) visible.push(`… ${diagnostics.length - visible.length} more`);
  return visible.join('\n');
}

function unsupportedNetwork(): Error {
  return new Error('Network access is not supported in Artifacts. Use a built-in brand mark or remove remote evidence.');
}

function makeHost(
  volume: Volume,
  quality: string,
  environment: Record<string, string> = { ARCHIFY_DIAGNOSTIC_FORMAT: 'json', ARCHIFY_QUALITY_PROFILE: quality },
  workingDirectory = '/work',
) {
  const capture: Capture = { stdout: '', stderr: '' };
  const listeners = new Map<string, Listener[]>();
  const baseFs = createFsFromVolume(volume);
  const fs = Object.create(baseFs) as typeof baseFs;
  fs.writeSync = ((fd: number, data: string | ArrayBufferView, ...args: unknown[]) => {
    if (fd !== 1 && fd !== 2) return baseFs.writeSync(fd, data as never, ...(args as []));
    let bytes: Buffer;
    if (typeof data === 'string') {
      bytes = Buffer.from(data, typeof args[1] === 'string' ? args[1] as BufferEncoding : 'utf8');
    } else {
      const offset = typeof args[0] === 'number' ? args[0] : 0;
      const length = typeof args[1] === 'number' ? args[1] : data.byteLength - offset;
      bytes = Buffer.from(data.buffer, data.byteOffset + offset, length);
    }
    if (fd === 1) capture.stdout += bytes.toString('utf8');
    else capture.stderr += bytes.toString('utf8');
    return bytes.byteLength;
  }) as typeof fs.writeSync;

  const stream = (fd: 1 | 2) => ({
    fd,
    write(data: string | Uint8Array, callback?: () => void) {
      const text = typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
      if (fd === 1) capture.stdout += text;
      else capture.stderr += text;
      callback?.();
      return true;
    },
    on() { return this; },
    once() { return this; },
  });
  const process = {
    argv: ['/archify/node'],
    env: environment,
    exitCode: 0,
    exit(code = 0): never { throw new ExitSignal(Number(code)); },
    on(event: string, callback: (...args: unknown[]) => void) {
      const entries = listeners.get(event) ?? [];
      entries.push({ callback, once: false });
      listeners.set(event, entries);
      return this;
    },
    once(event: string, callback: (...args: unknown[]) => void) {
      const entries = listeners.get(event) ?? [];
      entries.push({ callback, once: true });
      listeners.set(event, entries);
      return this;
    },
    nextTick(callback: (...args: unknown[]) => void, ...args: unknown[]) {
      queueMicrotask(() => callback(...args));
    },
    cwd: () => workingDirectory,
    platform: 'linux',
    pid: 1,
    execPath: '/archify/node',
    stdout: stream(1),
    stderr: stream(2),
  };
  const console = Object.fromEntries(['log', 'info', 'debug', 'warn', 'error'].map((method) => [
    method,
    (...args: unknown[]) => {
      const text = `${format(...args)}\n`;
      if (method === 'warn' || method === 'error') capture.stderr += text;
      else capture.stdout += text;
    },
  ]));
  const execFile = Object.assign(
    () => { throw new Error('Archify child processes require promisify(execFile).'); },
    {
      [promisify.custom]: async (file: string, args: string[], options: Record<string, unknown>) => {
        const result = await runNested(volume, quality, file, args, options, process.execPath);
        if (args[0] === '/archify/scripts/check-render-output.mjs') {
          try {
            const digest = crypto.createHash('sha256').update(volume.readFileSync(args[1])).digest('hex');
            let receipts = checkReceipts.get(volume);
            if (!receipts) {
              receipts = new Map();
              checkReceipts.set(volume, receipts);
            }
            receipts.set(digest, result);
          } catch {}
        }
        if (result.status !== 0) {
          throw Object.assign(result.error instanceof Error ? result.error : new Error(`Archify child exited with status ${result.status}.`), {
            code: result.status,
            stdout: result.stdout,
            stderr: result.stderr,
          });
        }
        return { stdout: result.stdout, stderr: result.stderr };
      },
    },
  );
  const spawnSync = (file: string, args: string[]) => {
    if (file === process.execPath && args[0] === '/archify/scripts/check-render-output.mjs') {
      try {
        const digest = crypto.createHash('sha256').update(volume.readFileSync(args[1])).digest('hex');
        const cached = checkReceipts.get(volume)?.get(digest);
        if (cached) return { status: cached.status, stdout: cached.stdout, stderr: cached.stderr };
      } catch {}
    }
    const error = new Error(`Child process ${JSON.stringify(file)} is not supported in Artifacts. Repository verification requires --repo-root and is unavailable.`);
    return { error, status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(error.message) };
  };
  return {
    capture,
    listeners,
    process,
    host: {
      fs,
      path,
      crypto,
      url: { fileURLToPath },
      zlib: { gzipSync, gunzipSync },
      util: { promisify },
      buffer: { Buffer },
      os: { tmpdir: () => '/tmp' },
      process,
      console,
      child_process: { execFile, spawnSync },
      'dns/promises': { lookup: async () => { throw unsupportedNetwork(); } },
      http: { request: () => { throw unsupportedNetwork(); } },
      https: { request: () => { throw unsupportedNetwork(); } },
      net: { isIP: () => { throw unsupportedNetwork(); } },
      'timers/promises': { setTimeout: delay },
    },
  };
}

async function invokeErrorListeners(context: HostContext, error: unknown) {
  for (const event of ['uncaughtException', 'unhandledRejection']) {
    const entries = context.listeners.get(event) ?? [];
    if (!entries.length) continue;
    context.listeners.set(event, entries.filter((entry) => !entry.once));
    for (const entry of entries) entry.callback(error);
    return;
  }
  throw error;
}

async function runNested(
  volume: Volume,
  quality: string,
  file: string,
  args: string[],
  options: Record<string, unknown> = {},
  expectedExecPath?: string,
  prepare?: (instance: Engine.ArchifyEngineInstance) => void,
): Promise<RunResult> {
  if (expectedExecPath && file !== expectedExecPath) {
    return { status: 1, stdout: '', stderr: '', error: new Error(`Child process ${JSON.stringify(file)} is not supported in Artifacts.`) };
  }
  const scriptPath = args[0];
  const context = makeHost(
    volume,
    quality,
    (options.env as Record<string, string> | undefined) ?? { ARCHIFY_DIAGNOSTIC_FORMAT: 'json', ARCHIFY_QUALITY_PROFILE: quality },
    typeof options.cwd === 'string' ? options.cwd : '/work',
  );
  try {
    Reflect.deleteProperty(globalThis, Symbol.for('archify.renderer-diagnostic-boundary'));
    const { instantiate } = await loadEngine();
    const instance = instantiate(context.host);
    prepare?.(instance);
    await instance.run(scriptPath, args.slice(1));
    return { ...context.capture, status: Number(context.process.exitCode) };
  } catch (error) {
    if (error instanceof ExitSignal) return { ...context.capture, status: error.code };
    try {
      await invokeErrorListeners(context, error);
      return { ...context.capture, status: Number(context.process.exitCode) || 1, error };
    } catch (listenerError) {
      if (listenerError instanceof ExitSignal) return { ...context.capture, status: listenerError.code || 1, error };
      return { ...context.capture, status: 1, error: listenerError };
    }
  }
}

function withVirtualOutput(candidate: Record<string, unknown>): Record<string, unknown> {
  const meta = candidate.meta;
  if (meta !== undefined && (!meta || typeof meta !== 'object' || Array.isArray(meta))) return candidate;
  return { ...candidate, meta: { ...(meta as Record<string, unknown> | undefined), output: 'output.html' } };
}

function explainerNeedsVirtualOutputs(candidate: Record<string, unknown>): boolean {
  if ((candidate.meta as Record<string, unknown> | undefined)?.output === undefined) return true;
  const panels = Array.isArray(candidate.panels) ? candidate.panels : [];
  const blocks = Array.isArray(candidate.blocks) ? [...candidate.blocks] : [];
  for (const panel of panels) {
    if (panel && typeof panel === 'object' && !Array.isArray(panel) && Array.isArray((panel as Record<string, unknown>).blocks)) {
      blocks.push(...(panel as Record<string, unknown>).blocks as unknown[]);
    }
  }
  return blocks.some((block) => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return false;
    const spec = (block as Record<string, unknown>).spec;
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return false;
    return ((spec as Record<string, unknown>).meta as Record<string, unknown> | undefined)?.output === undefined;
  });
}

function withVirtualOutputs(candidate: Record<string, unknown>): Record<string, unknown> {
  const prepared = withVirtualOutput(candidate);
  const prepareBlock = (block: unknown) => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return block;
    const value = block as Record<string, unknown>;
    const spec = value.spec;
    const nestedType = value.diagramType;
    if (value.type !== 'diagram' || !spec || typeof spec !== 'object' || Array.isArray(spec)) return block;
    if (typeof nestedType !== 'string' || !DIAGRAM_TYPES.includes(nestedType as DiagramType)) return block;
    return { ...value, spec: withVirtualOutput(spec as Record<string, unknown>) };
  };
  const panels = Array.isArray(candidate.panels)
    ? candidate.panels.map((panel) => {
        if (!panel || typeof panel !== 'object' || Array.isArray(panel)) return panel;
        const value = panel as Record<string, unknown>;
        return Array.isArray(value.blocks) ? { ...value, blocks: value.blocks.map(prepareBlock) } : panel;
      })
    : candidate.panels;
  const blocks = Array.isArray(candidate.blocks) ? candidate.blocks.map(prepareBlock) : candidate.blocks;
  return { ...prepared, panels, blocks };
}

function markdownQualityProfile(source: string): string | undefined {
  let fence: string | undefined;
  let profile: string | undefined;
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (fence) {
      if (trimmed === fence) fence = undefined;
      continue;
    }
    const opening = trimmed.match(/^(`{3,}|~{3,})/);
    if (opening) {
      fence = opening[1];
      continue;
    }
    if (!/^@meta(?:\s|$)/.test(trimmed)) continue;
    const match = trimmed.match(/\squality_profile=(?:"([^"]*)"|'([^']*)'|(\S+))/);
    if (match) profile = match[1] ?? match[2] ?? match[3];
  }
  return profile;
}

// Upstream finalize takes --quality (default showcase) and its skill passes the authored profile; here the candidate is the only input.
function authoredQuality(source: string, candidate: Record<string, unknown> | undefined): string {
  let profile: unknown;
  if (candidate) {
    const meta = candidate.meta;
    profile = meta && typeof meta === 'object' ? (meta as Record<string, unknown>).quality_profile : undefined;
  } else {
    profile = markdownQualityProfile(source);
  }
  if (profile === 'standard' || profile === 'showcase') return profile;
  return 'showcase';
}

function outputCheckDiagnostics(value: unknown): ArchifyDiagnostic[] {
  const direct = diagnosticsFrom(value);
  if (direct.length) return direct;
  if (!value || typeof value !== 'object') return [];
  const receipt = value as Record<string, unknown>;
  const entries: ArchifyDiagnostic[] = [];
  if (Array.isArray(receipt.checks)) {
    for (const raw of receipt.checks) {
      if (!raw || typeof raw !== 'object') continue;
      const check = raw as Record<string, unknown>;
      if (check.ok !== false) continue;
      const details = Array.isArray(check.details) && check.details.length
        ? check.details
        : [`Native check ${String(check.name)} failed.`];
      for (const detail of details) {
        entries.push(normalizeDiagnostic({
          code: `check/${String(check.name)}`,
          severity: 'error',
          message: String(detail),
          evidence: check,
        }));
      }
    }
  }
  const composition = receipt.composition;
  if (!entries.length && composition && typeof composition === 'object' && Array.isArray((composition as Record<string, unknown>).issues)) {
    for (const raw of (composition as Record<string, unknown>).issues as unknown[]) {
      if (!raw || typeof raw !== 'object') continue;
      const issue = raw as Record<string, unknown>;
      if (issue.severity !== 'error') continue;
      let message = typeof issue.detail === 'string' ? issue.detail : `Native quality check ${String(issue.code)} failed.`;
      if (issue.code === 'composition/desktop-readability' && typeof issue.projectedFontPx === 'number') {
        const owner = issue.owner && typeof issue.owner === 'object' ? issue.owner as Record<string, unknown> : {};
        message = `Text "${String(issue.text)}" on ${String(owner.kind || 'element')} ${String(owner.id || '')} would show at ${issue.projectedFontPx.toFixed(1)}px, below ${String(issue.minimumProjectedFontPx)}px: the diagram is ${Math.round(Number(issue.viewBoxWidth))}px wide and shrinks to ${Math.round(Number(issue.scale) * 100)}% on the page. Make it narrower: at most four or five nodes per row, shorter node labels, or phases.`;
      }
      entries.push(normalizeDiagnostic({ ...issue, message }));
    }
  }
  return entries;
}

async function checkOutput(volume: Volume, quality: string, outputPath: string): Promise<void> {
  const result = await runNested(volume, quality, '/archify/node', [
    '/archify/scripts/check-render-output.mjs',
    outputPath,
  ]);
  const receipt = parseReceipt(result.stdout);
  if (result.error || result.status !== 0) {
    const diagnostics = outputCheckDiagnostics(receipt);
    if (diagnostics.length) throw new ArchifyError('Archify output validation failed.', diagnostics);
    const message = result.error instanceof Error ? result.error.message : `Archify checker exited with status ${result.status}.`;
    throw new ArchifyError(message, [diagnostic('archify-check', message)]);
  }
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new ArchifyError('Archify checker returned no structured receipt.', [
      diagnostic('archify-check-receipt', 'Archify checker returned no structured receipt.'),
    ]);
  }
  if ((receipt as Record<string, unknown>).ok === false) {
    const diagnostics = outputCheckDiagnostics(receipt);
    throw new ArchifyError('Archify output validation failed.', diagnostics.length ? diagnostics : [
      diagnostic('archify-check', 'Archify output validation failed.'),
    ]);
  }
}

async function render(source: string, outputLimitBytes: number): Promise<{ html: string }> {
  const json = archifyContentIsJson(source);
  let renderSource = source;
  let diagramType: DiagramType = 'explainer';
  let candidate: Record<string, unknown> | undefined;
  try {
    if (json) {
      const parsed = JSON.parse(source);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) candidate = parsed as Record<string, unknown>;
      const type = candidate?.diagram_type;
      if (typeof type !== 'string' || !DIAGRAM_TYPES.includes(type as DiagramType)) {
        throw new ArchifyError('Archify candidate has an unknown or missing diagram_type.', [
          diagnostic('archify-diagram-type', `Unknown or missing diagram_type. Allowed types: ${DIAGRAM_TYPES.join(', ')}.`),
        ]);
      }
      diagramType = type as DiagramType;
      if (diagramType !== 'explainer' || explainerNeedsVirtualOutputs(candidate!)) {
        candidate = diagramType === 'explainer' ? withVirtualOutputs(candidate!) : withVirtualOutput(candidate!);
        renderSource = JSON.stringify(candidate);
      }
    }
  } catch (error) {
    if (error instanceof ArchifyError) throw error;
    throw new ArchifyError('Archify candidate is not valid JSON or could not be prepared.', [
      diagnostic('archify-json', error instanceof Error ? error.message : 'Invalid JSON.', ['Provide a valid JSON object.']),
    ]);
  }
  const quality = authoredQuality(source, candidate);
  const volume = new Volume();
  volume.mkdirSync('/tmp', { recursive: true });
  volume.mkdirSync('/work', { recursive: true });
  const inputPath = `/work/input.${json ? 'json' : 'archify.md'}`;
  const outputPath = '/work/output.html';
  const result = await runNested(volume, quality, '/archify/node', [
    `/archify/renderers/${diagramType}/render-${diagramType}.mjs`,
    inputPath,
    outputPath,
  ], {}, undefined, (instance) => {
    volume.fromJSON(instance.runtimeFiles);
    volume.writeFileSync(inputPath, renderSource, { flag: 'wx' });
  });
  if (result.error || result.status !== 0) throw failure(result.error, result);
  const html = volume.readFileSync(outputPath, 'utf8') as string;
  const outputBytes = Buffer.byteLength(html);
  if (outputBytes > outputLimitBytes) {
    const message = `Archify rendered output is ${outputBytes} bytes; the limit is ${outputLimitBytes} bytes. Use fewer or smaller diagrams.`;
    throw new ArchifyError(message, [diagnostic('archify-output-too-large', message, ['Use fewer or smaller diagrams.'])]);
  }
  await checkOutput(volume, quality, outputPath);
  return { html };
}

export function renderArchify(
  source: string,
  options: { outputLimitBytes?: number } = {},
): Promise<{ html: string }> {
  const result = renderQueue.then(() => render(source, options.outputLimitBytes ?? ARCHIFY_OUTPUT_LIMIT));
  renderQueue = result.then(() => undefined, () => undefined);
  return result;
}
