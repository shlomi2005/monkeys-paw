// Test support for the stylesheet tests: a small CSS reader, enough for tokens.css, fonts.css and the inline critical
// CSS in index.html. It understands rules, one level of @media nesting and plain declarations. App code never imports it.
// Files are read with node:fs: Vitest does not return the text of a `.css?raw` import unless CSS processing is on.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Reads a text file that sits relative to the importing module, e.g. readText('./tokens.css', import.meta.url). */
export function readText(relativePath: string, importMetaUrl: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, importMetaUrl)), 'utf8');
}

export interface CssRule {
  /** `:root`, `@font-face`, `.plate`, and so on. */
  readonly selector: string;
  /** The @media prelude this rule sits in, such as `(min-width: 768px)`, or null at top level. */
  readonly media: string | null;
  readonly declarations: Readonly<Record<string, string>>;
}

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

function parseDeclarations(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    const name = part.slice(0, colon).trim();
    if (name === '') continue;
    result[name] = collapse(part.slice(colon + 1));
  }
  return result;
}

/** Index of the brace that closes the one opened just before `from`. */
function closingBrace(css: string, from: number): number {
  let depth = 1;
  for (let i = from; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return i;
  }
  throw new Error('Unbalanced braces in CSS');
}

export function parseCss(source: string, media: string | null = null): CssRule[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  let cursor = 0;
  while (cursor < css.length) {
    const open = css.indexOf('{', cursor);
    if (open === -1) break;
    const prelude = collapse(css.slice(cursor, open));
    const close = closingBrace(css, open + 1);
    const body = css.slice(open + 1, close);
    if (prelude.startsWith('@media')) {
      rules.push(...parseCss(body, collapse(prelude.slice('@media'.length))));
    } else {
      rules.push({ selector: prelude, media, declarations: parseDeclarations(body) });
    }
    cursor = close + 1;
  }
  return rules;
}

/** Merges every declaration of `selector` inside `media` (null: top level), later rules winning. */
export function declarationsFor(rules: readonly CssRule[], selector: string, media: string | null): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const rule of rules) {
    if (rule.selector === selector && rule.media === media) Object.assign(merged, rule.declarations);
  }
  return merged;
}

/** Resolves `var(--name)` chains against a map of custom properties. */
export function resolveVars(value: string, vars: Readonly<Record<string, string>>, depth = 0): string {
  if (depth > 8) throw new Error(`var() chain too deep: ${value}`);
  return value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
    const found = vars[name];
    if (found === undefined) throw new Error(`Undefined custom property ${name}`);
    return resolveVars(found, vars, depth + 1);
  });
}

// ---------------------------------------------------------------------------
// Whole-app scans for the accessibility tests (hit areas, focus ring, reduced motion).
// ---------------------------------------------------------------------------

/** The `src` directory. A function, not a constant: tests in the jsdom environment import this file but never call it. */
function srcDir(): string {
  return fileURLToPath(new URL('..', import.meta.url));
}

/** Paths under `src` (forward slashes) that end in `suffix`, excluding test files. Sorted. */
export function sourceFiles(suffix: string): string[] {
  return readdirSync(srcDir(), { recursive: true, encoding: 'utf8' })
    .map((file) => file.split(path.sep).join('/'))
    .filter((file) => file.endsWith(suffix) && !/\.test\.[tj]sx?$/.test(file))
    .sort();
}

export function readSource(file: string): string {
  return readFileSync(path.join(srcDir(), file), 'utf8');
}

/** Selectors of a rule, split at top-level commas: `.a, .b:hover` gives two. */
export function selectorList(selector: string): string[] {
  return selector.split(',').map((part) => part.trim()).filter((part) => part !== '');
}

export interface ControlTag {
  /** `button`, `input`, `textarea`, `select` or `a`. */
  readonly tag: string;
  /** The text of the opening tag, from `<` to the closing `>`. */
  readonly source: string;
  /** Names used as `styles.name` inside the tag. */
  readonly classes: readonly string[];
}

const CONTROL_START = /<(button|input|textarea|select|a)(?=[\s/>])/g;

/** Removes block and line comments, so a button mentioned in a comment is not a control. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** End index (exclusive) of the opening tag that starts at `start`: the first `>` outside braces and quotes. */
function tagEnd(source: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || (char === '`' && depth > 0)) {
      quote = char;
    } else if (char === '{') depth++;
    else if (char === '}') depth--;
    else if (char === '>' && depth === 0 && source[i - 1] !== '=') return i + 1;
  }
  throw new Error('Unterminated JSX tag');
}

/** Every interactive element opened in a `.tsx` file: button, input, textarea, select and a. */
export function controlTags(tsx: string): ControlTag[] {
  const source = stripComments(tsx);
  const found: ControlTag[] = [];
  for (const match of source.matchAll(CONTROL_START)) {
    const start = match.index;
    const text = source.slice(start, tagEnd(source, start));
    found.push({
      tag: match[1] as string,
      source: text,
      classes: [...text.matchAll(/styles\.(\w+)/g)].map((m) => m[1] as string),
    });
  }
  return found;
}
