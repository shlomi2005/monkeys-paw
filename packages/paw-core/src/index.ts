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
  CurseSchema,
  CurseTypeSchema,
  GrantSchema,
  IntegrityResultSchema,
  QualityGateSchema,
  SpecExportSchema,
  VerdictSchema,
} from './schemas';

export type { BudgetConfig, BudgetState } from './budget';
export { DAY_MS, canCall, recordCall } from './budget';

export {
  buildGeniePrompt,
  buildJudgePrompt,
  buildPawPrompt,
  buildReplacementPrompt,
} from './prompts';

export { grantWish } from './grant';

export { proposeBinding } from './bind';

export { judgeBinding } from './judge';

export { computeIntegrity } from './integrity';

export { exportSpec } from './export';
