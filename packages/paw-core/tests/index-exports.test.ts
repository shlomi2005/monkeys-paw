import { describe, expect, it } from 'vitest';

import * as core from '../src/index';
import * as ears from '../src/ears';
import * as prompts from '../src/prompts';

describe('public API (paw-power Req 22.2)', () => {
  it('exports isEarsCriterion and EARS_CLAUSE_FORMAT', () => {
    expect(core.isEarsCriterion).toBe(ears.isEarsCriterion);
    expect(core.EARS_CLAUSE_FORMAT).toBe(ears.EARS_CLAUSE_FORMAT);
  });

  it('exports every rule constant, the same string as prompts.ts', () => {
    const names = [
      'PAW_ROLE',
      'CURSE_RULES',
      'CURSE_TAXONOMY',
      'GUARDRAILS',
      'CURSES_JSON_SHAPE',
      'CURSES_ARRAY_RULE',
      'JUDGE_ROLE',
      'VERDICT_JSON_SHAPE',
      'VERDICT_RULES',
    ] as const;
    for (const name of names) {
      expect(typeof core[name]).toBe('string');
      expect(core[name]).toBe(prompts[name]);
    }
  });
});
