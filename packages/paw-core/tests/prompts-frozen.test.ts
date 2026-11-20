// The frozen prompt fixture. tests/fixtures/prompts.frozen.json was written by the
// builders as they were BEFORE the rule sections were pulled out into constants
// (paw-power task 9). Every builder must still return exactly those strings.
// The comparison is toBe on plain JSON, not a Vitest snapshot, so `vitest -u`
// cannot rewrite it. Do not regenerate the fixture.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  buildBatchQualityPrompt,
  buildGeniePrompt,
  buildJudgePrompt,
  buildPawPrompt,
  buildReplacementPrompt,
} from '../src/prompts';
import {
  CURSE_RULES,
  CURSE_TAXONOMY,
  CURSES_ARRAY_RULE,
  CURSES_JSON_SHAPE,
  GUARDRAILS,
  JUDGE_ROLE,
  PAW_ROLE,
  VERDICT_JSON_SHAPE,
  VERDICT_RULES,
} from '../src/prompts';
import { CurseTypeSchema } from '../src/schemas';
import type { Binding, Curse, Wish } from '../src/types';

const WISH: Wish = {
  id: 'w1',
  text: 'Only the owner can delete a project',
  context: 'a clinic booking app',
  createdAt: 1_700_000_000_000,
};
const WISH_NO_CTX: Wish = { id: 'w2', text: 'Refunds are instant', createdAt: 1_700_000_000_000 };
const C0: Curse = {
  id: 'curse-0',
  type: 'permissions',
  story: 'The owner quits. Nobody may delete the project, ever.',
  loophole: 'Only the owner can delete',
  status: 'open',
};
const C1: Curse = {
  id: 'curse-1',
  type: 'time',
  story: 'The offer ends at midnight. Midnight where, the paw does not say.',
  loophole: 'ends at midnight',
  status: 'open',
};
const C2: Curse = {
  id: 'curse-2',
  type: 'edge-input',
  story: 'The field accepts any name. One customer is called nothing at all.',
  loophole: 'any name',
  status: 'open',
};
const BINDING: Binding = {
  curseId: 'curse-0',
  kind: 'ears-clause',
  clause: 'WHEN the owner has left THE SYSTEM SHALL let any member delete the project.',
  proposedAt: 1,
};

const FROZEN = JSON.parse(
  readFileSync(new URL('./fixtures/prompts.frozen.json', import.meta.url), 'utf8'),
) as Record<string, string>;

describe('frozen prompts (paw-power Req 22.3)', () => {
  const cases: Array<[string, () => string]> = [
    ['pawWithContext', () => buildPawPrompt(WISH)],
    ['pawNoContext', () => buildPawPrompt(WISH_NO_CTX)],
    ['genieWithContext', () => buildGeniePrompt(WISH)],
    ['genieNoContext', () => buildGeniePrompt(WISH_NO_CTX)],
    ['batchQuality', () => buildBatchQualityPrompt([C0, C1, C2])],
    ['judgeVerdictWithBinding', () => buildJudgePrompt(C0, BINDING, 'verdict')],
    ['judgeVerdictNoBinding', () => buildJudgePrompt(C0, undefined, 'verdict')],
    ['judgeQuality', () => buildJudgePrompt(C0, undefined, 'quality')],
    ['replacement', () => buildReplacementPrompt(WISH, C0)],
  ];

  it('the fixture holds exactly the cases below', () => {
    expect(Object.keys(FROZEN).sort()).toEqual(cases.map(([name]) => name).sort());
  });

  for (const [name, build] of cases) {
    it(`${name} is byte-identical to the fixture`, () => {
      expect(build()).toBe(FROZEN[name]);
    });
  }
});

describe('rule constants (paw-power D17)', () => {
  const PAW_SECTIONS = {
    PAW_ROLE,
    CURSE_RULES,
    CURSE_TAXONOMY,
    GUARDRAILS,
    CURSES_JSON_SHAPE,
    CURSES_ARRAY_RULE,
  };
  const JUDGE_SECTIONS = { JUDGE_ROLE, VERDICT_JSON_SHAPE, VERDICT_RULES };

  for (const [name, text] of Object.entries(PAW_SECTIONS)) {
    it(`${name} is a non-empty substring of the Paw prompt`, () => {
      expect(text.length).toBeGreaterThan(0);
      expect(buildPawPrompt(WISH)).toContain(text);
      expect(buildPawPrompt(WISH_NO_CTX)).toContain(text);
    });
  }

  for (const [name, text] of Object.entries(JUDGE_SECTIONS)) {
    it(`${name} is a non-empty substring of the Judge verdict prompt`, () => {
      expect(text.length).toBeGreaterThan(0);
      expect(buildJudgePrompt(C0, BINDING, 'verdict')).toContain(text);
      expect(buildJudgePrompt(C0, undefined, 'verdict')).toContain(text);
    });
  }

  it('the Paw sections appear in prompt order', () => {
    const prompt = buildPawPrompt(WISH);
    const positions = Object.values(PAW_SECTIONS).map((text) => prompt.indexOf(text));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('the taxonomy section names exactly the ten curse types', () => {
    const tags = [...CURSE_TAXONOMY.matchAll(/^- ([a-z-]+) — /gm)].map((m) => m[1]);
    expect(tags).toEqual([...CurseTypeSchema.options]);
  });

  it('no constant holds an interpolation placeholder', () => {
    for (const text of [...Object.values(PAW_SECTIONS), ...Object.values(JUDGE_SECTIONS)]) {
      expect(text).not.toContain('${');
    }
  });
});
