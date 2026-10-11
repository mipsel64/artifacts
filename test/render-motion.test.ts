import { describe, expect, it } from 'vitest';
import { renderDocument } from '../src/render';

const meta = { type: 'motion', language: null, title: 'Demo' } as const;
const CONTENT = '<!doctype html><html><body><div style="animation:a 1s"></div></body></html>';

describe('renderDocument motion', () => {
  it('starts with the content and appends the player after it', () => {
    const doc = renderDocument(meta, CONTENT);
    expect(doc.startsWith(CONTENT)).toBe(true);
    const tail = doc.slice(CONTENT.length);
    expect(tail).toContain('id="artifact-motion-player"');
    expect(tail).toContain('attachShadow({ mode: \'open\' })');
    expect(tail).toContain('document.getAnimations()');
    expect(tail).toContain('getComputedTiming()');
    expect(tail).toContain('prefers-reduced-motion: reduce');
    expect(tail).toContain('beforeprint');
    expect(tail).not.toContain('window.print()');
  });

  it('labels every control', () => {
    const doc = renderDocument(meta, CONTENT);
    for (const label of ['Restart', 'Timeline', 'Loop']) expect(doc).toContain(`aria-label="${label}"`);
    expect(doc).toContain("playing ? 'Pause' : 'Play'");
    expect(doc).toContain('aria-pressed="false"');
    expect(doc).toContain('z-index:2147483646');
  });

  it('keeps the ready flag and print waiter after the player in print mode', () => {
    const doc = renderDocument(meta, CONTENT, true);
    expect(doc.startsWith(CONTENT)).toBe(true);
    const player = doc.indexOf('artifact-motion-player');
    const flag = doc.indexOf('window.__artifactReady = true');
    const waiter = doc.indexOf('window.print()');
    expect(player).toBeGreaterThan(-1);
    expect(flag).toBeGreaterThan(player);
    expect(waiter).toBeGreaterThan(flag);
  });
});
