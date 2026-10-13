import { describe, expect, it } from 'vitest';
import { DIAGRAM_ZOOM_SCRIPT, THEME_CSS, THEME_SCRIPT, renderDocument } from '../src/render';
import { ARTIFACT_TYPES, type ArtifactType } from '../src/types';

const render = (type: ArtifactType) => renderDocument({ type, language: null, title: 'Demo' }, 'x');
const SHELL_COLOR_SCHEME = ':root{color-scheme:light}:root[data-theme=dark]{color-scheme:dark}';
const TAILWIND_MAPPING = '<style type="text/tailwindcss">@theme inline{';

describe('artifact theme', () => {
  it('keeps only custom properties, inside the artifact-theme layer', () => {
    expect(THEME_CSS.startsWith('@layer artifact-theme{')).toBe(true);
    expect(THEME_CSS.endsWith('}}}')).toBe(true);
    expect(THEME_CSS.match(/@layer/g)).toHaveLength(1);
    expect(THEME_CSS).toContain(':root{--bg:#faf9f5;');
    expect(THEME_CSS).toContain(':root[data-theme=dark]{--bg:#151515;');
    expect(THEME_CSS).toContain('@media (prefers-color-scheme: dark){:root:not([data-theme]){--bg:#151515;');
    for (const token of ['--surface-2', '--on-accent', '--info', '--chart-6', '--font', '--mono', '--radius', '--shadow']) expect(THEME_CSS).toContain(`${token}:`);
    // Agent documents must not inherit a color-scheme or base colors from the theme.
    expect(THEME_CSS).not.toMatch(/[{;]color-scheme:|body|html|[{;](color|background)/);
  });

  it.each(ARTIFACT_TYPES)('puts the theme in the %s document', (type) => {
    const doc = render(type);
    expect(doc).toContain(`<style>${THEME_CSS}</style>\n<script>${THEME_SCRIPT}</script>`);
    expect(doc.split(THEME_SCRIPT)).toHaveLength(2);
  });

  it('sets the theme in the head of renderer shells, before the body', () => {
    for (const type of ['markdown', 'mermaid', 'code', 'react', 'slides', 'design', 'svg'] as const) {
      const doc = render(type);
      expect(doc.indexOf(THEME_SCRIPT)).toBeLessThan(doc.indexOf('</head>'));
    }
  });

  it('accepts only artifact-theme messages from the parent and never evaluates them', () => {
    expect(THEME_SCRIPT).toContain("e.source !== parent || !data || data.type !== 'artifact-theme'");
    expect(THEME_SCRIPT).toContain("['light', 'dark', 'system'].indexOf(data.theme) === -1");
    expect(THEME_SCRIPT).toContain("if (parent !== window) parent.postMessage({ type: 'artifact-theme-request' }, '*')");
    expect(THEME_SCRIPT).toContain("new CustomEvent('artifact-theme', { detail: theme })");
    expect(THEME_SCRIPT).toContain("link.getAttribute('data-theme-css') === theme ? 'all' : 'not all'");
    expect(THEME_SCRIPT).not.toMatch(/eval|Function\(|innerHTML/);
  });

  it('ranks the token layer first, keeps an artifact-set data-theme and prints light', () => {
    expect(THEME_SCRIPT).toContain("if (style && style.tagName === 'STYLE' && document.head) document.head.prepend(style);");
    expect(THEME_SCRIPT).toContain('if (attr === null || attr === written) root.dataset.theme = written = theme;');
    expect(THEME_SCRIPT).toContain('var printing = parent === window && /[?&]print=1(&|$)/.test(location.search);');
    expect(THEME_SCRIPT).toContain("var theme = printing ? 'light' :");
  });

  it('keeps design artboards white by default, as a blank screen', () => {
    expect(render('design')).toContain('@layer artboard { [data-artboard] { background: #fff; box-shadow');
  });

  it('maps the tokens to Tailwind only for react and design', () => {
    for (const type of ARTIFACT_TYPES) {
      const doc = render(type);
      if (type === 'react' || type === 'design') {
        expect(doc).toContain(TAILWIND_MAPPING);
        expect(doc).toContain('--color-on-accent:var(--on-accent)');
        expect(doc).toContain('--color-chart-6:var(--chart-6)');
        expect(doc).toContain('@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));');
        expect(doc.indexOf(TAILWIND_MAPPING)).toBeLessThan(doc.indexOf('@tailwindcss/browser@'));
      } else expect(doc).not.toContain('text/tailwindcss');
    }
  });

  it('sets color-scheme only in renderer-owned document shells, never where artifact content inherits it', () => {
    for (const type of ['markdown', 'code', 'slides'] as const) expect(render(type)).toContain(SHELL_COLOR_SCHEME);
    for (const type of ['html', 'react', 'motion', 'svg', 'design', 'mermaid'] as const) {
      const doc = render(type);
      expect(doc).not.toMatch(/[{;]color-scheme:/);
      expect(doc.replace(THEME_CSS, '')).not.toMatch(/body\{[^}]*background/);
    }
  });

  it('follows data-theme instead of prefers-color-scheme in renderer shells', () => {
    for (const type of ['markdown', 'mermaid', 'slides', 'design'] as const)
      expect(render(type).replace(THEME_CSS, '').replace(THEME_SCRIPT, '')).not.toContain('prefers-color-scheme');
  });

  it('switches highlight.js styles by data-theme-css', () => {
    const doc = render('code');
    expect(doc).toContain('styles/github.min.css" data-theme-css="light"');
    expect(doc).toContain('styles/github-dark.min.css" data-theme-css="dark"');
    expect(doc.indexOf('data-theme-css="dark"')).toBeLessThan(doc.indexOf(THEME_SCRIPT));
  });

  it('points github-markdown-css variables at the tokens', () => {
    const doc = render('markdown');
    for (const pair of ['--fgColor-default:var(--fg)', '--bgColor-default:var(--bg)', '--bgColor-muted:var(--surface)', '--borderColor-default:var(--border)'])
      expect(doc).toContain(pair);
    expect(doc.indexOf('--fgColor-default:var(--fg)')).toBeGreaterThan(doc.indexOf('github-markdown-css@'));
  });

  it('themes mermaid from the tokens and redraws only the SVG on a theme change', () => {
    const doc = render('mermaid');
    expect(doc).toContain("theme: 'base'");
    expect(doc).toContain("primaryTextColor: token('fg')");
    expect(doc).toContain("window.addEventListener('artifact-theme'");
    expect(doc).toMatch(/draw\(\)\.catch\(function \(err\) \{\s+removeDiagram\(\);\s+showError\(err\);/);
  });
});

describe('diagram zoom', () => {
  it('is added to html and react only', () => {
    for (const type of ARTIFACT_TYPES) expect(render(type).includes(DIAGRAM_ZOOM_SCRIPT)).toBe(type === 'html' || type === 'react');
  });

  it('finds Mermaid diagrams, keeps plain wheel scrolling and never changes layout', () => {
    expect(DIAGRAM_ZOOM_SCRIPT).toContain(`'.mermaid > svg, svg[aria-roledescription][role~="graphics-document"]'`);
    expect(DIAGRAM_ZOOM_SCRIPT).toContain('if (!e.ctrlKey && !e.metaKey) return;');
    expect(DIAGRAM_ZOOM_SCRIPT).toContain("svg.setAttribute('viewBox'");
    expect(DIAGRAM_ZOOM_SCRIPT).toContain("host.attachShadow({ mode: 'open' })");
    expect(DIAGRAM_ZOOM_SCRIPT).not.toMatch(/eval|Function\(/);
  });
});
