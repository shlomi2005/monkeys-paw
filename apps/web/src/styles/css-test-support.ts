// Test support for the stylesheet tests: a small CSS reader, enough for tokens.css, fonts.css and the inline critical
// CSS in index.html. It understands rules, one level of @media nesting and plain declarations. App code never imports it.
// Files are read with node:fs: Vitest does not return the text of a `.css?raw` import unless CSS processing is on.

import { readFileSync } from 'node:fs';
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
