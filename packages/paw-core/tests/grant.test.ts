import { describe, expect, it } from 'vitest';

import { grantWish } from '../src/grant';
import { CurseTypeSchema } from '../src/schemas';
import type { ModelClient, Wish } from '../src/types';

const VALID_GRANT_JSON = JSON.stringify({
  narration:
    'Granted. The system deletes exactly what the owner deletes — and only exactly that.',
  curses: [
    {
      id: 'c1',
      type: 'permissions',
      story:
        'The owner quits the company. Granted: nobody may delete the project, ever.',
      loophole: 'Only the owner can delete a project',
    },
    {
      id: 'c2',
      type: 'time',
      story:
        'The owner deletes it at 23:59 UTC; the audit log shows it gone before the deadline was ever checked.',
      loophole: 'can delete a project',
    },
    {
      id: 'c3',
      type: 'scale',
      story:
        'A bulk import creates a million projects, each deletable by the owner, one tap at a time.',
      loophole: 'a project',
    },
  ],
});

function makeWish(): Wish {
  return {
    id: 'w1',
    text: 'Only the owner can delete a project',
    context: 'a clinic booking app',
    createdAt: 1_700_000_000_000,
  };
}

/** A fake ModelClient that dispatches on the prompt's leading "Task:" label. */
function fakeModel(grantResponse: (callNum: number) => unknown): ModelClient {
  let grantCalls = 0;
  return {
    async generate(prompt: string): Promise<unknown> {
      if (prompt.includes('GRANT_WISH')) {
        grantCalls += 1;
        return grantResponse(grantCalls);
      }
      if (prompt.includes('JUDGE_QUALITY')) {
        return JSON.stringify({
          specific: true,
          reason: 'The curse quotes the wish words that create the loophole.',
        });
      }
      if (prompt.includes('REPLACE_CURSE')) {
        return JSON.stringify({
          id: 'replaced',
          type: 'edge-input',
          story: 'A replacement curse, specific to the wish.',
          loophole: 'replacement loophole words',
        });
      }
      if (prompt.includes('JUDGE_VERDICT')) {
        return JSON.stringify({ curseId: 'x', closed: true, reason: 'closed', judgedAt: 0 });
      }
      throw new Error(`fake model: unexpected prompt:\n${prompt.slice(0, 80)}`);
    },
  };
}

describe('grantWish (task 9)', () => {
  it('returns a valid Grant with 3–5 curses for valid model JSON', async () => {
    const model = fakeModel(() => VALID_GRANT_JSON);
    const grant = await grantWish(makeWish(), model);

    expect(grant.wishId).toBe('w1');
    expect(grant.narration.length).toBeGreaterThan(0);
    expect(grant.curses.length).toBeGreaterThanOrEqual(3);
    expect(grant.curses.length).toBeLessThanOrEqual(5);

    const types = grant.curses.map((c) => c.type);
    for (const curse of grant.curses) {
      // P6: every type is a real taxonomy tag.
      expect(CurseTypeSchema.safeParse(curse.type).success).toBe(true);
      // Newly granted curses start open (the finger is curled).
      expect(curse.status).toBe('open');
      // Req 2.3: every curse points to the exact words that create the loophole.
      expect(curse.loophole.length).toBeGreaterThan(0);
    }
    // P7: distinct types per grant.
    expect(new Set(types).size).toBe(types.length);
  });

  it('retries once on invalid JSON, then succeeds', async () => {
    const model = fakeModel((n) => (n === 1 ? 'definitely not json' : VALID_GRANT_JSON));
    const grant = await grantWish(makeWish(), model);

    expect(grant.wishId).toBe('w1');
    expect(grant.curses.length).toBeGreaterThanOrEqual(3);
    expect(grant.curses.length).toBeLessThanOrEqual(5);
  });

  it('falls back to a fallback grant after two failures', async () => {
    const model = fakeModel(() => 'definitely not json');
    const grant = await grantWish(makeWish(), model);

    expect(grant.wishId).toBe('w1');
    // The safe default: a single generic open curse (Req 2.5 / design §Error Handling).
    expect(grant.curses).toHaveLength(1);
    expect(grant.narration.length).toBeGreaterThan(0);
    expect(grant.curses[0].status).toBe('open');
  });
});
