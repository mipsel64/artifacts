import { describe, expect, it, vi } from 'vitest';
import architecture from '../skills/artifacts/references/archify/examples/web-app.architecture.json';
import workflow from '../skills/artifacts/references/archify/examples/agent-tool-call.workflow.json';
import explainer from '../skills/artifacts/references/archify/examples/delivery.explainer.json';
import dataflow from '../skills/artifacts/references/archify/examples/event-stream.dataflow.json';
import tree from '../skills/artifacts/references/archify/examples/payment-platform.tree.json';
import {
  ArchifyError,
  formatArchifyDiagnostics,
  renderArchify,
} from '../src/archify';

describe('Archify engine', () => {
  it.each([
    ['architecture', architecture],
    ['workflow', workflow],
  ])('renders a valid %s candidate', async (_diagramType, candidate) => {
    const result = await renderArchify(JSON.stringify(candidate));
    expect(result.html).toContain(`<h1>${candidate.meta.title}</h1>`);
    expect(result.html).toMatch(/<svg\b[^>]*data-quality-profile="showcase"[^>]*>[\s\S]*<\/svg>/);
  });

  it('adds the virtual output when the candidate omits meta.output', async () => {
    const candidate = structuredClone(dataflow) as { meta: { output?: string } };
    delete candidate.meta.output;
    const result = await renderArchify(JSON.stringify(candidate));
    expect(result.html).toContain('data-quality-profile="showcase"');
  });

  it('adds virtual outputs to a JSON explainer and its inline native diagrams', async () => {
    const candidate = structuredClone(explainer) as {
      meta: { title: string; output?: string };
      panels: { blocks: unknown[] }[];
    };
    const spec = structuredClone(dataflow) as { meta: { output?: string } };
    delete candidate.meta.output;
    delete spec.meta.output;
    candidate.panels[2].blocks.push({ type: 'diagram', id: 'event-stream', diagramType: 'dataflow', spec });
    const result = await renderArchify(JSON.stringify(candidate));
    expect(result.html).toContain('data-open-diagram="event-stream"');
  });

  it('renders an explainer with an embedded native diagram', async () => {
    const candidate = structuredClone(explainer) as { meta: { title: string }; panels: { blocks: unknown[] }[] };
    candidate.panels[2].blocks.push({
      type: 'diagram',
      id: 'payment-tree',
      diagramType: 'tree',
      spec: tree,
    });
    const result = await renderArchify(JSON.stringify(candidate));
    expect(result.html).toContain(candidate.meta.title);
    expect(result.html).toContain('data-open-diagram="payment-tree"');
    expect(result.html).toMatch(/<svg\b[^>]*data-quality-profile="showcase"[^>]*>[\s\S]*<\/svg>/);
  });

  it('uses the authored JSON quality profile', async () => {
    const candidate = structuredClone(architecture) as { meta: { quality_profile?: string } };
    candidate.meta.quality_profile = 'standard';
    const result = await renderArchify(JSON.stringify(candidate));
    expect(result.html).toMatch(/<svg\b[^>]*data-quality-profile="standard"/);
  });

  it('uses the authored Markdown quality profile, including single quotes', async () => {
    const result = await renderArchify(`# Cache behavior {#cache}\n\nA cache stores values.\n\n@meta locale=en quality_profile='standard'\n\n## What should you check? {#checks}\n\n- Check the cache key.\n\n@sequence id=cache-flow title="Cache flow"\n| actor api | API | backend |\n| actor redis | Redis | database |\n| api | redis | GET order |\n| redis | api | value | return |\n`);
    expect(result.html).toContain('Check the cache key.');
    expect(result.html).toContain('data-quality-profile="standard"');
  });

  it('ignores quality metadata inside a fenced code block', async () => {
    const result = await renderArchify(`# Cache behavior {#cache}\n\nA cache stores values.\n\n@meta locale=en\n\n## What should you check? {#checks}\n\n- Check the cache key.\n\n\`\`\`text\n@meta quality_profile=standard\n\`\`\`\n\n@sequence id=cache-flow title="Cache flow"\n| actor api | API | backend |\n| actor redis | Redis | database |\n| api | redis | GET order |\n| redis | api | value | return |\n`);
    expect(result.html).toContain('data-quality-profile="showcase"');
  });

  it('returns structured schema diagnostics', async () => {
    const candidate = { ...architecture, components: [{ type: 'backend' }] };
    const error = await renderArchify(JSON.stringify(candidate)).catch((cause) => cause);
    expect(error).toBeInstanceOf(ArchifyError);
    expect(error.diagnostics.length).toBeGreaterThan(0);
    expect(error.diagnostics[0]).toMatchObject({
      code: expect.any(String),
      message: expect.any(String),
    });
    expect(formatArchifyDiagnostics(error.diagnostics)).toContain(error.diagnostics[0].code);
  });

  it('rejects invalid JSON with a clear code', async () => {
    await expect(renderArchify('{not json')).rejects.toMatchObject({
      name: 'ArchifyError',
      diagnostics: [expect.objectContaining({ code: 'archify-json' })],
    });
  });

  it('maps candidate preparation failures to archify-json', async () => {
    const source = JSON.stringify(architecture);
    const stringify = vi.spyOn(JSON, 'stringify').mockImplementationOnce(() => {
      throw new RangeError('Maximum call stack size exceeded');
    });
    try {
      await expect(renderArchify(source)).rejects.toMatchObject({
        name: 'ArchifyError',
        diagnostics: [expect.objectContaining({ code: 'archify-json' })],
      });
    } finally {
      stringify.mockRestore();
    }
  });

  it('rejects rendered output above the byte limit', async () => {
    const error = await renderArchify(JSON.stringify(architecture), { outputLimitBytes: 1024 }).catch((cause) => cause);
    expect(error).toBeInstanceOf(ArchifyError);
    expect(error.diagnostics[0].code).toBe('archify-output-too-large');
    expect(error.diagnostics[0].message).toContain('1024');
    expect(error.diagnostics[0].message).toMatch(/fewer or smaller diagrams/i);
  });

  it('rejects native output that fails the upstream strict checker', async () => {
    const candidate = {
      schema_version: 1,
      diagram_type: 'architecture',
      meta: { title: 'Too wide' },
      components: Array.from({ length: 10 }, (_, index) => ({
        id: `n${index}`, type: 'backend', label: `Node ${index}`, pos: [index * 500, 0], size: [120, 60],
      })),
      connections: [],
    };
    const error = await renderArchify(JSON.stringify(candidate)).catch((cause) => cause);
    expect(error).toBeInstanceOf(ArchifyError);
    expect(error.diagnostics.map((entry: { code: string }) => entry.code)).toContain('composition/desktop-readability');
  });

  it('rejects an unknown diagram type with the allowed types', async () => {
    const error = await renderArchify('{"diagram_type":"unknown"}').catch((cause) => cause);
    expect(error).toBeInstanceOf(ArchifyError);
    expect(error.diagnostics[0].code).toBe('archify-diagram-type');
    expect(error.diagnostics[0].message).toContain('architecture');
    expect(error.diagnostics[0].message).toContain('explainer');
  });

  it('formats truncated diagnostics and marks warnings', () => {
    const diagnostics = Array.from({ length: 22 }, (_, index) => ({
      code: `test/${index}`,
      severity: index === 0 ? 'warning' : 'error',
      message: `Diagnostic ${index}`,
    }));
    const formatted = formatArchifyDiagnostics(diagnostics);
    expect(formatted).toContain('[warning test/0]');
    expect(formatted).toContain('[test/1]');
    expect(formatted).toContain('… 2 more');
    expect(formatted.split('\n')).toHaveLength(21);
  });

  it('ignores the authored output path', async () => {
    const candidate = {
      ...architecture,
      meta: { ...architecture.meta, output: '/outside.html' },
    };
    const result = await renderArchify(JSON.stringify(candidate));
    expect(result.html).toContain('<h1>Sample Web App</h1>');
  });

  it('rejects repository evidence without a local repository root', async () => {
    const candidate = {
      ...architecture,
      meta: {
        ...architecture.meta,
        repository: {
          url: 'https://github.com/tt-a1i/archify',
          revision: '208acba8d412335185b2056fedf54b3405df43fb',
        },
      },
    };
    const error = await renderArchify(JSON.stringify(candidate)).catch((cause) => cause);
    expect(error).toBeInstanceOf(ArchifyError);
    expect(error.diagnostics[0].code).toBe('repository-evidence/root-required');
    expect(formatArchifyDiagnostics(error.diagnostics)).toContain('--repo-root');
  });

  it('rejects an unpinned URL brand mark with upstream guidance', async () => {
    const candidate = {
      ...architecture,
      components: architecture.components.map((component, index) => index === 0
        ? { ...component, brand: 'https://example.com' }
        : component),
    };
    const error = await renderArchify(JSON.stringify(candidate)).catch((cause) => cause);
    expect(error).toBeInstanceOf(ArchifyError);
    expect(error.diagnostics[0].code).toBe('brand/unpinned-url');
    expect(formatArchifyDiagnostics(error.diagnostics)).toContain('archify brands capture');
  });

  it('reports that pinned URL brand capture is unavailable', async () => {
    const candidate = {
      ...architecture,
      components: architecture.components.map((component, index) => index === 0
        ? { ...component, brand: { url: 'https://example.com', sha256: '0'.repeat(64) } }
        : component),
    };
    const error = await renderArchify(JSON.stringify(candidate)).catch((cause) => cause);
    expect(error).toBeInstanceOf(ArchifyError);
    expect(error.diagnostics[0].code).toBe('brand/capture-unavailable');
    expect(formatArchifyDiagnostics(error.diagnostics)).toContain('Network access is not supported in Artifacts');
  });
  it('uses receipt diagnostics without leaking them into the next render', async () => {
    const withWarning = structuredClone(architecture) as typeof architecture & { meta: Record<string, unknown> };
    withWarning.meta.translations = { 'not.a.key': 'x' };
    withWarning.meta.locale = 'en';
    withWarning.connections[1].id = withWarning.connections[0].id;
    const first = await renderArchify(JSON.stringify(withWarning)).catch((cause) => cause);
    expect(first).toBeInstanceOf(ArchifyError);
    expect(first.diagnostics.map((entry: { code: string }) => entry.code)).toContain('i18n/invalid-translation');
    expect(first.diagnostics.map((entry: { code: string }) => entry.code)).toContain('relationship/duplicate-id');
    expect(formatArchifyDiagnostics(first.diagnostics)).toContain('[warning i18n/invalid-translation]');

    const duplicateOnly = structuredClone(architecture);
    duplicateOnly.connections[1].id = duplicateOnly.connections[0].id;
    const second = await renderArchify(JSON.stringify(duplicateOnly)).catch((cause) => cause);
    expect(second).toBeInstanceOf(ArchifyError);
    expect(second.diagnostics.map((entry: { code: string }) => entry.code)).toContain('relationship/duplicate-id');
    expect(second.diagnostics.map((entry: { code: string }) => entry.code)).not.toContain('i18n/invalid-translation');
  });

  it('does not leak module state between successful renders', async () => {
    const first = await renderArchify(JSON.stringify(architecture));
    await renderArchify(JSON.stringify(workflow));
    const again = await renderArchify(JSON.stringify(architecture));
    expect(again).toEqual(first);
  });
});
