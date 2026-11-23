import { describe, expect, it } from 'vitest';

import { grantWish, isFallbackGrant, isFallbackVerdict, judgeBinding, proposeBinding } from '../src/index';
import type { Curse, Grant, ModelClient, Verdict, Wish } from '../src/index';

const WISH: Wish = {
  id: 'w1',
  text: 'Only the owner can delete a project',
  context: 'a clinic booking app',
  createdAt: 1_700_000_000_000,
};

const CURSE: Curse = {
  id: 'curse-0',
  type: 'permissions',
  story: 'The owner quits; nobody can delete the project.',
  loophole: 'Only the owner can delete',
  status: 'open',
};

const failingModel: ModelClient = {
  async generate(): Promise<unknown> {
    throw new Error('upstream failure');
  },
};

const VALID_GRANT_JSON = JSON.stringify({
  narration: 'Granted. The system deletes exactly what the owner deletes.',
  curses: [
    {
      type: 'permissions',
      story: 'The owner quits the company. Granted: nobody may delete the project, ever.',
      loophole: 'Only the owner can delete a project',
    },
    {
      type: 'time',
      story: 'The owner deletes it at 23:59 UTC; the audit log shows it gone first.',
      loophole: 'can delete a project',
    },
    {
      type: 'scale',
      story: 'A bulk import creates a million projects, each deletable one tap at a time.',
      loophole: 'a project',
    },
  ],
});

/** Answers the grant and the quality judge for real; any other prompt fails. */
const realGrantModel: ModelClient = {
  async generate(prompt: string): Promise<unknown> {
    if (prompt.includes('GRANT_WISH')) return VALID_GRANT_JSON;
    if (prompt.includes('JUDGE_BATCH_QUALITY') || prompt.includes('JUDGE_QUALITY')) {
      return JSON.stringify(
        ['curse-0', 'curse-1', 'curse-2'].map((curseId) => ({ curseId, specific: true, reason: 'specific' })),
      );
    }
    throw new Error('unexpected prompt');
  },
};

describe('isFallbackGrant (Req 2.7)', () => {
  it('is true for the fallback of a failing model', async () => {
    const grant = await grantWish(WISH, failingModel);
    expect(grant.curses[0]?.id).toBe('fallback-curse');
    expect(isFallbackGrant(grant)).toBe(true);
  });

  it('is true for the fallback when every answer fails validation', async () => {
    const grant = await grantWish(WISH, { generate: async () => '{"narration":1}' });
    expect(isFallbackGrant(grant)).toBe(true);
  });

  it('is false for a real grant', async () => {
    const grant = await grantWish(WISH, realGrantModel);
    expect(grant.curses.length).toBe(3);
    expect(isFallbackGrant(grant)).toBe(false);
  });

  it('is false for a real grant whose quality judge failed', async () => {
    const model: ModelClient = {
      async generate(prompt: string): Promise<unknown> {
        if (prompt.includes('GRANT_WISH')) return VALID_GRANT_JSON;
        throw new Error('judge failure');
      },
    };
    const grant = await grantWish(WISH, model);
    expect(grant.curses.length).toBe(3);
    expect(isFallbackGrant(grant)).toBe(false);
  });

  it('is false for an object literal or a structuredClone that copies the fallback exactly', async () => {
    const fallback = await grantWish(WISH, failingModel);
    const literal: Grant = {
      wishId: fallback.wishId,
      narration: fallback.narration,
      curses: fallback.curses.map((curse) => ({ ...curse })),
    };
    expect(literal).toEqual(fallback);
    expect(isFallbackGrant(literal)).toBe(false);
    expect(isFallbackGrant(structuredClone(fallback))).toBe(false);
  });
});

describe('isFallbackVerdict (Req 2.7)', () => {
  const binding = proposeBinding(CURSE, 'Admins can also delete', 'ears-clause');

  it('is true for the fallback of a failing model', async () => {
    const verdict = await judgeBinding(CURSE, binding, failingModel);
    expect(verdict.reason).toContain('could not be roused');
    expect(isFallbackVerdict(verdict)).toBe(true);
  });

  it('is false for a real verdict, closed or open', async () => {
    for (const closed of [true, false]) {
      const model: ModelClient = {
        generate: async () => ({ curseId: CURSE.id, closed, reason: 'The Judge has spoken.', judgedAt: 0 }),
      };
      const verdict = await judgeBinding(CURSE, binding, model);
      expect(verdict.closed).toBe(closed);
      expect(isFallbackVerdict(verdict)).toBe(false);
    }
  });

  it('is false for a real verdict that copies the fallback text', async () => {
    const model: ModelClient = {
      generate: async () => ({
        curseId: CURSE.id,
        closed: false,
        reason: 'The Judge could not be roused; the loophole remains open.',
        judgedAt: 0,
      }),
    };
    expect(isFallbackVerdict(await judgeBinding(CURSE, binding, model))).toBe(false);
  });

  it('is false for an object literal or a structuredClone that copies the fallback exactly', async () => {
    const fallback = await judgeBinding(CURSE, binding, failingModel);
    const literal: Verdict = { ...fallback };
    expect(literal).toEqual(fallback);
    expect(isFallbackVerdict(literal)).toBe(false);
    expect(isFallbackVerdict(structuredClone(fallback))).toBe(false);
  });
});
