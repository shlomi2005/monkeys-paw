// The drift test (Req 23.6, paw-power D17): paw_rules cannot drift from paw-core.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CURSE_RULES,
  CURSE_TAXONOMY,
  CURSES_ARRAY_RULE,
  CURSES_JSON_SHAPE,
  CurseSchema,
  CurseTypeSchema,
  EARS_CLAUSE_FORMAT,
  GUARDRAILS,
  GrantSchema,
  JUDGE_ROLE,
  PAW_ROLE,
  VERDICT_JSON_SHAPE,
  VERDICT_RULES,
  buildJudgePrompt,
  buildPawPrompt,
  isEarsCriterion,
  type Binding,
  type Curse,
  type Wish,
} from 'paw-core';
import { describe, expect, it } from 'vitest';
import { BIND_FOOTER, CURSE_FOOTER, buildRules } from '../src/rules';
import { PROPERTY_MAX_WORDS } from '../src/limits';

const WISH: Wish = { id: 'w1', text: 'Only the owner can delete a project', context: 'a clinic app', createdAt: 1 };
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

const curseRules = buildRules('curse');
const bindRules = buildRules('bind');

describe('curse rules against buildPawPrompt', () => {
  const prompt = buildPawPrompt(WISH);

  it('every section appears verbatim in the prompt, in the same order', () => {
    let from = 0;
    for (const section of curseRules.sections) {
      const at = prompt.indexOf(section.text, from);
      expect(at, `section ${section.name}`).toBeGreaterThanOrEqual(from);
      from = at + section.text.length;
    }
  });

  it('the sections are the paw-core constants, nothing else', () => {
    expect(curseRules.sections.map((s) => s.text)).toEqual([
      PAW_ROLE,
      CURSE_RULES,
      CURSE_TAXONOMY,
      GUARDRAILS,
      CURSES_JSON_SHAPE,
      CURSES_ARRAY_RULE,
    ]);
  });

  it('the taxonomy tags equal CurseTypeSchema.options', () => {
    const taxonomy = curseRules.sections.find((s) => s.name === 'taxonomy')!.text;
    const tags = [...taxonomy.matchAll(/^- ([a-z-]+) — /gm)].map((m) => m[1]);
    expect(tags).toEqual([...CurseTypeSchema.options]);
    expect(tags).toHaveLength(10);
  });

  it('the JSON Schema is of the curses array, with the paw-core enum and limits', () => {
    const schema = curseRules.jsonSchema as {
      type: string;
      minItems: number;
      maxItems: number;
      items: {
        required: string[];
        properties: { type: { enum: string[] }; story: { maxLength: number }; loophole: { type: string } };
      };
    };
    const limits = GrantSchema.shape.curses._def;
    const storyMax = CurseSchema.shape.story._def.checks.find((c) => c.kind === 'max');
    expect(schema.type).toBe('array');
    expect(schema.items.properties.type.enum).toEqual([...CurseTypeSchema.options]);
    expect(schema.minItems).toBe(limits.minLength?.value);
    expect(schema.maxItems).toBe(limits.maxLength?.value);
    expect([schema.minItems, schema.maxItems]).toEqual([3, 5]);
    expect(schema.items.properties.story.maxLength).toBe(storyMax && 'value' in storyMax ? storyMax.value : -1);
    expect([...schema.items.required].sort()).toEqual(['loophole', 'story', 'type']);
    expect(Object.keys(schema.items.properties).sort()).toEqual(['loophole', 'story', 'type']);
  });

  it('the array rule in the prompt says the same limits as the schema', () => {
    expect(CURSES_ARRAY_RULE).toContain('between 3 and 5 items');
  });
});

describe('bind rules against buildJudgePrompt (verdict mode)', () => {
  const prompt = buildJudgePrompt(CURSE, BINDING, 'verdict');

  it('every section except the EARS line appears verbatim in the prompt, in order', () => {
    let from = 0;
    for (const section of bindRules.sections.filter((s) => s.name !== 'ears-format')) {
      const at = prompt.indexOf(section.text, from);
      expect(at, `section ${section.name}`).toBeGreaterThanOrEqual(from);
      from = at + section.text.length;
    }
  });

  it('the sections are the paw-core constants, nothing else', () => {
    expect(bindRules.sections.map((s) => s.text)).toEqual([
      JUDGE_ROLE,
      VERDICT_JSON_SHAPE,
      VERDICT_RULES,
      EARS_CLAUSE_FORMAT,
    ]);
  });

  it('the EARS line is EARS_CLAUSE_FORMAT, and names every keyword isEarsCriterion accepts', () => {
    const ears = bindRules.sections.find((s) => s.name === 'ears-format')!.text;
    expect(ears).toBe(EARS_CLAUSE_FORMAT);
    for (const keyword of ['WHEN', 'IF', 'WHILE', 'WHERE', 'THE SYSTEM SHALL']) {
      expect(ears).toContain(keyword);
      expect(isEarsCriterion(`${keyword} a thing happens, the system SHALL act.`)).toBe(true);
    }
  });

  it('the verdict schema requires closed and reason, and offers property', () => {
    const schema = bindRules.jsonSchema as { type: string; required: string[]; properties: Record<string, unknown> };
    expect(schema.type).toBe('object');
    expect([...schema.required].sort()).toEqual(['closed', 'reason']);
    expect(Object.keys(schema.properties).sort()).toEqual(['closed', 'property', 'reason']);
  });

  it('the word limit paw-mcp checks is the one the Judge prompt states', () => {
    expect(VERDICT_RULES).toContain(`at most ${PROPERTY_MAX_WORDS} words`);
    expect(VERDICT_RULES).toContain('starts with "For any"');
  });
});

describe('no rule text is copied into paw-mcp', () => {
  const srcDir = join(__dirname, '..', 'src');
  const sources = readdirSync(srcDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ file: f, text: readFileSync(join(srcDir, f), 'utf8') }));

  const constants = {
    PAW_ROLE,
    CURSE_RULES,
    CURSE_TAXONOMY,
    GUARDRAILS,
    CURSES_JSON_SHAPE,
    CURSES_ARRAY_RULE,
    JUDGE_ROLE,
    VERDICT_JSON_SHAPE,
    VERDICT_RULES,
    EARS_CLAUSE_FORMAT,
  };

  it('no line of any rule constant appears in a paw-mcp source file', () => {
    for (const [name, text] of Object.entries(constants)) {
      const lines = text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length >= 30);
      for (const line of lines) {
        for (const src of sources) {
          expect(src.text.includes(line), `${name} line "${line.slice(0, 40)}" is copied into src/${src.file}`).toBe(false);
        }
      }
    }
  });

  it('only rules.ts holds footers, and each is short', () => {
    expect(CURSE_FOOTER.length).toBeLessThan(250);
    expect(BIND_FOOTER.length).toBeLessThan(250);
    const holders = sources.filter((s) => s.text.includes('Write the curses yourself')).map((s) => s.file);
    expect(holders).toEqual(['rules.ts']);
  });

  it('paw-mcp imports nothing from apps/*', () => {
    for (const src of sources) {
      expect(src.text, src.file).not.toMatch(/from\s+['"][^'"]*apps\//);
      expect(src.text, src.file).not.toMatch(/from\s+['"][^'"]*(@monkeyspaw\/(api|web))/);
    }
  });
});
