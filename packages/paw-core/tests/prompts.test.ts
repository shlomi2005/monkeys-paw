import { describe, expect, it } from 'vitest';

import {
  buildBatchQualityPrompt,
  buildGeniePrompt,
  buildJudgePrompt,
  buildPawPrompt,
  buildReplacementPrompt,
} from '../src/prompts';
import type { Binding, Curse, Wish } from '../src/types';

const WISH: Wish = {
  id: 'w1',
  text: 'Only the owner can delete a project',
  context: 'a clinic booking app',
  createdAt: 1_700_000_000_000,
};

const CURSE: Curse = {
  id: 'curse-0',
  type: 'permissions',
  story: 'The owner quits. Nobody may delete the project, ever.',
  loophole: 'Only the owner can delete',
  status: 'open',
};

const BINDING: Binding = {
  curseId: 'curse-0',
  kind: 'ears-clause',
  clause: 'WHEN the owner has left THE SYSTEM SHALL let any member delete the project.',
  proposedAt: 1,
};

describe('grant prompt (paw-api task 61)', () => {
  const prompt = buildPawPrompt(WISH) + buildGeniePrompt(WISH);

  it('asks for a userStory in the "As a ..., I want ..., so that ..." form', () => {
    expect(prompt).toContain('"userStory": "As a <role>, I want <capability>, so that <benefit>."');
    expect(prompt).toContain('"As a <role>, I want <capability>, so that <benefit>."');
    expect(prompt).toMatch(/max 40 words/);
  });

  it('asks for userStory in the Genie part as well', () => {
    expect(buildGeniePrompt(WISH)).toContain('"userStory"');
  });

  it('does not ask the model for curse ids', () => {
    expect(prompt).not.toMatch(/"id"/);
  });
});

describe('model prompts never ask for ids or timestamps (paw-api task 93)', () => {
  const prompts: Array<[string, string]> = [
    ['grant', buildPawPrompt(WISH) + buildGeniePrompt(WISH)],
    ['replacement', buildReplacementPrompt(WISH, CURSE)],
    ['verdict', buildJudgePrompt(CURSE, BINDING, 'verdict')],
    ['quality', buildJudgePrompt(CURSE, undefined, 'quality')],
  ];

  it.each(prompts)('%s prompt has no id, curseId or judgedAt', (_name, prompt) => {
    expect(prompt).not.toMatch(/"id"/);
    expect(prompt).not.toContain('curseId');
    expect(prompt).not.toContain('judgedAt');
    expect(prompt).not.toContain(CURSE.id);
  });

  it('the batch quality gate may echo the given ids', () => {
    const prompt = buildBatchQualityPrompt([CURSE]);
    expect(prompt).toContain('curseId');
    expect(prompt).toContain(CURSE.id);
  });
});

describe('verdict prompt (paw-api task 62)', () => {
  const prompt = buildJudgePrompt(CURSE, BINDING, 'verdict');

  it('asks for closed, reason and property only', () => {
    expect(prompt).toContain('"closed": boolean');
    expect(prompt).toContain('"reason": string');
    expect(prompt).toContain('"property": string');
  });

  it('asks for a "For any" property when closed, and an empty one otherwise', () => {
    expect(prompt).toContain('If closed is true');
    expect(prompt).toContain('starts with "For any"');
    expect(prompt).toContain('at most 40 words');
    expect(prompt).toContain('For any project whose owner has left, at least one member can still delete it.');
    expect(prompt).toContain('If closed is false, "property" is the empty string.');
  });
});
