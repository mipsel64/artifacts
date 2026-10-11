import type { ArtifactMeta } from './types';

const JSDELIVR = 'https://cdn.jsdelivr.net/npm';
const MARKED_URL = `${JSDELIVR}/marked@18.1.0/lib/marked.esm.js`;
const MARKDOWN_CSS_URL = `${JSDELIVR}/github-markdown-css@5.9.0/github-markdown.css`;
const MERMAID_URL = `${JSDELIVR}/mermaid@12.1.0/dist/mermaid.esm.min.mjs`;
const HLJS_URL = `${JSDELIVR}/@highlightjs/cdn-assets@11.12.0/es/highlight.min.js`;
const HLJS_LIGHT_CSS_URL = `${JSDELIVR}/@highlightjs/cdn-assets@11.12.0/styles/base16/gruvbox-light-medium.min.css`;
const HLJS_DARK_CSS_URL = `${JSDELIVR}/@highlightjs/cdn-assets@11.12.0/styles/base16/gruvbox-dark-medium.min.css`;
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

// --- theme ---

const THEME_DARK_TOKENS =
  '--bg:#282828;--surface:#3c3836;--surface-2:#504945;--border:#504945;--fg:#ebdbb2;--muted:#bdae93;--accent:#d79921;--on-accent:#282828;' +
  '--danger:#fb4934;--warning:#fabd2f;--success:#b8bb26;--info:#83a598;' +
  '--chart-1:#83a598;--chart-2:#fe8019;--chart-3:#b8bb26;--chart-4:#d3869b;--chart-5:#fabd2f;--chart-6:#8ec07c;' +
  '--shadow:0 8px 24px rgb(0 0 0 / .5)';

// Only custom properties, in a layer so unlayered artifact CSS (even its own --bg) always wins; no colors are applied here.
export const THEME_CSS =
  '@layer artifact-theme{' +
  ':root{--bg:#fbf1c7;--surface:#f2e5bc;--surface-2:#ebdbb2;--border:#d5c4a1;--fg:#3c3836;--muted:#665c54;--accent:#af3a03;--on-accent:#fbf1c7;' +
  '--danger:#9d0006;--warning:#b57614;--success:#79740e;--info:#076678;' +
  '--chart-1:#076678;--chart-2:#af3a03;--chart-3:#79740e;--chart-4:#8f3f71;--chart-5:#b57614;--chart-6:#427b58;' +
  "--font:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;" +
  '--radius:8px;--shadow:0 8px 24px rgb(60 56 54 / .16)}' +
  `:root[data-theme=dark]{${THEME_DARK_TOKENS}}` +
  `@media (prefers-color-scheme: dark){:root:not([data-theme]){${THEME_DARK_TOKENS}}}` +
  '}';

// The sandbox has no storage or parent access, so the viewer's theme choice arrives by postMessage; nothing in a message is evaluated.
export const THEME_SCRIPT = `
(function () {
  var root = document.documentElement, media = matchMedia('(prefers-color-scheme: dark)'), choice = 'system', current = null, written = null;
  // The print tab has no parent to ask, and paper is light.
  var printing = parent === window && /[?&]print=1(&|$)/.test(location.search);
  // Layer order follows first appearance, so the token layer must come first to rank below the artifact's own layers.
  var style = document.currentScript && document.currentScript.previousElementSibling;
  if (style && style.tagName === 'STYLE' && document.head) document.head.prepend(style);
  function apply() {
    var theme = printing ? 'light' : choice === 'system' ? (media.matches ? 'dark' : 'light') : choice;
    // An artifact that sets its own data-theme (daisyUI, Pico, its own toggle) keeps it.
    var attr = root.getAttribute('data-theme');
    if (attr === null || attr === written) root.dataset.theme = written = theme;
    document.querySelectorAll('link[data-theme-css]').forEach(function (link) {
      link.media = link.getAttribute('data-theme-css') === theme ? 'all' : 'not all';
    });
    if (theme === current) return;
    current = theme;
    window.dispatchEvent(new CustomEvent('artifact-theme', { detail: theme }));
  }
  media.addEventListener('change', apply);
  window.addEventListener('message', function (e) {
    var data = e.data;
    if (e.source !== parent || !data || data.type !== 'artifact-theme' || ['light', 'dark', 'system'].indexOf(data.theme) === -1) return;
    choice = data.theme;
    apply();
  });
  apply();
  if (parent !== window) parent.postMessage({ type: 'artifact-theme-request' }, '*');
})();
`;

const THEME_HEAD = `<style>${THEME_CSS}</style>\n<script>${THEME_SCRIPT}</script>`;

// Renderer-owned shells only: agent documents (html, react, motion) keep their own color-scheme.
const SHELL_COLOR_SCHEME_CSS = ':root{color-scheme:light}:root[data-theme=dark]{color-scheme:dark}';

