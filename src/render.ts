import type { ArtifactMeta } from './types';

const JSDELIVR = 'https://cdn.jsdelivr.net/npm';
const MARKED_URL = `${JSDELIVR}/marked@18.1.0/lib/marked.esm.js`;
const MARKDOWN_CSS_URL = `${JSDELIVR}/github-markdown-css@5.9.0/github-markdown.css`;
const MERMAID_URL = `${JSDELIVR}/mermaid@12.1.0/dist/mermaid.esm.min.mjs`;
const HLJS_URL = `${JSDELIVR}/@highlightjs/cdn-assets@11.12.0/es/highlight.min.js`;
const HLJS_LIGHT_CSS_URL = `${JSDELIVR}/@highlightjs/cdn-assets@11.12.0/styles/github.min.css`;
const HLJS_DARK_CSS_URL = `${JSDELIVR}/@highlightjs/cdn-assets@11.12.0/styles/github-dark.min.css`;
const BABEL_URL = `${JSDELIVR}/@babel/standalone@8.0.7/babel.min.js`;
const TAILWIND_URL = `${JSDELIVR}/@tailwindcss/browser@4.3.3/dist/index.global.js`;
const REACT_URL = 'https://esm.sh/react@19.3.0';
const REACT_DOM_URL = 'https://esm.sh/react-dom@19.3.0';

const IMPORT_MAP = JSON.stringify({
  imports: {
    react: REACT_URL,
    'react/': `${REACT_URL}/`,
    'react-dom': REACT_DOM_URL,
    'react-dom/': `${REACT_DOM_URL}/`,
  },
});

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const escapeJson = (s: string) =>
  s.replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

const ERROR_PANEL_CSS =
  '#artifact-error{position:fixed;left:0;right:0;bottom:0;max-height:50vh;overflow:auto;margin:0;padding:12px 16px;' +
  'background:#fef2f2;color:#991b1b;border-top:2px solid #dc2626;font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap;z-index:2147483647}';

// Classic script that runs before everything else so that load and runtime failures are never silent.
const ERROR_PANEL_SCRIPT = `
function showError(err) {
  var text = err && err.stack && String(err.stack).indexOf(String(err.message)) !== -1 ? err.stack : String((err && err.message) || err);
  var panel = document.getElementById('artifact-error');
  if (!panel) {
    panel = document.createElement('pre');
    panel.id = 'artifact-error';
    panel.setAttribute('role', 'alert');
    (document.body || document.documentElement).appendChild(panel);
  }
  panel.textContent += (panel.textContent ? '\\n\\n' : '') + text;
}
window.showError = showError;
window.addEventListener('error', function (e) {
  if (e.target && e.target !== window) showError('Failed to load ' + (e.target.src || e.target.href));
  else showError(e.error || e.message);
}, true);
window.addEventListener('unhandledrejection', function (e) { showError(e.reason); });
`;

const READ_SOURCE = `JSON.parse(document.getElementById('artifact-source').textContent)`;

const REACT_SCRIPT = `
try {
  var source = ${READ_SOURCE};
  var rewrite = function (literal) {
    if (!literal || literal.type !== 'StringLiteral') return;
    var s = literal.value;
    if (/^(\\.{0,2}\\/|[a-z][a-z0-9+.-]*:)/i.test(s) || /^react(-dom)?(\\/|$)/.test(s)) return;
    literal.value = 'https://esm.sh/' + s + (s.indexOf('?') === -1 ? '?' : '&') + 'external=react,react-dom';
  };
  var rewriteStatic = function (path) { rewrite(path.node.source); };
  var externalImports = function () {
    return {
      visitor: {
        ImportDeclaration: rewriteStatic,
        ExportNamedDeclaration: rewriteStatic,
        ExportAllDeclaration: rewriteStatic,
        ImportExpression: rewriteStatic,
        CallExpression: function (path) {
          if (path.node.callee.type === 'Import') rewrite(path.node.arguments[0]);
        },
      },
    };
  };
  var code = Babel.transform(source, {
    filename: 'artifact.tsx',
    sourceType: 'module',
    presets: [['react', { runtime: 'automatic' }], 'typescript'],
    plugins: [externalImports],
  }).code;
  // A Blob URL module resolves bare specifiers through the document import map and works in the opaque-origin sandbox.
  var url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  var imports = await Promise.all([import(url), import('react'), import('react-dom/client')]);
  var mod = imports[0];
  var Component = mod.default;
  if (!Component) {
    var name = Object.keys(mod).find(function (k) { return typeof mod[k] === 'function'; });
    Component = name && mod[name];
  }
  if (!Component) throw new Error('The file must export a React component (default export or a function export).');
  var react = imports[1];
  // A failed render never commits the wrapper, so every error path also releases print.
  var report = function (err) {
    showError(err);
    window.__artifactReady = true;
  };
  // Passive effects run after the commit, so the wrapper's effect fires once the artifact is in the DOM.
  var Ready = function (props) {
    react.useEffect(function () {
      window.__artifactReady = true;
    }, []);
    return props.children;
  };
  imports[2].createRoot(document.getElementById('root'), {
    onUncaughtError: report,
    onCaughtError: report,
    onRecoverableError: report,
  }).render(react.createElement(Ready, null, react.createElement(Component)));
} catch (err) {
  showError(err);
  window.__artifactReady = true;
}
`;

const MARKDOWN_SCRIPT = `
try {
  var source = ${READ_SOURCE};
  var marked = await import('${MARKED_URL}');
  document.getElementById('out').innerHTML = marked.parse(source);
  window.__artifactReady = true;
} catch (err) {
  showError(err);
  window.__artifactReady = true;
}
`;

