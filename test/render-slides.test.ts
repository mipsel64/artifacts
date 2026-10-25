import { describe, expect, it } from 'vitest';
import { renderDocument } from '../src/render';

const doc = await renderDocument({ type: 'slides', language: null, title: 'Deck' }, '# One\n\n---\n\n# Two');

describe('renderDocument slides', () => {
  it('embeds the source and splits marked tokens on hr', () => {
    expect(doc).toContain('marked@');
    expect(doc).toContain('marked.lexer(source)');
    expect(doc).toContain("t.type === 'hr'");
    expect(doc).toContain('marked.parser(');
    expect(doc).toContain('tokens.links');
    expect(doc).toContain('id="artifact-source"');
  });

  it('labels each slide with its position', () => {
    expect(doc).toContain("setAttribute('aria-roledescription', 'slide')");
    expect(doc).toContain("(i + 1) + ' of ' + groups.length");
  });

  it('sizes a slide 1280x720 scaled to fit', () => {
    expect(doc).toContain('width:1280px;height:720px');
    expect(doc).toContain('innerWidth / 1280');
    expect(doc).toContain('innerHeight / 720');
    expect(doc).toContain('scale(var(--s,1))');
  });

  it('keeps theme selectors overridable by agent styles', () => {
    expect(doc).toContain(':where(.slide h1)');
    expect(doc).toContain('font-size:64px');
  });

  it('handles navigation keys and ignores interactive targets', () => {
    for (const key of ['ArrowRight', 'ArrowDown', 'PageDown', "' '", 'ArrowLeft', 'ArrowUp', 'PageUp', 'Home', 'End'])
      expect(doc).toContain(key);
    expect(doc).toContain("'f'");
    expect(doc).toContain('document.fullscreenEnabled');
    expect(doc).toContain('input,textarea,select,button,a,[contenteditable]');
    expect(doc).not.toContain('location.hash');
    expect(doc).not.toContain('history.');
  });

  it('has labelled control buttons and a live counter', () => {
    expect(doc).toContain('<button type="button" id="prev" aria-label="Previous slide">');
    expect(doc).toContain('<button type="button" id="next" aria-label="Next slide">');
    expect(doc).toContain('aria-label="Toggle fullscreen"');
    expect(doc).toContain('id="counter" aria-live="polite"');
    expect(doc).toContain('#controls:hover,#controls:focus-within{opacity:1}');
  });

  it('prints one 1280x720 slide per page without controls', () => {
    expect(doc).toContain('@page{size:1280px 720px;margin:0}');
    expect(doc).toContain('break-after:page');
    expect(doc).toContain('.slide:last-child{break-after:auto}');
    expect(doc).toContain('#controls{display:none}');
  });

  it('reports errors and signals readiness', () => {
    expect(doc).toContain('showError(err)');
    expect(doc).toContain('window.__artifactReady = true');
  });
});
