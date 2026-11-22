import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { READY_ROUNDS } from '../state/ready-rounds';
import { hasOwnQuotes } from './quote-marks';

const STARTS = ['"', "'", '\u201C', '\u201D', '\u2018', '\u2019', '\u201E', '\u201A', '\u201F', '\u00AB', '\u00BB', '\u2039', '\u203A', '\u300C', '\u300E'];
const ENDS = ['"', '\u201C', '\u201D', '\u201E', '\u201F', '\u00AB', '\u00BB', '\u300D', '\u300F'];

describe('hasOwnQuotes', () => {
  it.each(STARTS)('is true for the start mark %s', (m) => expect(hasOwnQuotes(`${m}Nobody may delete it`)).toBe(true));
  it.each(ENDS)('is true for the end mark %s', (m) => expect(hasOwnQuotes(`Nobody may delete it${m}`)).toBe(true));
  it.each([
    ['padded', '  \u201CNobody may delete it\u201D \n', true],
    ['a whole quote', '"Nobody may delete it"', true],
    ['only internal quotes', 'Nobody "may" delete it', false],
    ["a trailing users'", "Nobody but the users'", false],
    ['plain', 'Nobody may delete it', false],
    ['empty', '', false],
    ['blank', '   ', false],
  ])('%s', (_name, text, expected) => expect(hasOwnQuotes(text)).toBe(expected));

  it('is true whenever the trimmed text starts with a double quote', () => {
    fc.assert(fc.property(fc.string(), fc.string(), (pad, rest) => hasOwnQuotes(`${pad.replace(/\S/g, ' ')}"${rest}`)));
  });
  it('is always false for plain letters and spaces', () => {
    fc.assert(fc.property(fc.stringMatching(/^[A-Za-z ]*$/), (text) => !hasOwnQuotes(text)));
  });
  it('is true for all nine loopholes of the ready rounds', () => {
    const loopholes = READY_ROUNDS.flatMap((round) => round.grant.curses.map((c) => c.loophole));
    expect(loopholes).toHaveLength(9);
    for (const l of loopholes) expect(hasOwnQuotes(l), l).toBe(true);
  });
});
