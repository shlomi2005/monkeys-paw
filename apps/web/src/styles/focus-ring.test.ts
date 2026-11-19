// Focus ring (paw-web task 34, Req 8.1, design.md section 7): every focusable control shows the `--focus-ring-*`
// outline on `:focus-visible`. tokens.css sets it for every element; a component stylesheet may repeat it with the
// same tokens, and nothing may switch the outline off or replace it with other values. jsdom has no focus-visible
// matching, so this reads the stylesheets as text. contrast.test.ts holds the 3:1 floor of the ring colour.

import { describe, expect, it } from 'vitest';
import { controlTags, declarationsFor, parseCss, readSource, readText, selectorList, sourceFiles } from './css-test-support';
import type { CssRule } from './css-test-support';

const RING_OUTLINE = 'var(--focus-ring-width) solid var(--focus-ring-color)';
const RING_OFFSET = 'var(--focus-ring-offset)';

const OUTLINE_PROPERTIES = ['outline', 'outline-width', 'outline-style', 'outline-color', 'outline-offset'];

/** A value that hides the outline. */
function hidesOutline(property: string, value: string): boolean {
  const text = value.trim().toLowerCase();
  if (property === 'outline') return /^(none|0|0px|transparent)\b/.test(text) || /\b(none|transparent)\b/.test(text);
  if (property === 'outline-style') return text === 'none' || text === 'hidden';
  if (property === 'outline-width') return /^0(px)?$/.test(text);
  if (property === 'outline-color') return text === 'transparent';
  return false;
}

/** Everything wrong with how `css` handles outlines. */
function outlineProblems(css: string): string[] {
  const found: string[] = [];
  for (const rule of parseCss(css)) {
    if (rule.selector.startsWith('@')) continue;
    const focusVisible = selectorList(rule.selector).some((selector) => selector.includes(':focus-visible'));
    for (const property of OUTLINE_PROPERTIES) {
      const value = rule.declarations[property];
      if (value === undefined) continue;
      if (hidesOutline(property, value)) found.push(`${rule.selector} { ${property}: ${value} } hides the outline`);
      else if (!focusVisible) found.push(`${rule.selector} { ${property}: ${value} } sets an outline outside :focus-visible`);
    }
    if (focusVisible && rule.declarations['outline'] !== undefined && rule.declarations['outline'] !== RING_OUTLINE) {
      found.push(`${rule.selector} { outline: ${rule.declarations['outline']} } is not the ring tokens`);
    }
    if (focusVisible && rule.declarations['outline-offset'] !== undefined && rule.declarations['outline-offset'] !== RING_OFFSET) {
      found.push(`${rule.selector} { outline-offset: ${rule.declarations['outline-offset']} } is not the ring token`);
    }
  }
  return found;
}

describe('focus ring: the checker', () => {
  it('accepts the ring tokens on :focus-visible', () => {
    expect(
      outlineProblems(`.a:focus-visible { outline: ${RING_OUTLINE}; outline-offset: ${RING_OFFSET}; }`),
    ).toEqual([]);
  });

  it('catches outline: none, a transparent ring, other values, and an outline outside :focus-visible', () => {
    for (const css of [
      '.a:focus { outline: none; }',
      '.a:focus-visible { outline: 0; }',
      '.a:focus-visible { outline-style: none; }',
      '.a:focus-visible { outline: 1px solid red; }',
      '.a:focus-visible { outline: 3px solid transparent; }',
      '.a:focus-visible { outline-offset: 0; }',
      `.a { outline: ${RING_OUTLINE}; }`,
    ]) {
      expect(outlineProblems(css), css).not.toEqual([]);
    }
  });
});

describe('focus ring: tokens.css', () => {
  const tokens = parseCss(readText('./tokens.css', import.meta.url));

  it('defines the three ring tokens', () => {
    const root = declarationsFor(tokens, ':root', null);
    expect(root['--focus-ring-color']).toBeDefined();
    expect(root['--focus-ring-width']).toBeDefined();
    expect(root['--focus-ring-offset']).toBeDefined();
  });

  it('shows the ring on :focus-visible of every element, without a media query', () => {
    const rule = declarationsFor(tokens, ':focus-visible', null);
    expect(rule['outline']).toBe(RING_OUTLINE);
    expect(rule['outline-offset']).toBe(RING_OFFSET);
  });

  it('is not turned off for a reduced-motion, hover or size media query', () => {
    const overrides = tokens.filter((rule: CssRule) => rule.media !== null && rule.selector.includes('focus'));
    expect(overrides).toEqual([]);
  });
});

describe('focus ring: every stylesheet', () => {
  const files = [...sourceFiles('.module.css'), 'styles/tokens.css'];

  it.each(files)('%s does not hide or replace the ring', (file) => {
    expect(outlineProblems(readSource(file))).toEqual([]);
  });

  it('is not undone by a style attribute on a control', () => {
    for (const file of sourceFiles('.tsx')) {
      for (const control of controlTags(readSource(file))) {
        expect(control.source, `${file}: <${control.tag}>`).not.toMatch(/style=\{\{[^}]*outline/);
      }
    }
  });

  it('does not take a control out of the tab order with tabIndex -1', () => {
    for (const file of sourceFiles('.tsx')) {
      for (const control of controlTags(readSource(file))) {
        expect(control.source, `${file}: <${control.tag}>`).not.toMatch(/tabIndex=\{?-1/);
      }
    }
  });
});
