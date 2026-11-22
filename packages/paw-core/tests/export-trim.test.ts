import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { stripTrailingPunctuation } from '../src/export';

const old = (t: string) => t.replace(/[\s.!?;:,]+$/, '');
const ALPHABET = [' ', '\n', '\u00a0', '\ufeff', '\u2028', '.', '!', ',', 'a', '\ud83d', '\ud83d\ude00'];

describe('stripTrailingPunctuation', () => {
  it('equals the regex for every string up to 4 pieces', () => {
    let bad = 0;
    const walk = (s: string, depth: number) => {
      if (stripTrailingPunctuation(s) !== old(s)) bad++;
      if (depth === 0) return;
      for (const p of ALPHABET) walk(s + p, depth - 1);
    };
    walk('', 4);
    expect(bad).toBe(0);
  });
  it('equals the regex for each code unit alone and after a letter', () => {
    let bad = 0;
    for (let u = 0; u < 65536; u++) {
      const c = String.fromCharCode(u);
      if (stripTrailingPunctuation(c) !== old(c)) bad++;
      if (stripTrailingPunctuation('a' + c) !== old('a' + c)) bad++;
    }
    expect(bad).toBe(0);
  });
  it('equals the regex on short strings', () => {
    fc.assert(fc.property(
        fc.oneof(
          fc.array(fc.constantFrom(...ALPHABET), { maxLength: 12 }).map((a) => a.join('')),
          fc.string({ unit: 'binary', maxLength: 20 }),
        ),
        (t) => stripTrailingPunctuation(t) === old(t)));
  });
});
