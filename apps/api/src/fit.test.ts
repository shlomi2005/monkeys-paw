import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { GrantSchema } from 'paw-core';
import { ExportRequestSchema } from './schemas';
import { cut, fitGrant } from './fit';

const text = (min: number, max: number) =>
  fc.array(fc.constantFrom('a', '\u00e9', '\ud83d\ude00', '\u0001'), { minLength: min, maxLength: max }).map((a) => a.join(''));

const makeGrant = (t: (min: number) => fc.Arbitrary<string>) => {
  const verdict = fc.record(
    { curseId: t(1), closed: fc.boolean(), reason: t(1), judgedAt: fc.double({ noNaN: true, noDefaultInfinity: true }), property: t(0) },
    { requiredKeys: ['curseId', 'closed', 'reason', 'judgedAt'] },
  );
  const binding = fc.record({
    curseId: t(1),
    kind: fc.constantFrom('rewrite', 'ears-clause'),
    clause: t(1),
    proposedAt: fc.double({ noNaN: true, noDefaultInfinity: true }),
  });
  const curse = fc.record(
    {
      id: t(1),
      type: fc.constantFrom('permissions', 'time', 'money', 'scale', 'abuse'),
      story: text(0, 150),
      loophole: t(1),
      status: fc.constantFrom('open', 'closed'),
      binding,
      verdict,
    },
    { requiredKeys: ['id', 'type', 'story', 'loophole', 'status'] },
  );
  return fc.record(
    {
      wishId: t(1),
      narration: text(1, 60),
      curses: fc.array(curse, { minLength: 3, maxLength: 5 }),
      userStory: t(0),
      wishCriterion: t(0),
    },
    { requiredKeys: ['wishId', 'narration', 'curses'] },
  );
};
const grant = makeGrant((min) => text(min, 3000));
const shortGrant = makeGrant((min) => text(min, 60));
const wish = { id: 'w', text: 'Only the owner can delete a project', createdAt: 1 };

describe('fitGrant', () => {
  it('turns any valid grant into one the export schema accepts', () => {
    fc.assert(
      fc.property(grant, (g) => {
        const parsed = GrantSchema.parse(g);
        const fitted = fitGrant(parsed);
        expect(ExportRequestSchema.safeParse({ wish, grant: fitted }).success).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('returns a grant within the caps deep-equal', () => {
    fc.assert(
      fc.property(shortGrant, (g) => {
        const parsed = GrantSchema.parse(g);
        expect(ExportRequestSchema.safeParse({ wish, grant: parsed }).success).toBe(true);
        expect(fitGrant(parsed)).toEqual(parsed);
      }),
      { numRuns: 200 },
    );
  });

  it('cut never splits a surrogate pair', () => {
    expect(cut('x'.repeat(999) + '\ud83d\ude00', 1000)).toBe('x'.repeat(999));
    expect(cut('abc', 3)).toBe('abc');
  });
});
