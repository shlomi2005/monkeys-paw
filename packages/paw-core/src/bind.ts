// proposeBinding: construct a Binding from a curse, binding text, and kind.
// No model call. Reject empty clauses (Req 3.2).

import type { Binding, BindingKind, Curse } from './types';

/**
 * Propose a binding for a curse: either a rewrite or an EARS clause.
 * Rejects empty binding text. Throws if the text is empty/whitespace.
 */
export function proposeBinding(
  curse: Curse,
  clause: string,
  kind: BindingKind,
): Binding {
  const trimmed = clause.trim();
  if (!trimmed) {
    throw new Error('Binding clause cannot be empty');
  }
  return {
    curseId: curse.id,
    kind,
    clause: trimmed,
    proposedAt: Date.now(),
  };
}