// github-markdown-css switches on prefers-color-scheme; its variables are pointed at the tokens instead (same specificity, later in the cascade).
const MARKDOWN_THEME_CSS =
  '.markdown-body{color-scheme:inherit;--fontStack-sansSerif:var(--font);--fontStack-monospace:var(--mono);' +
  '--fgColor-default:var(--fg);--fgColor-muted:var(--muted);--fgColor-accent:var(--accent);--fgColor-danger:var(--danger);' +
  '--fgColor-attention:var(--warning);--fgColor-success:var(--success);--fgColor-done:var(--chart-4);' +
  '--bgColor-default:var(--bg);--bgColor-muted:var(--surface);--bgColor-neutral-muted:var(--surface-2);' +
  '--bgColor-attention-muted:color-mix(in srgb,var(--warning) 25%,transparent);' +
  '--borderColor-default:var(--border);--borderColor-muted:var(--border);--borderColor-neutral-muted:var(--border);' +
  '--borderColor-accent-emphasis:var(--accent);--borderColor-attention-emphasis:var(--warning);--borderColor-danger-emphasis:var(--danger);' +
  '--borderColor-success-emphasis:var(--success);--borderColor-done-emphasis:var(--chart-4);--focus-outlineColor:var(--accent)}';

// Tailwind colors and the dark: variant for react and design, resolved through the tokens at use time.
const TAILWIND_THEME =
  '<style type="text/tailwindcss">@theme inline{' +
  '--color-bg:var(--bg);--color-surface:var(--surface);--color-surface-2:var(--surface-2);--color-border:var(--border);' +
  '--color-fg:var(--fg);--color-muted:var(--muted);--color-accent:var(--accent);--color-on-accent:var(--on-accent);' +
  '--color-danger:var(--danger);--color-warning:var(--warning);--color-success:var(--success);--color-info:var(--info);' +
  '--color-chart-1:var(--chart-1);--color-chart-2:var(--chart-2);--color-chart-3:var(--chart-3);' +
  '--color-chart-4:var(--chart-4);--color-chart-5:var(--chart-5);--color-chart-6:var(--chart-6);' +
  '--font-sans:var(--font);--font-mono:var(--mono)}' +
  '@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));</style>';

// --- end theme ---

// --- diagram zoom ---