const MERMAID_SCRIPT = `
try {
  var source = ${READ_SOURCE};
  var mermaid = (await import('${MERMAID_URL}')).default;
  var dark = matchMedia('(prefers-color-scheme: dark)').matches;
  mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', suppressErrorRendering: true });
  var result = await mermaid.render('artifact-diagram', source);
  document.getElementById('out').innerHTML = result.svg;
  window.__artifactReady = true;
} catch (err) {
  document.querySelectorAll('#dartifact-diagram').forEach(function (el) { el.remove(); });
  showError(err);
  window.__artifactReady = true;
}
`;

const CODE_SCRIPT = `
try {
  var source = ${READ_SOURCE};
  var language = document.getElementById('out').dataset.language;
  var hljs = (await import('${HLJS_URL}')).default;
  var el = document.getElementById('out');
  var result = language && hljs.getLanguage(language) ? hljs.highlight(source, { language: language }) : hljs.highlightAuto(source);
  el.innerHTML = result.value;
  el.className = 'hljs language-' + (result.language || 'plaintext');
  window.__artifactReady = true;
} catch (err) {
  showError(err);
  window.__artifactReady = true;
}
`;

function page(title: string, head: string, body: string, source: string): string {
  return (
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    `<title>${escapeHtml(title)}</title>\n` +
    `<style>${ERROR_PANEL_CSS}</style>\n` +
    `<script>${ERROR_PANEL_SCRIPT}</script>\n${head}\n</head>\n<body>\n${body}\n` +
    `<script type="application/json" id="artifact-source">${escapeJson(JSON.stringify(source))}</script>\n` +
    '</body>\n</html>\n'
  );
}

const moduleScript = (code: string) => `<script type="module">${code}</script>`;

// Classic scripts for the print mode of the render routes. Renderers set
// window.__artifactReady when their output is on screen; PRINT_SCRIPT (only served
// when the render URL has ?print=1 — the viewer's iframe src never includes it)
// waits for that flag with a 10 s fallback, then opens the print dialog on the
// artifact document itself.
const PRINT_READY_FLAG = '<script>window.__artifactReady = true</script>';
const PRINT_SCRIPT =
  '<script>window.addEventListener("load",function(){const start=Date.now();(function wait(){' +
  'if(window.__artifactReady||Date.now()-start>10000)setTimeout(function(){window.print()},400);' +
  'else setTimeout(wait,50)})()})</script>';

// Appending after </html> is safe: browsers still execute trailing scripts.
function withPrintScript(document_: string, print: boolean, ready = false): string {
  if (!print) return document_;
  return document_ + (ready ? PRINT_READY_FLAG : '') + PRINT_SCRIPT;
}

export function renderDocument(
  meta: Pick<ArtifactMeta, 'type' | 'language' | 'title'>,
  content: string,
  print = false,
): string {
  switch (meta.type) {
    case 'html':
      return withPrintScript(content, print, true);
    case 'svg':
      return withPrintScript(
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
          '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
          `<title>${escapeHtml(meta.title)}</title>\n` +
          '<style>html,body{margin:0;height:100%}body{display:grid;place-items:center;overflow:auto}' +
          'body>svg{max-width:100vw;max-height:100vh;width:auto;height:auto}</style>\n</head>\n' +
          `<body>\n${content}\n</body>\n</html>\n`,
        print,
        true,
      );
    case 'markdown':
      return withPrintScript(
        page(
          meta.title,
          `<link rel="stylesheet" href="${MARKDOWN_CSS_URL}">\n` +
            '<style>body{margin:0}.markdown-body{box-sizing:border-box;min-height:100vh;max-width:980px;margin:0 auto;padding:32px}' +
            '@media(max-width:767px){.markdown-body{padding:16px}}</style>',
          '<article class="markdown-body" id="out"></article>\n' + moduleScript(MARKDOWN_SCRIPT),
          content,
        ),
        print,
      );
    case 'mermaid':
      return withPrintScript(
        page(
          meta.title,
          '<style>body{margin:0;display:grid;place-items:center;min-height:100vh;font-family:system-ui,sans-serif}' +
            '@media(prefers-color-scheme:dark){body{background:#0d1117}}#out{padding:16px;max-width:100%;overflow:auto}</style>',
          '<div id="out"></div>\n' + moduleScript(MERMAID_SCRIPT),
          content,
        ),
        print,
      );
    case 'code':
      return withPrintScript(
        page(
          meta.title,
          `<link rel="stylesheet" href="${HLJS_LIGHT_CSS_URL}" media="(prefers-color-scheme: light)">\n` +
            `<link rel="stylesheet" href="${HLJS_DARK_CSS_URL}" media="(prefers-color-scheme: dark)">\n` +
            '<style>body{margin:0}pre{margin:0}pre code.hljs{min-height:100vh;box-sizing:border-box;padding:16px;font:13px/1.5 ui-monospace,monospace}</style>',
          `<pre><code id="out" data-language="${escapeHtml(meta.language ?? '')}"></code></pre>\n` + moduleScript(CODE_SCRIPT),
          content,
        ),
        print,
      );
    case 'react':
      return withPrintScript(
        page(
          meta.title,
          `<script type="importmap">${IMPORT_MAP}</script>\n` +
            `<script src="${BABEL_URL}"></script>\n<script src="${TAILWIND_URL}"></script>`,
          '<div id="root"></div>\n' + moduleScript(REACT_SCRIPT),
          content,
        ),
        print,
      );
  }
}
