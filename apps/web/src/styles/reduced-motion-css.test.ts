// Reduced motion in CSS (paw-web task 33, Req 8.2, design.md section 7). Every stylesheet that has an `animation`, a
// `transition` or `@keyframes` must collapse under `@media (prefers-reduced-motion: reduce)`, either with a rule in that
// media block for the same selector (`none`, or a duration of 1 ms or less) or through the `--dur-*` tokens, which
// tokens.css sets to 1 ms there. The test reads the stylesheets as text, so a new animation cannot slip in without it.

import { describe, expect, it } from 'vitest';
import { declarationsFor, parseCss, readSource, readText, sourceFiles } from './css-test-support';
import type { CssRule } from './css-test-support';

const REDUCED = '(prefers-reduced-motion: reduce)';
const MAX_MS = 1;

/** Every `*.module.css` under src, plus tokens.css. Paths relative to src, with forward slashes. */
function stylesheets(): string[] {
  return [...sourceFiles('.module.css'), 'styles/tokens.css'];
}

const tokenRules = parseCss(readText('./tokens.css', import.meta.url));
const reducedTokens = declarationsFor(tokenRules, ':root', REDUCED);
const baseTokens = declarationsFor(tokenRules, ':root', null);

function toMs(value: string): number | null {
  const match = /^(-?\d*\.?\d+)(ms|s)$/.exec(value.trim());
  if (match === null) return null;
  return Number(match[1]) * (match[2] === 's' ? 1000 : 1);
}

/** Splits at commas outside parentheses: `a 1s, b cubic-bezier(0, 1, 0, 1) 2s` gives two parts. */
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map((part) => part.trim());
}

/** `var(--dur-x)` becomes its value from the reduced block of tokens.css. Other `var()` are left alone. */
function withReducedTokens(value: string): string {
  return value.replace(/var\((--dur-[\w-]+)\)/g, (whole, name: string) => reducedTokens[name] ?? whole);
}

/** The time values of one comma part, in order. The first one is the duration (CSS shorthand rule). */
function timeValues(part: string): number[] {
  const out: number[] = [];
  for (const word of part.replace(/\([^)]*\)/g, ' ').split(/\s+/)) {
    const ms = toMs(word);
    if (ms !== null) out.push(ms);
  }
  return out;
}

type Kind = 'animation' | 'transition';

/** Declarations that set a duration: the shorthand or the `-duration` longhand. */
function durationDeclarations(rule: CssRule, kind: Kind): [string, string][] {
  return Object.entries(rule.declarations).filter(([name]) => name === kind || name === `${kind}-duration`);
}

/** True when every comma part of this declaration lasts MAX_MS or less, or is `none`. */
function declarationCollapses(name: string, value: string): boolean {
  const resolved = withReducedTokens(value);
  if (resolved.trim() === 'none') return name === 'animation' || name === 'transition';
  // A 1 ms loop is a flicker, not a collapse.
  if (/\binfinite\b/.test(resolved)) return false;
  return splitTopLevel(resolved).every((part) => {
    if (part === 'none') return true;
    const [first] = timeValues(part);
    return first !== undefined && first <= MAX_MS;
  });
}

/** What a rule asks for, with the reduced-motion rules for the same selector taken into account. */
function findUncollapsed(css: string): string[] {
  const rules = parseCss(css);
  const problems: string[] = [];
  for (const kind of ['animation', 'transition'] as const) {
    for (const rule of rules) {
      if (rule.media === REDUCED || rule.selector.startsWith('@')) continue;
      for (const [name, value] of durationDeclarations(rule, kind)) {
        if (declarationCollapses(name, value)) continue;
        // Not collapsed by its own value: a reduced-motion rule for the same selector must switch it off.
        const overrides = rules.filter((other) => other.media === REDUCED && other.selector === rule.selector);
        const covered = overrides.some((other) =>
          durationDeclarations(other, kind).some(([otherName, otherValue]) => declarationCollapses(otherName, otherValue)),
        );
        if (!covered) problems.push(`${rule.selector} { ${name}: ${value} }`);
      }
    }
  }
  return problems;
}

