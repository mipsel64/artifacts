import { describe, expect, it } from 'vitest';
import skill from '../skills/artifacts/SKILL.md?raw';
import { THEME_CSS } from '../src/render';

describe('artifacts skill', () => {
  it('documents every theme token', () => {
    const tokens = new Set(THEME_CSS.match(/--[a-z0-9-]+(?=:)/g));
    expect(tokens.size).toBeGreaterThan(10);
    // The skill lists the chart series as a range.
    for (const token of tokens) if (!/^--chart-[2-5]$/.test(token)) expect(skill).toContain(`\`${token}\``);
  });
});
