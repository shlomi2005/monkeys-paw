// Public type contract for the wish engine.
// No DOM/Node imports. Framework-agnostic (consumed by web, api, and the Kiro power).

/** Curse type tags from curse-taxonomy.md. Never abbreviate or invent new tags. */
export type CurseType =
  | 'permissions'
  | 'time'
  | 'money'
  | 'scale'
  | 'abuse'
  | 'privacy'
  | 'accessibility'
  | 'data-loss'
  | 'concurrency'
  | 'edge-input';

/** A submitted requirement, with no identity attached (iron-rules §2). */
export interface Wish {
  /** Stable id for the session; no identity attached. */
  readonly id: string;
  /** The requirement text. Non-empty after upstream validation. */
  readonly text: string;
  /** Optional app context, e.g. "a clinic booking app". */
  readonly context?: string;
  /** Epoch ms; used only for rate-limit windowing, never stored with identity. */
  readonly createdAt: number;
}

export type CurseStatus = 'open' | 'closed';

export type BindingKind = 'rewrite' | 'ears-clause';

/** A binding the user proposes to close a loophole. */
export interface Binding {
  readonly curseId: string;
  readonly kind: BindingKind;
  /** The rewritten wish text, or the EARS clause. */
  readonly clause: string;
  readonly proposedAt: number;
}

/** The Judge's decision on a binding. */
export interface Verdict {
  readonly curseId: string;
  /** True = the binding closes the loophole; false = still open. */
  readonly closed: boolean;
  readonly reason: string;
  readonly judgedAt: number;
  /** Optional: a correctness property for fast-check, written by the Judge when closed is true (Task 25, Req 11.2). */
  readonly property?: string;
}

/** A loophole the Paw found, told as a short disaster story. */
export interface Curse {
  readonly id: string;
  /** Tag from curse-taxonomy.md. */
  readonly type: CurseType;
  /** Max 2 sentences: the literal-compliance disaster, dry comedy-horror. */
  readonly story: string;
  /** Quotes/points to the exact words in the wish that create the loophole. */
  readonly loophole: string;
  readonly status: CurseStatus;
  /** Present once the curse is judged closed. */
  readonly binding?: Binding;
  /** Present once judged. */
  readonly verdict?: Verdict;
}

/** The Paw's literal grant of a wish: a narration plus 3–5 curses. */
export interface Grant {
  readonly wishId: string;
  /** Genie narration: the literal grant in 1–2 sentences. */
  readonly narration: string;
  /** 3–5 curses. */
  readonly curses: Curse[];
  /** Optional: a user story written by the Genie (Task 25, Req 11.1). */
  readonly userStory?: string;
}

/** Wish Integrity score 0–5 with counts. */
export interface IntegrityResult {
  /** 0–5, rounded down from closed/total ratio. 5 = all closed. */
  readonly score: number;
  readonly total: number;
  readonly closed: number;
  readonly open: number;
}

/** A Kiro-ready spec export. */
export interface SpecExport {
  readonly wishId: string;
  /** Kiro spec format: user story + EARS acceptance criteria. */
  readonly requirementsMd: string;
  /** One correctness property per closed curse. */
  readonly propertiesMd: string;
  readonly integrity: IntegrityResult;
}

/** Mode for the Judge prompt builder. */
export type JudgeMode = 'quality' | 'verdict';

/**
 * The transport for model calls. paw-core never imports a model SDK; the caller
 * (apps/api) implements this and injects it. Implementations return raw text (a
 * JSON string); paw-core does the JSON.parse + zod parse. Output is untrusted.
 */
export interface ModelClient {
  generate(prompt: string): Promise<unknown>;
}