// Icon geometry from Lucide (ISC license, see src/ui/icons.tsx).
const ZOOM_ICONS = {
  out: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3M8 11h6"/>',
  in: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>',
  fit: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>',
  full: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
};
const zoomIcon = (name: keyof typeof ZOOM_ICONS) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ZOOM_ICONS[name]}</svg>`;

const DIAGRAM_ZOOM_CSS =
  'svg[data-artifact-zoom]{cursor:grab}svg[data-artifact-zoom].artifact-panning{cursor:grabbing;user-select:none}' +
  'svg[data-artifact-zoom]:fullscreen{width:100vw!important;height:100vh!important;max-width:none!important;background:var(--bg,#fff)}';

const DIAGRAM_ZOOM_BAR_CSS =
  ':host{all:initial}@media print{:host{display:none!important}}' +
  '.bar{display:flex;gap:2px;padding:3px;background:var(--surface,#fff);border:1px solid var(--border,#d4d4d8);border-radius:8px;' +
  'box-shadow:var(--shadow,0 4px 12px rgb(0 0 0 / .12));font:13px system-ui,sans-serif}' +
  'button{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:6px;' +
  'background:transparent;color:var(--fg,#18181b);cursor:pointer}svg{display:block}' +
  'button:hover{background:var(--surface-2,#f4f4f5)}button:focus-visible{outline:2px solid var(--accent,#2563eb);outline-offset:-2px}';

// Mermaid diagrams that html and react artifacts draw themselves get pan and zoom through their viewBox, so the page layout never changes.
export const DIAGRAM_ZOOM_SCRIPT = `
(function () {
  var SELECTOR = '.mermaid > svg, svg[aria-roledescription][role~="graphics-document"]';
  var bases = new WeakMap(), current = null, drag = null, dragged = false, hideTimer = 0, pending = 0;
  var style = document.createElement('style');
  style.textContent = '${DIAGRAM_ZOOM_CSS}';
  (document.head || document.documentElement).appendChild(style);
  var host = document.createElement('div');
  host.style.cssText = 'position:fixed;z-index:2147483646;display:none;transform:translateX(-100%)';
  var root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<style>${DIAGRAM_ZOOM_BAR_CSS}</style><div class="bar" role="toolbar" aria-label="Diagram zoom">' +
    '<button type="button" data-act="out" aria-label="Zoom out" title="Zoom out">${zoomIcon('out')}</button>' +
    '<button type="button" data-act="in" aria-label="Zoom in" title="Zoom in">${zoomIcon('in')}</button>' +
    '<button type="button" data-act="fit" aria-label="Reset zoom" title="Reset zoom">${zoomIcon('fit')}</button>' +
    '<button type="button" data-act="full" aria-label="Full screen" title="Full screen">${zoomIcon('full')}</button></div>';
  if (!document.fullscreenEnabled) root.querySelector('[data-act=full]').remove();

  function box(svg) { var b = svg.viewBox.baseVal; return { x: b.x, y: b.y, w: b.width, h: b.height }; }
  function set(svg, v) { svg.setAttribute('viewBox', v.x + ' ' + v.y + ' ' + v.w + ' ' + v.h); }
  function zoom(svg, factor, cx, cy) {
    var v = box(svg), b = bases.get(svg), ctm = svg.getScreenCTM();
    if (!ctm) return;
    var w = Math.min(b.w * 5, Math.max(b.w / 20, v.w / factor));
    if (cx === undefined) {
      var r = svg.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
    }
    var p = new DOMPoint(cx, cy).matrixTransform(ctm.inverse()), f = v.w / w;
    set(svg, { x: p.x - (p.x - v.x) / f, y: p.y - (p.y - v.y) / f, w: w, h: v.h / f });
  }
  function act(name, svg) {
    if (name === 'out') zoom(svg, 0.8);
    else if (name === 'in') zoom(svg, 1.25);
    else if (name === 'fit') set(svg, bases.get(svg));
    else if (name === 'full') (document.fullscreenElement ? document.exitFullscreen() : svg.requestFullscreen()).catch(function () {});
  }
  function place() {
    if (!current) return;
    var r = current.getBoundingClientRect();
    host.style.top = Math.max(4, r.top + 8) + 'px';
    host.style.left = r.right - 8 + 'px';
  }
  function show(svg) {
    clearTimeout(hideTimer);
    current = svg;
    if (!host.isConnected) document.body.appendChild(host);
    host.style.display = 'block';
    place();
  }
  function hide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { host.style.display = 'none'; current = null; }, 400);
  }

  function enhance(svg) {
    if (bases.has(svg) || !svg.viewBox.baseVal || !svg.viewBox.baseVal.width) return;
    bases.set(svg, box(svg));
    svg.setAttribute('data-artifact-zoom', '');
    if (!svg.hasAttribute('tabindex')) svg.setAttribute('tabindex', '0');
    svg.addEventListener('pointerenter', function () { show(svg); });
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('focus', function () { show(svg); });
    svg.addEventListener('blur', hide);
    svg.addEventListener('dblclick', function () { act('fit', svg); });
    // Plain wheel keeps scrolling the page; pinch and ctrl/cmd-wheel zoom.
    svg.addEventListener('wheel', function (e) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoom(svg, Math.exp(-Math.max(-50, Math.min(50, e.deltaY * (e.deltaMode === 1 ? 16 : 1))) * 0.01), e.clientX, e.clientY);
    }, { passive: false });
    svg.addEventListener('pointerdown', function (e) {
      var ctm = svg.getScreenCTM();
      if (e.button !== 0 || !ctm || e.target.closest('a')) return;
      // Stops text selection and mouse focus; click and dblclick still fire.
      e.preventDefault();
      drag = { svg: svg, id: e.pointerId, x: e.clientX, y: e.clientY, v: box(svg), k: ctm.a, moved: false };
    });
    // A pan must not also fire the diagram's own click handlers.
    svg.addEventListener('click', function (e) {
      if (!dragged) return;
      dragged = false;
      e.stopPropagation();
      e.preventDefault();
    }, true);
    svg.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var name = { '+': 'in', '=': 'in', '-': 'out', '0': 'fit', f: 'full' }[e.key];
      if (!name) return;
      e.preventDefault();
      act(name, svg);
    });
  }
  function scan() {
    pending = 0;
    document.querySelectorAll(SELECTOR).forEach(enhance);
  }

  document.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (Math.abs(dx) + Math.abs(dy) < 4) return;
      drag.moved = true;
      drag.svg.setPointerCapture(e.pointerId);
      drag.svg.classList.add('artifact-panning');
    }
    set(drag.svg, { x: drag.v.x - dx / drag.k, y: drag.v.y - dy / drag.k, w: drag.v.w, h: drag.v.h });
  });
  function endDrag() {
    if (!drag) return;
    dragged = drag.moved;
    drag.svg.classList.remove('artifact-panning');
    drag = null;
    setTimeout(function () { dragged = false; }, 0);
  }
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
  root.addEventListener('click', function (e) {
    var button = e.target.closest('button');
    if (button && current) act(button.getAttribute('data-act'), current);
  });
  host.addEventListener('pointerenter', function () { clearTimeout(hideTimer); });
  host.addEventListener('pointerleave', hide);
  host.addEventListener('focusin', function () { clearTimeout(hideTimer); });
  host.addEventListener('focusout', hide);
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);
  new MutationObserver(function () { if (!pending) pending = setTimeout(scan, 50); })
    .observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();
