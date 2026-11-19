// Hit areas (paw-web task 34, Req 9.3, design.md section 7): every interactive control is at least 48 px high, and at
// least 48 px wide unless it fills its row. jsdom cannot measure, so this reads the source as text. It finds every
// `<button>`, `<input>`, `<textarea>`, `<select>` and `<a>` in the .tsx files, takes the `styles.x` classes on the tag,
// and reads `min-height` or `height` (and `min-width` or `width`) of those classes in the component's module CSS.
// `rem` counts as 16 px, the floor of the root font size (tokens.css); `var(--x)` resolves to the smallest value any
// stylesheet gives that custom property. A new control without a class, or with a class under 48 px, fails here.

import { describe, expect, it } from 'vitest';
import { controlTags, parseCss, readSource, selectorList, sourceFiles } from './css-test-support';
import type { CssRule } from './css-test-support';

const MIN_PX = 48;
const ROOT_PX = 16;

const stylesheets = sourceFiles('.module.css').concat('styles/tokens.css');
const rulesByFile = new Map<string, CssRule[]>(stylesheets.map((file) => [file, parseCss(readSource(file))]));

type Props = ReadonlyMap<string, number>;

/** A plain length (`48px`, `3rem`) or `var(--x)` of one, in pixels. Anything else (calc, %, auto) is null. */
function lengthToPx(value: string, props: Props): number | null {
  const text = value.trim();
  const variable = /^var\((--[\w-]+)\)$/.exec(text);
  if (variable !== null) return props.get(variable[1] as string) ?? null;
  const length = /^(\d*\.?\d+)(px|rem)$/.exec(text);
  if (length === null) return null;
  return Number(length[1]) * (length[2] === 'rem' ? ROOT_PX : 1);
}

/** Smallest pixel value that the given rules give each custom property. Values that are not plain lengths are skipped. */
function customProperties(ruleSets: Iterable<readonly CssRule[]>): Props {
  const found = new Map<string, number>();
  for (const rules of ruleSets) {
    for (const rule of rules) {
      for (const [name, value] of Object.entries(rule.declarations)) {
        if (!name.startsWith('--')) continue;
        const px = lengthToPx(value, found);
        if (px !== null) found.set(name, Math.min(px, found.get(name) ?? Infinity));
      }
    }
  }
  return found;
}

const appProps = customProperties(rulesByFile.values());

type Axis = 'height' | 'width';

/** Every value (in any media query) that rules for exactly `.name` give to `min-<axis>` or `<axis>`. */
function sizesOf(rules: readonly CssRule[], name: string, axis: Axis): string[] {
  const values: string[] = [];
  for (const rule of rules) {
    if (!selectorList(rule.selector).includes(`.${name}`)) continue;
    for (const property of [`min-${axis}`, axis]) {
      const value = rule.declarations[property];
      if (value !== undefined) values.push(value);
    }
  }
  return values;
}

/** Why a control passes or not. `null` is a pass. */
function hitAreaProblem(
  rules: readonly CssRule[],
  classes: readonly string[],
  tag: string,
  props: Props,
): string | null {
  if (classes.length === 0) return 'has no styles.x class, so nothing gives it a size';
  for (const axis of ['height', 'width'] as const) {
    const values = classes.flatMap((name) => sizesOf(rules, name, axis));
    // A control that fills its row is wide enough; only the height is checked for it.
    const fillsRow = axis === 'width' && values.some((value) => value.trim() === '100%');
    if (fillsRow) continue;
    // Text fields are as wide as their row or grid area: only buttons and links need a width.
    if (axis === 'width' && (tag === 'input' || tag === 'textarea' || tag === 'select')) continue;
    const px = values.map((value) => lengthToPx(value, props));
    if (px.length === 0) return `sets no min-${axis} or ${axis}`;
    const small = values.filter((_, index) => px[index] === null || (px[index] as number) < MIN_PX);
    if (small.length > 0) return `has ${axis} ${small.join(' and ')}, under ${MIN_PX} px or not a plain length`;
  }
  return null;
}

/** The custom properties default to those of the whole app; the checker tests pass their own stylesheet's. */
function problems(css: string, tsx: string, props?: Props): string[] {
  const rules = parseCss(css);
  const known = props ?? customProperties([rules]);
  return controlTags(tsx)
    .map((control) => {
      const problem = hitAreaProblem(rules, control.classes, control.tag, known);
      return problem === null ? null : `<${control.tag} ${control.classes.map((c) => `.${c}`).join(' ')}> ${problem}`;
    })
    .filter((problem) => problem !== null);
}

describe('hit areas: the checker', () => {
  it('accepts rem, px, a custom property and a full-width field', () => {
    expect(problems('.a { min-width: 48px; min-height: 3rem; }', '<button className={styles.a} />')).toEqual([]);
    expect(problems('.r { --d: 60px; } .a { width: var(--d); height: var(--d); }', '<button className={styles.a} />')).toEqual([]);
    expect(problems('.a { width: 100%; min-height: 3rem; }', '<input className={styles.a} />')).toEqual([]);
    expect(problems('.a, .b { min-width: 48px; min-height: 3rem; }', '<button className={cx(styles.b, x && styles.c)} />')).toEqual([]);
  });

  it('catches a control that is too small, unsized or without a class', () => {
    expect(problems('.a { min-width: 48px; min-height: 40px; }', '<button className={styles.a} />')).toHaveLength(1);
    expect(problems('.a { min-height: 3rem; }', '<button className={styles.a} />')).toHaveLength(1);
    expect(problems('.a { min-height: 2.5rem; min-width: 3rem; }', '<button className={styles.a} />')).toHaveLength(1);
    expect(problems('.a { min-height: 3rem; }', '<button type="button" />')).toHaveLength(1);
    expect(problems('.a { min-height: 3rem; }', '<a href="#" className={styles.a} />')).toHaveLength(1);
  });

  it('catches a size a media query takes below the minimum', () => {
    const css = '.a { min-width: 48px; min-height: 3rem; } @media (max-width: 500px) { .a { min-height: 30px; } }';
    expect(problems(css, '<button className={styles.a} />')).toHaveLength(1);
  });

  it('does not take a button named in a comment or a type parameter for a control', () => {
    expect(controlTags('// A <button> here\n/* <input /> */\nconst x = Array<string>();')).toEqual([]);
    expect(controlTags('<button onClick={() => go()} className={styles.a}>Go</button>')).toHaveLength(1);
  });
});

describe('hit areas: every control in the app', () => {
  const components = sourceFiles('.tsx').filter((file) => controlTags(readSource(file)).length > 0);

  it('finds the components with controls', () => {
    expect(components).toEqual(
      expect.arrayContaining([
        'components/BindingCard.tsx',
        'components/CurseCircle.tsx',
        'components/ExampleCard.tsx',
        'components/StopButton.tsx',
        'components/WishLine.tsx',
      ]),
    );
  });

  it.each(components)('%s: every control is at least 48 px high and wide', (file) => {
    const tsx = readSource(file);
    const imported = /import styles from '\.\/([\w-]+\.module\.css)'/.exec(tsx);
    expect(imported, `${file} uses controls and imports no module CSS`).not.toBeNull();
    const cssFile = `${file.slice(0, file.lastIndexOf('/') + 1)}${imported?.[1] ?? ''}`;
    expect(problems(readSource(cssFile), tsx, appProps)).toEqual([]);
  });
});
