// Public API barrel for paw-core. One export per file; types re-exported with
// `export type` to satisfy isolatedModules.

export type {
  Binding,
  BindingKind,
  Curse,
  CurseStatus,
  CurseType,
  Grant,
  IntegrityResult,
  JudgeMode,
  ModelClient,
  SpecExport,
  Verdict,
  Wish,
} from './types';

export {
  BindingKindSchema,
  BindingSchema,
  BindResponseSchema,
  BatchQualityGateSchema,
  CurseSchema,
  CurseTypeSchema,
  ExamplesResponseSchema,
  GrantResponseSchema,
  GrantSchema,
  IntegrityResultSchema,
  QualityGateSchema,
  SpecExportSchema,
  VerdictSchema,
  WishSchema,
} from './schemas';

export type {
  BindResponse,
  ExamplesResponse,
  GrantResponse,
} from './schemas';

export type { BudgetConfig, BudgetState } from './budget';
export { DAY_MS, canCall, canSpend, recordCall } from './budget';

export {
  buildBatchQualityPrompt,
  buildGeniePrompt,
  buildJudgePrompt,
  buildPawPrompt,
  buildReplacementPrompt,
  CURSE_RULES,
  CURSE_TAXONOMY,
  CURSES_ARRAY_RULE,
  CURSES_JSON_SHAPE,
  GUARDRAILS,
  JUDGE_ROLE,
  PAW_ROLE,
  VERDICT_JSON_SHAPE,
  VERDICT_RULES,
} from './prompts';

export { EARS_CLAUSE_FORMAT, isEarsCriterion } from './ears';

export { grantWish } from './grant';

export { proposeBinding } from './bind';

export { judgeBinding } from './judge';

export { computeIntegrity } from './integrity';

export { exportSpec } from './export';