/** `@keyframes` without any animation that collapses leaves a stylesheet that animates under reduced motion. */
function hasKeyframes(css: string): boolean {
  return parseCss(css).some((rule) => rule.selector.startsWith('@keyframes'));
}

describe('reduced motion in CSS: the checker', () => {
  it('accepts durations from the --dur-* tokens, none, and a reduced-motion override of the same selector', () => {
    expect(findUncollapsed('.a { transition: opacity var(--dur-fade) ease-out; }')).toEqual([]);
    expect(findUncollapsed('.a { animation-duration: var(--dur-smoke); }')).toEqual([]);
    expect(findUncollapsed('.a { animation: none; }')).toEqual([]);
    expect(
      findUncollapsed(
        '.a { animation: x 2s ease; } @media (prefers-reduced-motion: reduce) { .a { animation: none; } }',
      ),
    ).toEqual([]);
    expect(
      findUncollapsed(
        '.a { transition: opacity 300ms; } @media (prefers-reduced-motion: reduce) { .a { transition-duration: 0.01ms; } }',
      ),
    ).toEqual([]);
  });

  it('catches a literal duration without a reduced-motion rule, and an override of a different selector', () => {
    expect(findUncollapsed('.a { transition: opacity 300ms ease-out; }')).toEqual(['.a { transition: opacity 300ms ease-out }']);
    expect(findUncollapsed('.a { animation: spin 2s infinite; }')).toHaveLength(1);
    expect(findUncollapsed('.a { animation-duration: 2s; }')).toHaveLength(1);
    expect(
      findUncollapsed('.a { animation: x 2s; } @media (prefers-reduced-motion: reduce) { .b { animation: none; } }'),
    ).toHaveLength(1);
    expect(
      findUncollapsed('.a { transition: a var(--dur-fade), b 2s; }'),
    ).toHaveLength(1);
  });

  it('does not accept a 1 ms loop that repeats forever', () => {
    expect(findUncollapsed('.a { animation: x var(--dur-smoke) infinite; }')).toHaveLength(1);
  });

  it('does not take a delay in a shorthand for its duration', () => {
    expect(findUncollapsed('.a { animation: x var(--dur-smoke) ease 2s; }')).toEqual([]);
    expect(findUncollapsed('.a { animation: x 2s ease var(--dur-smoke); }')).toHaveLength(1);
  });
});

describe('reduced motion in CSS: tokens.css', () => {
  it('sets every --dur-* token to 1 ms or less under prefers-reduced-motion: reduce', () => {
    const durTokens = Object.keys(baseTokens).filter((name) => name.startsWith('--dur-'));
    expect(durTokens.length).toBeGreaterThan(0);
    for (const name of durTokens) {
      const value = reducedTokens[name];
      expect(value, `${name} has no reduced-motion value`).toBeDefined();
      const ms = toMs(value ?? '');
      expect(ms, `${name}: ${String(value)}`).not.toBeNull();
      expect(ms ?? Infinity, name).toBeLessThanOrEqual(MAX_MS);
    }
  });

  it('turns the looping and pulsing animations off with their iteration tokens', () => {
    expect(reducedTokens['--loop-iterations']).toBe('0');
    expect(reducedTokens['--pulse-iterations']).toBe('0');
  });
});

describe('reduced motion in CSS: every stylesheet', () => {
  const files = stylesheets();

  it('finds the stylesheets', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain('styles/tokens.css');
    expect(files).toContain('components/Brazier.module.css');
  });

  it.each(files)('%s has no animation or transition that survives reduced motion', (file) => {
    const css = readSource(file);
    expect(findUncollapsed(css)).toEqual([]);
    if (hasKeyframes(css)) {
      // At least one animation in this file exists to play the keyframes, and all of them collapse (checked above).
      const animates = parseCss(css).some(
        (rule) => rule.media !== REDUCED && durationDeclarations(rule, 'animation').length > 0,
      );
      expect(animates, `${file} has @keyframes and no animation using them`).toBe(true);
    }
  });
});
