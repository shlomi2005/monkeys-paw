import {
  CURSE_RULES,
  CURSE_TAXONOMY,
  CURSES_ARRAY_RULE,
  CURSES_JSON_SHAPE,
  CurseSchema,
  EARS_CLAUSE_FORMAT,
  GUARDRAILS,
  GrantSchema,
  JUDGE_ROLE,
  PAW_ROLE,
  VERDICT_JSON_SHAPE,
  VERDICT_RULES,
  VerdictSchema,
} from 'paw-core';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { MAX_CURSES, MIN_CURSES } from './limits';

export type RulesKind = 'curse' | 'bind';

export interface RuleSection {
  name: string;
  text: string;
}

export interface Rules {
  kind: RulesKind;
  text: string;
  sections: RuleSection[];
  jsonSchema: Record<string, unknown>;
  next: string;
}

// The only text of the rules that is written here (Req 23.4). Everything else comes from paw-core.
export const CURSE_FOOTER =
  'Write the curses yourself, following these rules. Include no ids; the system assigns them. ' +
  'Then call paw_check_curses with the requirement and your curses, and fix what it reports once.';
export const BIND_FOOTER =
  'Judge the amendment yourself, strictly: if in doubt, closed is false. ' +
  'Then call paw_check_verdict with the curse, the amendment, its kind and your verdict, and fix what it reports once.';

function cursesJsonSchema(): Record<string, unknown> {
  const item = CurseSchema.pick({ type: true, story: true, loophole: true });
  // Limits are read from GrantSchema, not copied.
  const curses = GrantSchema.shape.curses;
  const schema = item.array().min(curses._def.minLength?.value ?? MIN_CURSES).max(curses._def.maxLength?.value ?? MAX_CURSES);
  return zodToJsonSchema(schema, { $refStrategy: 'none' }) as Record<string, unknown>;
}

function verdictJsonSchema(): Record<string, unknown> {
  const schema = VerdictSchema.pick({ closed: true, reason: true, property: true });
  return zodToJsonSchema(schema, { $refStrategy: 'none' }) as Record<string, unknown>;
}

/** The rules of the Paw (`curse`) or of the Judge (`bind`), in prompt order. Pure: no network, no state. */
export function buildRules(kind: RulesKind): Rules {
  const sections: RuleSection[] =
    kind === 'curse'
      ? [
          { name: 'role', text: PAW_ROLE },
          { name: 'curse-rules', text: CURSE_RULES },
          { name: 'taxonomy', text: CURSE_TAXONOMY },
          { name: 'guardrails', text: GUARDRAILS },
          { name: 'json-shape', text: CURSES_JSON_SHAPE },
          { name: 'array-rule', text: CURSES_ARRAY_RULE },
        ]
      : [
          { name: 'role', text: JUDGE_ROLE },
          { name: 'json-shape', text: VERDICT_JSON_SHAPE },
          { name: 'verdict-rules', text: VERDICT_RULES },
          { name: 'ears-format', text: EARS_CLAUSE_FORMAT },
        ];
  const jsonSchema = kind === 'curse' ? cursesJsonSchema() : verdictJsonSchema();
  const next = kind === 'curse' ? CURSE_FOOTER : BIND_FOOTER;
  const text = [
    ...sections.map((section) => section.text),
    `JSON Schema:\n${JSON.stringify(jsonSchema, null, 2)}`,
    next,
  ].join('\n\n');
  return { kind, text, sections, jsonSchema, next };
}
