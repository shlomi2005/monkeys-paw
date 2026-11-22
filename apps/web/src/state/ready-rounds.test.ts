// The three ready rounds (paw-web Req 13.7): valid against the paw-core schemas, real EARS clauses, golden texts.

import { readFileSync } from 'node:fs';
import { GrantSchema, VerdictSchema, WishSchema, isEarsCriterion } from 'paw-core';
import { describe, expect, it } from 'vitest';
import { READY_ROUNDS, isReadyRound, readyClauseOf } from './ready-rounds';

interface Golden {
  readonly id: string;
  readonly wish: string;
  readonly context: string;
}

const golden = JSON.parse(readFileSync(new URL('../../../../docs/golden-wishes.json', import.meta.url), 'utf8')) as Golden[];

const sentences = (text: string): string[] => text.split(/(?<=[.!?])\s+/).filter((part) => part !== '');

describe('ready rounds', () => {
  it('are three rounds with three curses each', () => {
    expect(READY_ROUNDS).toHaveLength(3);
    for (const round of READY_ROUNDS) expect(round.grant.curses).toHaveLength(3);
  });

  it('use the text and the context of a golden wish, word for word', () => {
    for (const round of READY_ROUNDS) {
      const match = golden.find((g) => g.wish === round.wish.text);
      expect(match, round.wish.text).toBeDefined();
      expect(round.wish.context).toBe(match?.context);
    }
    expect(new Set(READY_ROUNDS.map((round) => round.wish.text)).size).toBe(3);
  });

  it('pass the paw-core schemas', () => {
    for (const round of READY_ROUNDS) {
      expect(WishSchema.safeParse(round.wish).success).toBe(true);
      expect(GrantSchema.safeParse(round.grant).success).toBe(true);
      expect(round.grant.wishId).toBe(round.wish.id);
      for (const curse of round.grant.curses) {
        expect(VerdictSchema.safeParse(curse.verdict).success).toBe(true);
      }
    }
  });

  it('have stable, unique ids', () => {
    const ids = READY_ROUNDS.flatMap((round) => [round.wish.id, ...round.grant.curses.map((c) => c.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('close every curse with a real EARS clause, a closing verdict, a reason and a property', () => {
    for (const round of READY_ROUNDS) {
      expect(isReadyRound(round)).toBe(true);
      expect(round.grant.userStory).toMatch(/^As an? /);
      expect(isEarsCriterion(round.grant.wishCriterion ?? '')).toBe(true);
      for (const curse of round.grant.curses) {
        const { binding, verdict } = curse;
        expect(binding?.curseId).toBe(curse.id);
        expect(binding?.kind).toBe('ears-clause');
        expect(isEarsCriterion(binding?.clause ?? ''), binding?.clause).toBe(true);
        expect(binding?.clause).not.toMatch(/[[\]<>]|\.\.\./); // no gaps or brackets
        expect(verdict?.curseId).toBe(curse.id);
        expect(verdict?.closed).toBe(true);
        expect(sentences(verdict?.reason ?? '')).toHaveLength(1);
        expect(verdict?.property).toMatch(/^For any /);
        expect((verdict?.property ?? '').split(/\s+/).length).toBeLessThanOrEqual(40);
        expect(curse.status).toBe('closed');
      }
    }
  });

  it('tell each curse in at most two sentences, with distinct types in a round, and keep the voice', () => {
    for (const round of READY_ROUNDS) {
      expect(new Set(round.grant.curses.map((curse) => curse.type)).size).toBe(3);
      for (const curse of round.grant.curses) {
        expect(sentences(curse.story).length).toBeLessThanOrEqual(2);
        expect(curse.story.length).toBeLessThanOrEqual(360);
        expect(`${curse.story} ${curse.loophole}`).not.toMatch(/[!]|\p{Extended_Pictographic}/u);
      }
    }
  });

  it('readyClauseOf gives the clause of a curse, and nothing for a plain example', () => {
    const [round] = READY_ROUNDS;
    const curse = round?.grant.curses[0];
    expect(readyClauseOf(round ?? null, curse?.id ?? '')).toBe(curse?.binding?.clause);
    expect(readyClauseOf(null, 'x')).toBeUndefined();
    const base = round as NonNullable<typeof round>;
    const plain = {
      ...base,
      grant: { ...base.grant, curses: base.grant.curses.map((c) => ({ id: c.id, type: c.type, story: c.story, loophole: c.loophole, status: c.status })) },
    };
    expect(isReadyRound(plain)).toBe(false);
    expect(readyClauseOf(plain, curse?.id ?? '')).toBeUndefined();
  });
});
