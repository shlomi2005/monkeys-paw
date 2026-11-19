import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SNIPPET_MAX_LENGTH, snippet } from './snippet';

describe('snippet', () => {
  it('returns short text unchanged', () => {
    expect(snippet('Only the owner can delete a project')).toBe('Only the owner can delete a project');
  });

  it('keeps text of exactly the limit without an ellipsis', () => {
    const text = 'a'.repeat(SNIPPET_MAX_LENGTH);
    expect(snippet(text)).toBe(text);
  });

  it('cuts longer text to the limit and ends with an ellipsis', () => {
    const result = snippet('a'.repeat(SNIPPET_MAX_LENGTH + 1));
    expect(Array.from(result)).toHaveLength(SNIPPET_MAX_LENGTH);
    expect(result.endsWith('…')).toBe(true);
  });

  it('collapses whitespace and never splits an emoji', () => {
    expect(snippet('a \n  b')).toBe('a b');
    const result = snippet('🐒'.repeat(80));
    expect(result).toBe(`${'🐒'.repeat(SNIPPET_MAX_LENGTH - 1)}…`);
  });

  it('is never longer than the limit and is a prefix of the cleaned text (property)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        const result = snippet(text);
        const clean = text.replace(/\s+/g, ' ').trim();
        expect(Array.from(result).length).toBeLessThanOrEqual(SNIPPET_MAX_LENGTH);
        if (result.endsWith('…') && result !== clean) expect(clean.startsWith(result.slice(0, -1))).toBe(true);
        else expect(result).toBe(clean);
      }),
    );
  });
});
