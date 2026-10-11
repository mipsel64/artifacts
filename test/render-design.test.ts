import { describe, expect, it } from 'vitest';
import { renderDocument } from '../src/render';

const meta = { type: 'design', language: null, title: 'Flow <1>' } as const;
const fragment = '<div data-artboard="Home" style="width:390px;height:844px"><script>window.x = "</div>"</script></div>';

describe('renderDocument design', () => {
  const doc = renderDocument(meta, fragment);

  it('inserts the fragment raw inside the canvas, before the toolbar and script', () => {
    expect(doc).toContain(`<div id="viewport"><div id="canvas">${fragment}</div></div>`);
    expect(doc).not.toContain('artifact-source');
    expect(doc).toContain('<title>Flow &#60;1&#62;</title>');
    expect(doc.indexOf('id="toolbar"')).toBeGreaterThan(doc.indexOf(fragment));
  });

  it('loads Tailwind and keeps the artboard defaults in a layer ahead of it', () => {
    expect(doc).toContain('@tailwindcss/browser@4');
    expect(doc).toContain('@layer artboard, theme, base, components, utilities;');
    expect(doc.indexOf('@layer artboard,')).toBeLessThan(doc.indexOf('@tailwindcss/browser'));
  });

  it('has a labelled toolbar', () => {
    for (const label of ['Canvas zoom', 'Zoom out', 'Zoom in', 'Fit all to screen']) expect(doc).toContain(`aria-label="${label}"`);
    expect(doc).toContain('id="zoom-level" aria-label="Zoom 100%, reset to 100%"');
    expect(doc).toContain('#toolbar { display: none; }');
  });

  it('wraps top-level artboards in figures with textContent captions', () => {
    expect(doc).toContain("'[data-artboard]'");
    expect(doc).toContain("!el.parentElement.closest('[data-artboard]')");
    expect(doc).toContain("document.createElement('figure')");
    expect(doc).toContain("caption.textContent = el.getAttribute('data-artboard')");
    expect(doc).not.toContain('innerHTML');
  });

  it('pans on wheel and drag, zooms on ctrl or meta wheel, and ignores form controls', () => {
    expect(doc).toContain('{ passive: false }');
    expect(doc).toContain('e.ctrlKey || e.metaKey');
    expect(doc).toContain('setPointerCapture');
    expect(doc).toContain("e.target.closest('[data-artboard]')");
    expect(doc).toContain("closest('input,textarea,select,button,a')");
    expect(doc).toContain('new ResizeObserver(refit)');
    expect(doc).toContain("!(e.target.closest('#toolbar') && e.key !== ' ')");
  });

  it('signals readiness after the first fit, also on failure, and includes the error panel', () => {
    expect(doc).toMatch(/fit\(\);\s+window\.__artifactReady = true;\s+\} catch \(err\) \{\s+showError\(err\);\s+window\.__artifactReady = true;/);
    expect(doc.match(/artifact-error/g)).toHaveLength(3);
    expect(doc).toContain("addEventListener('unhandledrejection'");
  });

  it('scopes the canvas script so it never collides with globals of the artifact scripts', () => {
    expect(doc).toMatch(/<script>\n\(function \(\) \{\ntry \{\n  var viewport/);
    expect(doc).toMatch(/\}\n\}\)\(\);\n<\/script>\n<\/body>/);
  });

  it('pins an exact version in every CDN URL', () => {
    const urls = doc.match(/https:\/\/[^\s"'`<>)]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url).toMatch(/\/\*?(@[\w-]+\/)?[\w.-]+@\d+\.\d+\.\d+/);
  });

  it('waits for the script readiness flag in print mode', () => {
    const printed = renderDocument(meta, fragment, true);
    expect(printed).toContain('window.print()');
    expect(printed).not.toContain('<script>window.__artifactReady = true</script>');
  });
});
