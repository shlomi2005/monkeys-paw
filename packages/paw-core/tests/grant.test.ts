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

  it('keeps a non-blank userStory, trimmed', async () => {
    const story = 'As a clinic owner, I want only owners to delete projects, so that nothing vanishes.';
    const model = fakeModel(() => ({ ...JSON.parse(VALID_GRANT_JSON), userStory: `  ${story}\n` }));
    const grant = await grantWish(makeWish(), model);

    expect(grant.userStory).toBe(story);
  });

  it('drops a blank userStory', async () => {
    const model = fakeModel(() => ({ ...JSON.parse(VALID_GRANT_JSON), userStory: '  \n ' }));
    const grant = await grantWish(makeWish(), model);

    expect('userStory' in grant).toBe(false);
  });

  it('keeps a valid EARS wishCriterion, trimmed', async () => {
    const criterion =
      'WHEN a user deletes a project THE SYSTEM SHALL allow it only for the project owner.';
    const model = fakeModel(() => ({ ...JSON.parse(VALID_GRANT_JSON), wishCriterion: `  ${criterion}\n` }));
    const grant = await grantWish(makeWish(), model);

    expect(grant.wishCriterion).toBe(criterion);
  });

  it('keeps a "THE SYSTEM SHALL" wishCriterion', async () => {
    const criterion = 'THE SYSTEM SHALL let only the project owner delete a project.';
    const model = fakeModel(() => ({ ...JSON.parse(VALID_GRANT_JSON), wishCriterion: criterion }));
    const grant = await grantWish(makeWish(), model);

    expect(grant.wishCriterion).toBe(criterion);
  });

  it.each([
    ['not EARS', 'Only the owner can delete a project.'],
    ['EARS keyword without SHALL', 'WHEN the owner deletes a project it is gone.'],
    ['SHALL without an EARS start', 'The system SHALL let the owner delete.'],
    ['blank', '  \n '],
  ])('drops a wishCriterion that is %s', async (_name, wishCriterion) => {
    const model = fakeModel(() => ({ ...JSON.parse(VALID_GRANT_JSON), wishCriterion }));
    const grant = await grantWish(makeWish(), model);

    expect('wishCriterion' in grant).toBe(false);
    expect(grant.curses.length).toBeGreaterThanOrEqual(3);
  });

  it('grants without a userStory when the model gives none', async () => {
    const model = fakeModel(() => VALID_GRANT_JSON);
    const grant = await grantWish(makeWish(), model);

    expect(grant.curses.length).toBeGreaterThanOrEqual(3);
    expect(grant.userStory).toBeUndefined();
  });

  it('assigns curse-N ids and keeps them when a generic curse is replaced', async () => {
    const replaceReplies: unknown[] = [];
    const model: ModelClient = {
      async generate(prompt: string): Promise<unknown> {
        if (prompt.includes('GRANT_WISH')) return VALID_GRANT_JSON;
        if (prompt.includes('JUDGE_BATCH_QUALITY')) {
          return JSON.stringify(
            ['curse-0', 'curse-1', 'curse-2'].map((curseId) => ({
              curseId,
              specific: curseId !== 'curse-1',
              reason: 'test',
            })),
          );
        }
        if (prompt.includes('REPLACE_CURSE')) {
          const reply = {
            type: 'edge-input',
            story: 'A replacement curse, specific to the wish.',
            loophole: 'replacement loophole words',
          };
          replaceReplies.push(reply);
          return JSON.stringify(reply);
        }
        throw new Error('unexpected prompt');
      },
    };

    const grant = await grantWish(makeWish(), model);

    expect(replaceReplies.length).toBeGreaterThan(0);
    expect(grant.curses.map((c) => c.id)).toEqual(['curse-0', 'curse-1', 'curse-2']);
    expect(grant.curses[1].type).toBe('edge-input');
    expect(grant.curses[1].loophole).toBe('replacement loophole words');
  });

  it('keeps the original id even if the model writes one for the replacement', async () => {
    const model: ModelClient = {
      async generate(prompt: string): Promise<unknown> {
        if (prompt.includes('GRANT_WISH')) return VALID_GRANT_JSON;
        if (prompt.includes('JUDGE_BATCH_QUALITY')) {
          return JSON.stringify(
            ['curse-0', 'curse-1', 'curse-2'].map((curseId) => ({
              curseId,
              specific: curseId !== 'curse-2',
              reason: 'test',
            })),
          );
        }
        return JSON.stringify({
          id: 'replaced',
          type: 'edge-input',
          story: 'A replacement curse, specific to the wish.',
          loophole: 'replacement loophole words',
        });
      },
    };

    const grant = await grantWish(makeWish(), model);

    expect(grant.curses.map((c) => c.id)).toEqual(['curse-0', 'curse-1', 'curse-2']);
  });
});