`;

// --- end diagram zoom ---

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

// --- slides ---

const SLIDES_CSS = `
html,body{margin:0;height:100%;overflow:hidden}
#stage{position:fixed;inset:0;overflow:hidden;background:var(--surface-2)}
.slide{position:absolute;left:50%;top:50%;width:1280px;height:720px;margin:-360px 0 0 -640px;transform:scale(var(--s,1));box-sizing:border-box;overflow:hidden}
@media screen{.slide[hidden]{display:none}}
:where(.slide){display:flex;flex-direction:column;justify-content:center;padding:64px 80px;background:var(--bg);color:var(--fg);font:28px/1.4 var(--font)}
:where(.slide h1,.slide h2,.slide h3,.slide h4){line-height:1.15;margin:0 0 .5em}
:where(.slide h1){font-size:64px}
:where(.slide h2){font-size:44px}
:where(.slide h3){font-size:34px}
:where(.slide p,.slide ul,.slide ol,.slide pre,.slide table,.slide blockquote){margin:0 0 .75em}
:where(.slide ul,.slide ol){padding-left:1.2em}
:where(.slide li){margin:.2em 0}
:where(.slide a){color:var(--accent)}
:where(.slide img){max-width:100%;max-height:100%;object-fit:contain}
:where(.slide code){font:.85em var(--mono);background:var(--surface-2);padding:.1em .3em;border-radius:4px}
:where(.slide pre){background:var(--surface-2);padding:20px 24px;border-radius:var(--radius);overflow:hidden;font-size:24px}
:where(.slide pre code){background:none;padding:0;font-size:inherit}
:where(.slide table){border-collapse:collapse}
:where(.slide th,.slide td){border:1px solid var(--border);padding:8px 16px;text-align:left}
:where(.slide blockquote){border-left:6px solid var(--border);padding-left:24px;color:var(--muted)}
#controls{position:fixed;right:12px;bottom:12px;display:flex;align-items:center;gap:4px;padding:4px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--fg);font:14px var(--font);opacity:.3;transition:opacity .15s}
#controls:hover,#controls:focus-within{opacity:1}
#controls button{min-width:32px;height:32px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;cursor:pointer}
#controls button:hover:not(:disabled){background:var(--surface-2)}
#controls button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
#controls button:disabled{opacity:.4;cursor:default}
#counter{min-width:4em;text-align:center}
@page{size:1280px 720px;margin:0}
@media print{
html,body{height:auto;overflow:visible}
#stage{position:static;background:none;overflow:visible}
.slide{position:relative;left:auto;top:auto;margin:0;transform:none;break-after:page}
.slide:last-child{break-after:auto}
#controls{display:none}
}
`;

const SLIDES_BODY =
  '<main id="stage"></main>\n' +
  '<div id="controls" role="group" aria-label="Slide controls">' +
  '<button type="button" id="prev" aria-label="Previous slide">&#8592;</button>' +
  '<span id="counter" aria-live="polite"></span>' +
  '<button type="button" id="next" aria-label="Next slide">&#8594;</button>' +
  '<button type="button" id="fullscreen" aria-label="Toggle fullscreen">&#9974;</button></div>';

const SLIDES_SCRIPT = `
try {
  var source = ${READ_SOURCE};
  var marked = await import('${MARKED_URL}');
  var tokens = marked.lexer(source);
  var groups = [[]];
  tokens.forEach(function (t) {
    if (t.type === 'hr') groups.push([]);
    else groups[groups.length - 1].push(t);
  });
  groups = groups.filter(function (g) { return g.some(function (t) { return t.type !== 'space'; }); });
  if (!groups.length) groups = [[]];
  var stage = document.getElementById('stage');
  var slides = groups.map(function (group, i) {
    var el = document.createElement('section');
    el.className = 'slide';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-roledescription', 'slide');
    el.setAttribute('aria-label', (i + 1) + ' of ' + groups.length);
    el.innerHTML = marked.parser(Object.assign(group, { links: tokens.links }));
    stage.appendChild(el);
    return el;
  });
  var prev = document.getElementById('prev');
  var next = document.getElementById('next');
  var full = document.getElementById('fullscreen');
  var counter = document.getElementById('counter');
  var current = 0;
  var show = function (n) {
    current = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach(function (el, i) { el.hidden = i !== current; });
    prev.disabled = current === 0;
    next.disabled = current === slides.length - 1;
    counter.textContent = (current + 1) + ' / ' + slides.length;
  };
  var fit = function () {
    document.documentElement.style.setProperty('--s', Math.min(innerWidth / 1280, innerHeight / 720));
  };
  var toggleFullscreen = function () {
    var done = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    done.catch(function () {});
  };
  if (!document.fullscreenEnabled) full.remove();
  prev.addEventListener('click', function () { show(current - 1); });
  next.addEventListener('click', function () { show(current + 1); });
  full.addEventListener('click', toggleFullscreen);
  addEventListener('resize', fit);
  addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && t.closest && t.closest('input,textarea,select,button,a,[contenteditable]')) return;
    var key = e.key;
    if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown' || key === ' ') show(current + 1);
    else if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp') show(current - 1);
    else if (key === 'Home') show(0);
    else if (key === 'End') show(slides.length - 1);
    else if ((key === 'f' || key === 'F') && document.fullscreenEnabled) toggleFullscreen();
    else return;
    e.preventDefault();
  });
  fit();
  show(0);
  window.__artifactReady = true;
} catch (err) {
  showError(err);
  window.__artifactReady = true;
}
`;

function slidesDocument(title: string, content: string, print: boolean): string {
  return withPrintScript(page(title, `<style>${SHELL_COLOR_SCHEME_CSS}${SLIDES_CSS}</style>`, SLIDES_BODY + '\n' + moduleScript(SLIDES_SCRIPT), content), print);
}

// --- end slides ---

const MERMAID_SCRIPT = `
var removeDiagram = function () {
  document.querySelectorAll('#dartifact-diagram').forEach(function (el) { el.remove(); });
};
try {
  var source = ${READ_SOURCE};
  var mermaid = (await import('${MERMAID_URL}')).default;
  var canvas = document.getElementById('canvas');
  var draw = async function () {
    // Mermaid derives shades from its theme variables, so it needs the resolved hex values, not var().
    var css = getComputedStyle(document.documentElement);
    var token = function (name) { return css.getPropertyValue('--' + name).trim(); };
    mermaid.initialize({
      startOnLoad: false,
      suppressErrorRendering: true,
      theme: 'base',
      themeVariables: {
        darkMode: document.documentElement.dataset.theme === 'dark',
        background: token('bg'),
        fontFamily: token('font'),
        primaryColor: token('bg'),
        primaryTextColor: token('fg'),
        primaryBorderColor: token('muted'),
        secondaryColor: token('surface-2'),
        secondaryTextColor: token('fg'),
        secondaryBorderColor: token('border'),
        tertiaryColor: token('surface'),
        tertiaryTextColor: token('fg'),
        tertiaryBorderColor: token('border'),
        mainBkg: token('bg'),
        nodeBorder: token('muted'),
        clusterBkg: token('surface-2'),
        clusterBorder: token('border'),
        lineColor: token('muted'),
        textColor: token('fg'),
        titleColor: token('fg'),
        edgeLabelBackground: token('surface'),
        noteBkgColor: token('surface-2'),
        noteTextColor: token('fg'),
        noteBorderColor: token('border'),
      },
    });
    var result = await mermaid.render('artifact-diagram', source);
    canvas.innerHTML = result.svg;
    // Mermaid emits width=100% with a max-width, which has no definite size inside the shrink-to-fit canvas.
    var svg = canvas.querySelector('svg');
    var box = svg && svg.viewBox.baseVal;
    if (box && box.width) {
      svg.setAttribute('width', box.width);
      svg.setAttribute('height', box.height);
      svg.style.maxWidth = 'none';
    }
  };
  // Only the SVG is replaced, so the canvas keeps its pan and zoom. Mermaid queues renders, so the last switch wins.
  window.addEventListener('artifact-theme', function () {
    draw().catch(function (err) {
      removeDiagram();
      showError(err);
    });
  });
  await draw();
} catch (err) {
  removeDiagram();
  showError(err);
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

// --- design ---

// The artboard defaults live in a layer declared before Tailwind's so utilities and author CSS override them.
const DESIGN_CSS = `
@layer artboard, theme, base, components, utilities;
@layer artboard { [data-artboard] { background: #fff; box-shadow: 0 1px 3px rgb(0 0 0 / .12), 0 8px 30px rgb(0 0 0 / .14); } }
html, body { margin: 0; height: 100%; }
#viewport { position: fixed; inset: 0; overflow: hidden; touch-action: none; overscroll-behavior: none; background-color: var(--surface);
  background-image: radial-gradient(circle, var(--border) 1px, transparent 1px); background-size: 24px 24px; }
#viewport.grab { cursor: grab; }
#viewport.panning { cursor: grabbing; user-select: none; }
#canvas { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
#canvas.boards { display: flex; align-items: flex-start; gap: 80px; padding: 80px; width: max-content; }
figure.artboard { margin: 0; flex: none; }
figure.artboard > figcaption { margin: 0 0 12px; font: 500 13px/1.2 var(--font); color: var(--muted); white-space: nowrap; }
#toolbar { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 10; display: flex; gap: 2px; padding: 4px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 10px; font: 13px var(--font); }
#toolbar button { display: inline-flex; align-items: center; justify-content: center; min-width: 32px; height: 32px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent; color: var(--fg); font: inherit; cursor: pointer; }
#toolbar button:hover { background: var(--surface-2); }
#toolbar button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
@media print {
  html, body { height: auto; }
  #viewport { position: static; overflow: visible; background: none; }
  #canvas, #canvas.boards { position: static; display: block; width: auto; padding: 0; transform: none !important; }
  figure.artboard { break-after: page; margin: 0 0 16px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  #toolbar { display: none; }
}
`;

const DESIGN_TOOLBAR =
  '<div id="toolbar" role="toolbar" aria-label="Canvas zoom">' +
  `<button type="button" id="zoom-out" aria-label="Zoom out" title="Zoom out">${zoomIcon('out')}</button>` +
  '<button type="button" id="zoom-level" aria-label="Zoom 100%, reset to 100%" title="Reset to 100%">100%</button>' +
  `<button type="button" id="zoom-in" aria-label="Zoom in" title="Zoom in">${zoomIcon('in')}</button>` +
  `<button type="button" id="zoom-fit" aria-label="Fit all to screen" title="Fit all to screen">${zoomIcon('fit')}</button></div>`;

const DESIGN_SCRIPT = `
(function () {
try {
  var viewport = document.getElementById('viewport');
  var canvas = document.getElementById('canvas');
  var zoomLevel = document.getElementById('zoom-level');
  var MIN = 0.1, MAX = 4, MARGIN = 16;
  var x = 0, y = 0, s = 1, auto = true, space = false, drag = null;
  var boards = Array.prototype.filter.call(canvas.querySelectorAll('[data-artboard]'), function (el) {
    return !el.parentElement.closest('[data-artboard]');
  });
  boards.forEach(function (el) {
    var figure = document.createElement('figure');
    figure.className = 'artboard';
    var caption = document.createElement('figcaption');
    caption.textContent = el.getAttribute('data-artboard');
    el.parentNode.insertBefore(figure, el);
    figure.appendChild(caption);
    figure.appendChild(el);
  });
  if (boards.length) canvas.classList.add('boards');

  function apply() {
    var percent = Math.round(s * 100) + '%';
    canvas.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')';
    viewport.style.backgroundSize = 24 * s + 'px ' + 24 * s + 'px';
    viewport.style.backgroundPosition = x + 'px ' + y + 'px';
    zoomLevel.textContent = percent;
    zoomLevel.setAttribute('aria-label', 'Zoom ' + percent + ', reset to 100%');
  }
  function zoomAt(factor, cx, cy) {
    var next = Math.min(MAX, Math.max(Math.min(MIN, s), s * factor));
    x = cx - (cx - x) * next / s;
    y = cy - (cy - y) * next / s;
    s = next;
    auto = false;
    apply();
  }
  function zoomBy(factor) { zoomAt(factor, viewport.clientWidth / 2, viewport.clientHeight / 2); }
  function fit() {
    var w = canvas.offsetWidth, h = canvas.offsetHeight;
    if (!w || !h) return;
    var vw = viewport.clientWidth, vh = viewport.clientHeight;
    s = Math.max(0.01, Math.min(1, (vw - 2 * MARGIN) / w, (vh - 2 * MARGIN) / h));
    x = (vw - w * s) / 2;
    y = (vh - h * s) / 2;
    auto = true;
    apply();
  }
  function typing(t) {
    return !!t && (t.isContentEditable || (!!t.closest && !!t.closest('input,textarea,select,button,a')));
  }
  function endDrag() {
    drag = null;
    viewport.classList.remove('panning');
  }

  document.getElementById('zoom-out').addEventListener('click', function () { zoomBy(0.8); });
  document.getElementById('zoom-in').addEventListener('click', function () { zoomBy(1.25); });
  zoomLevel.addEventListener('click', function () { zoomBy(1 / s); });
  document.getElementById('zoom-fit').addEventListener('click', fit);

  viewport.addEventListener('wheel', function (e) {
    e.preventDefault();
    var k = e.deltaMode === 1 ? 16 : 1;
    if (e.ctrlKey || e.metaKey) {
      zoomAt(Math.exp(-Math.max(-50, Math.min(50, e.deltaY * k)) * 0.01), e.clientX, e.clientY);
    } else {
      x -= e.deltaX * k;
      y -= e.deltaY * k;
      auto = false;
      apply();
    }
  }, { passive: false });

  viewport.addEventListener('pointerdown', function (e) {
    if (e.button > 1 || (e.button === 0 && !space && e.target.closest('[data-artboard]'))) return;
    e.preventDefault();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    viewport.setPointerCapture(e.pointerId);
    viewport.classList.add('panning');
  });
  viewport.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    x += e.clientX - drag.x;
    y += e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    auto = false;
    apply();
  });
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);
  viewport.addEventListener('lostpointercapture', endDrag);

  document.addEventListener('keydown', function (e) {
    // A clicked toolbar button keeps focus, so it must not swallow the zoom keys (Space still activates it).
    if (e.ctrlKey || e.metaKey || e.altKey || (typing(e.target) && !(e.target.closest('#toolbar') && e.key !== ' '))) return;
    if (e.key === ' ') {
      e.preventDefault();
      space = true;
      viewport.classList.add('grab');
    } else if (e.key === '+' || e.key === '=') zoomBy(1.25);
    else if (e.key === '-') zoomBy(0.8);
    else if (e.key === '0') fit();
  });
  function releaseSpace() {
    space = false;
    viewport.classList.remove('grab');
  }
  document.addEventListener('keyup', function (e) { if (e.key === ' ') releaseSpace(); });
  window.addEventListener('blur', releaseSpace);

  function refit() { if (auto) fit(); }
  new ResizeObserver(refit).observe(canvas);
  window.addEventListener('resize', refit);
  fit();
  window.__artifactReady = true;
} catch (err) {
  showError(err);
  window.__artifactReady = true;
}
})();
`;

function designDocument(title: string, content: string, print: boolean): string {
  return withPrintScript(
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      `<title>${escapeHtml(title)}</title>\n` +
      `<style>${ERROR_PANEL_CSS}</style>\n<script>${ERROR_PANEL_SCRIPT}</script>\n${THEME_HEAD}\n` +
      `<style>${DESIGN_CSS}</style>\n${TAILWIND_THEME}\n<script src="${TAILWIND_URL}"></script>\n</head>\n<body>\n` +
      `<div id="viewport"><div id="canvas">${content}</div></div>\n${DESIGN_TOOLBAR}\n<script>${DESIGN_SCRIPT}</script>\n</body>\n</html>\n`,
    print,
  );
}

// --- end design ---

function page(title: string, head: string, body: string, source: string): string {
  return (
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    `<title>${escapeHtml(title)}</title>\n` +
    `<style>${ERROR_PANEL_CSS}</style>\n` +
    `<script>${ERROR_PANEL_SCRIPT}</script>\n${head}\n${THEME_HEAD}\n</head>\n<body>\n${body}\n` +
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

// --- motion ---

const MOTION_PLAYER_CSS =
  ':host{all:initial}[hidden]{display:none!important}' +
  '.bar{box-sizing:border-box;display:flex;align-items:center;gap:8px;height:44px;padding:0 10px;background:rgba(17,24,39,.88);' +
  'color:#f9fafb;font:12px/1 system-ui,sans-serif;pointer-events:auto;transition:opacity .2s}' +
  '.bar.idle{opacity:0;pointer-events:none}' +
  'button{box-sizing:border-box;min-width:32px;height:32px;padding:0 8px;border:1px solid rgba(255,255,255,.25);border-radius:6px;' +
  'background:transparent;color:inherit;font:inherit;font-size:14px;cursor:pointer}' +
  'button:hover{background:rgba(255,255,255,.14)}button[aria-pressed=true]{background:#2563eb;border-color:#2563eb}' +
  'button:focus-visible,input:focus-visible{outline:2px solid #93c5fd;outline-offset:2px}' +
  'input{flex:1;min-width:40px;height:32px;margin:0;accent-color:#60a5fa}' +
  '.time{min-width:84px;text-align:center;font-variant-numeric:tabular-nums}' +
  '@media print{:host{display:none!important}}';

const MOTION_PLAYER_SCRIPT = `
(function () {
  try {
    var host = document.getElementById('artifact-motion-player');
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>${MOTION_PLAYER_CSS}</style><div class="bar" role="group" aria-label="Animation player">' +
      '<button type="button" id="play" aria-label="Pause">\\u275A\\u275A</button>' +
      '<button type="button" id="restart" aria-label="Restart">\\u21BA</button>' +
      '<input type="range" id="scrub" min="0" max="1000" step="10" value="0" aria-label="Timeline">' +
      '<span class="time" id="time" aria-hidden="true"></span>' +
      '<button type="button" id="loop" aria-label="Loop" aria-pressed="false">Loop</button></div>';
    var bar = root.querySelector('.bar'), playBtn = root.getElementById('play'), scrub = root.getElementById('scrub');
    var timeEl = root.getElementById('time'), loopBtn = root.getElementById('loop');
    var tracked = new Set(), duration = 0, t = 0, last = 0, raf = 0, hideTimer = 0, playing = false, loop = false;

    function each(fn) { tracked.forEach(fn); }
    function seek(ms) { t = ms; each(function (a) { a.currentTime = ms; }); }
    function collect() {
      document.getAnimations().forEach(function (a) {
        // The bar's own fade shows up in document.getAnimations(); it must not be controlled.
        if (tracked.has(a) || (a.effect && a.effect.target && a.effect.target.getRootNode() === root)) return;
        tracked.add(a);
        if (playing) a.play(); else a.pause();
        a.currentTime = t;
      });
      duration = 0;
      each(function (a) {
        var end = a.effect ? a.effect.getComputedTiming().endTime : 0;
        if (isFinite(end) && end > duration) duration = end;
      });
    }
    function format(ms) { return (ms / 1000).toFixed(1) + 's'; }
    function render() {
      var shown = Math.min(t, duration);
      scrub.hidden = timeEl.hidden = !duration;
      scrub.value = duration ? shown / duration * 1000 : 0;
      timeEl.textContent = format(shown) + ' / ' + format(duration);
      scrub.setAttribute('aria-valuetext', timeEl.textContent);
      playBtn.textContent = playing ? '\\u275A\\u275A' : '\\u25B6';
      playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    }
    function show() {
      bar.classList.remove('idle');
      clearTimeout(hideTimer);
      if (playing) hideTimer = setTimeout(function () {
        if (playing && !root.activeElement) bar.classList.add('idle');
      }, 2500);
    }
    function stop() {
      playing = false;
      cancelAnimationFrame(raf);
      each(function (a) { a.pause(); });
    }
    function tick() {
      var now = performance.now();
      t += now - last;
      last = now;
      collect();
      if (duration && t >= duration) {
        if (loop) { start(0); return; }
        stop();
        seek(duration);
        render();
        show();
        return;
      }
      render();
      raf = requestAnimationFrame(tick);
    }
    // play() rewinds a finished animation, so the clock is applied after it.
    function start(ms) {
      cancelAnimationFrame(raf);
      playing = true;
      each(function (a) { a.play(); });
      seek(ms);
      last = performance.now();
      raf = requestAnimationFrame(tick);
      render();
      show();
    }
    function pause() { stop(); seek(t); render(); show(); }

    playBtn.addEventListener('click', function () {
      if (playing) pause();
      else start(duration && t >= duration ? 0 : t);
    });
    root.getElementById('restart').addEventListener('click', function () { start(0); });
    loopBtn.addEventListener('click', function () {
      loop = !loop;
      loopBtn.setAttribute('aria-pressed', String(loop));
    });
    scrub.addEventListener('input', function () {
      stop();
      seek(scrub.value / 1000 * duration);
      render();
      show();
    });
    ['pointermove', 'pointerdown', 'keydown'].forEach(function (name) { document.addEventListener(name, show, true); });
    root.addEventListener('focusin', show);
    window.addEventListener('load', function () {
      var atEnd = !playing && t >= duration;
      collect();
      if (atEnd) seek(duration);
      render();
    });
    window.addEventListener('beforeprint', function () {
      stop();
      collect();
      seek(duration);
      render();
      host.style.display = 'none';
    });
    window.addEventListener('afterprint', function () { host.style.display = ''; });

    collect();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { stop(); seek(duration); render(); }
    else start(0);
  } catch (err) {
    console.error(err);
  }
})();
`;

// Trailing markup after </html> still runs, so the theme and player follow the artifact document unchanged.
function motionDocument(content: string, print: boolean): string {
  return withPrintScript(
    content +
      THEME_HEAD +
      '<div id="artifact-motion-player" style="position:fixed;left:0;right:0;bottom:0;z-index:2147483646;pointer-events:none"></div>' +
      `<script>${MOTION_PLAYER_SCRIPT}</script>`,
    print,
    true,
  );
}

// --- end motion ---

export function renderDocument(
  meta: Pick<ArtifactMeta, 'type' | 'language' | 'title'>,
  content: string,
  print = false,
): string {
  switch (meta.type) {
    case 'html':
      return withPrintScript(content + THEME_HEAD + `<script>${DIAGRAM_ZOOM_SCRIPT}</script>`, print, true);
    case 'svg':
      return withPrintScript(
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
          '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
          `<title>${escapeHtml(meta.title)}</title>\n` +
          '<style>html,body{margin:0;height:100%}body{display:grid;place-items:center;overflow:auto}' +
          `body>svg{max-width:100vw;max-height:100vh;width:auto;height:auto}</style>\n${THEME_HEAD}\n</head>\n` +
          `<body>\n${content}\n</body>\n</html>\n`,
        print,
        true,
      );
    case 'markdown':
      return withPrintScript(
        page(
          meta.title,
          `<link rel="stylesheet" href="${MARKDOWN_CSS_URL}">\n` +
            `<style>${SHELL_COLOR_SCHEME_CSS}${MARKDOWN_THEME_CSS}body{margin:0;background:var(--bg)}` +
            '.markdown-body{box-sizing:border-box;min-height:100vh;max-width:980px;margin:0 auto;padding:32px}' +
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
          `<style>${DESIGN_CSS}@media print{#canvas svg{max-width:100%;height:auto}}</style>`,
          // The canvas script runs after the diagram is inserted, so its first fit and readiness flag see the SVG.
          `<div id="viewport"><div id="canvas"></div></div>\n${DESIGN_TOOLBAR}\n` + moduleScript(MERMAID_SCRIPT + DESIGN_SCRIPT),
          content,
        ),
        print,
      );
    case 'code':
      return withPrintScript(
        page(
          meta.title,
          `<link rel="stylesheet" href="${HLJS_LIGHT_CSS_URL}" data-theme-css="light" media="(prefers-color-scheme: light)">\n` +
            `<link rel="stylesheet" href="${HLJS_DARK_CSS_URL}" data-theme-css="dark" media="(prefers-color-scheme: dark)">\n` +
            `<style>${SHELL_COLOR_SCHEME_CSS}body{margin:0;background:var(--bg)}pre{margin:0}` +
            'pre code.hljs{min-height:100vh;box-sizing:border-box;padding:16px;background:var(--bg);font:13px/1.5 var(--mono)}</style>',
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
            `<script src="${BABEL_URL}"></script>\n${TAILWIND_THEME}\n<script src="${TAILWIND_URL}"></script>`,
          '<div id="root"></div>\n' + moduleScript(REACT_SCRIPT) + `\n<script>${DIAGRAM_ZOOM_SCRIPT}</script>`,
          content,
        ),
        print,
      );
    case 'slides':
      return slidesDocument(meta.title, content, print);
    case 'design':
      return designDocument(meta.title, content, print);
    case 'motion':
      return motionDocument(content, print);
  }
}
