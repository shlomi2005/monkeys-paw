import { describe, expect, it } from 'vitest';

import {
  BindResponseSchema,
  CurseSchema,
  ExamplesResponseSchema,
  GrantResponseSchema,
  GrantSchema,
  SpecExportSchema,
  VerdictSchema,
  WishSchema,
} from '../src/schemas';
import type {
  Curse,
  CurseType,
  Grant,
  IntegrityResult,
  SpecExport,
  Verdict,
} from '../src/types';

const TYPES: CurseType[] = [
  'permissions',
  'time',
  'money',
  'scale',
  'abuse',
  'privacy',
  'accessibility',
  'data-loss',
  'concurrency',
  'edge-input',
];

function makeCurse(i: number, type: CurseType): Curse {
  return {
    id: `c${i}`,
    type,
    story: `Curse ${i}: the wish is followed to the letter, and a real stakeholder suffers for it.`,
    loophole: `loophole words ${i}`,
    status: 'open',
  };
}

function makeGrant(n: number): Grant {
  const curses: Curse[] = [];
  for (let i = 0; i < n; i++) curses.push(makeCurse(i, TYPES[i % TYPES.length]));
  return { wishId: 'w1', narration: 'Granted, exactly as you asked.', curses };
}

describe('schema round-trip (P3)', () => {
  it('CurseSchema round-trips an open curse', () => {
    const c = makeCurse(0, 'permissions');
    expect(CurseSchema.parse(JSON.parse(JSON.stringify(c)))).toEqual(c);
  });

  it('GrantSchema round-trips for valid grants of size 3, 4, 5', () => {
    for (const n of [3, 4, 5]) {
      const g = makeGrant(n);
      // parse is identity for an already-valid grant
      expect(GrantSchema.parse(g)).toEqual(g);
      // serialize/deserialize round-trips
      expect(GrantSchema.parse(JSON.parse(JSON.stringify(g)))).toEqual(g);
    }
  });

  it('VerdictSchema round-trips', () => {
    const v: Verdict = {
      curseId: 'c1',
      closed: true,
      reason: 'The clause closes the loophole.',
      judgedAt: 123,
    };
    expect(VerdictSchema.parse(JSON.parse(JSON.stringify(v)))).toEqual(v);
  });

  it('SpecExportSchema round-trips', () => {
    const integrity: IntegrityResult = { score: 4, total: 5, closed: 4, open: 1 };
    const s: SpecExport = {
      wishId: 'w1',
      requirementsMd: '# requirements\n',
      propertiesMd: '# properties\n',
      integrity,
    };
    expect(SpecExportSchema.parse(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});

describe('schema rejection of invalid input', () => {
  it('rejects fewer than 3 curses', () => {
    expect(() => GrantSchema.parse(makeGrant(2))).toThrow();
    expect(() =>
      GrantSchema.parse({ wishId: 'w1', narration: 'n', curses: [] }),
    ).toThrow();
  });

  it('rejects more than 5 curses', () => {
    expect(() => GrantSchema.parse(makeGrant(6))).toThrow();
  });

  it('rejects an invented curse type tag', () => {
    const bad = makeGrant(3);
    bad.curses[0] = { ...bad.curses[0], type: 'not-a-tag' as CurseType };
    expect(() => GrantSchema.parse(bad)).toThrow();
  });

  it('rejects a missing wishId', () => {
    const { narration, curses } = makeGrant(3);
    expect(() => GrantSchema.parse({ narration, curses })).toThrow();
  });

  it('rejects an empty loophole', () => {
    const bad = makeGrant(3);
    bad.curses[0] = { ...bad.curses[0], loophole: '' };
    expect(() => GrantSchema.parse(bad)).toThrow();
  });
});

describe('Wish and response envelope schemas (paw-web task 2)', () => {
  const wish = { id: 'w1', text: 'Only the owner can delete a project', createdAt: 1 };
  const grant: Grant = {
    wishId: 'w1',
    narration: 'Granted, exactly as written.',
    curses: [
      makeCurse(1, 'permissions'),
      makeCurse(2, 'time'),
      makeCurse(3, 'abuse'),
    ],
  };
  const verdict: Verdict = {
    curseId: 'c1',
    closed: true,
    reason: 'The clause covers the owner leaving.',
    judgedAt: 2,
  };

  it('WishSchema accepts a valid wish, with and without context', () => {
    expect(WishSchema.safeParse(wish).success).toBe(true);
    expect(WishSchema.safeParse({ ...wish, context: 'a project tool' }).success).toBe(true);
  });

  it('WishSchema trims the text and rejects blank text with the original message', () => {
    expect(WishSchema.parse({ ...wish, text: '  padded  ' }).text).toBe('padded');
    for (const text of ['', '   ', '\n\t']) {
      const result = WishSchema.safeParse({ ...wish, text });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('Wish text cannot be empty');
      }
    }
  });

  it('GrantResponseSchema accepts a valid grant envelope', () => {
    expect(GrantResponseSchema.safeParse({ wish, grant }).success).toBe(true);
  });

  it('BindResponseSchema accepts a bind envelope', () => {
    expect(BindResponseSchema.safeParse({ grant, verdict }).success).toBe(true);
  });

  it('ExamplesResponseSchema accepts an array of wish and grant pairs, including empty', () => {
    expect(ExamplesResponseSchema.safeParse([{ wish, grant }, { wish, grant }]).success).toBe(true);
    expect(ExamplesResponseSchema.safeParse([]).success).toBe(true);
  });

  it('rejects the wrong shape', () => {
    expect(WishSchema.safeParse({ id: 'w1', text: 'x' }).success).toBe(false);
    expect(GrantResponseSchema.safeParse({ wish, grant: { wishId: 'w1' } }).success).toBe(false);
    expect(GrantResponseSchema.safeParse({ grant }).success).toBe(false);
    expect(BindResponseSchema.safeParse({ grant }).success).toBe(false);
    expect(ExamplesResponseSchema.safeParse({ wish, grant }).success).toBe(false);
    expect(ExamplesResponseSchema.safeParse([{ wish }]).success).toBe(false);
  });
});
