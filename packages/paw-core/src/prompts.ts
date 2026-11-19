// Prompt builders for the three prompted roles (Paw, Genie, Judge) plus the
// replacement helper used by the grant quality gate. Each returns a string;
// none call the model. A leading "Task:" line labels the call so transports and
// tests can dispatch without parsing natural language.

import type { Binding, Curse, JudgeMode, Wish } from './types';

function contextLine(wish: Wish): string {
  return wish.context ? `\nApp context: ${wish.context}` : '';
}

/** Paw (adversary) — finds loopholes for a wish. */
export function buildPawPrompt(wish: Wish): string {
  return `Task: GRANT_WISH

You are the Paw, an adversary that finds loopholes in software requirements. The user made a wish; you grant it literally and expose every way it can be followed to the letter and go wrong.

Wish: ${wish.text}${contextLine(wish)}

Produce 3 to 5 curses. Each curse is a short story (max 2 sentences, max 30 words). Each curse MUST be:
- Specific to THIS wish: quote or point to the exact words in the wish that create the loophole (put them in the "loophole" field).
- Plausible: something a real implementation could do while passing a literal reading.
- Different from the other curses in this grant: each curse uses a different curse type (tag) or targets a different stakeholder.
- Bindable: there is a clear clause that would close the loophole.

Curse taxonomy (use the tag EXACTLY as one of these, never abbreviate or invent):
- permissions — who may do what; owners leaving, roles, delegation, admins.
- time — deadlines, time zones, daylight saving, expiry, ordering of events.
- money — rounding, currency, refunds, double charges, free loopholes.
- scale — zero items, one item, millions of items, very long input.
- abuse — a hostile user follows the rule to harm others or the system.
- privacy — exposing or keeping data nobody meant to expose or keep.
- accessibility — people with disabilities, slow networks, small screens, other languages.
- data-loss — deletion, overwrite, undo, backups.
- concurrency — two users at once, retries, duplicates, race conditions.
- edge-input — empty, unicode, emoji, right-to-left text, negative numbers, null.

Guardrails (iron rules): PG-13 only. No gore. No real people. No hate. Refuse wishes about harming people with a short in-character line. Do not use film, game, or brand IP.

Return STRICT JSON ONLY — no prose, no markdown fences — matching this shape:
{
  "narration": "<1–2 sentence dry comedy-horror, max 25 words>",
  "userStory": "As a <role>, I want <capability>, so that <benefit>.",
  "curses": [
    {
      "type": "<one of the tags above>",
      "story": "<max 2 sentences, max 30 words>",
      "loophole": "<the exact words in the wish that create the loophole>"
    }
  ]
}
The "curses" array MUST contain between 3 and 5 items, each with a distinct "type". Do not include ids; the system assigns them.`;
}

/** Genie (narrator) — tells the literal grant in 1–2 sentences, dry comedy-horror. */
export function buildGeniePrompt(wish: Wish): string {
  return `

You are also the Genie, the narrator. In the same JSON, set "narration" to the literal grant of the wish in 1 or 2 sentences, in a dry comedy-horror voice. The wish is granted exactly as written — nothing more, nothing less. Also set "userStory" to ONE sentence in Kiro's form "As a <role>, I want <capability>, so that <benefit>." for THIS wish and its context, max 40 words. It states the user's need in plain words, with no talk about specs, loopholes, curses or the Paw. Wish: ${wish.text}${contextLine(wish)}`;
}

/**
 * Task 98: Batch quality judge - judge all curses in one call.
 */
export function buildBatchQualityPrompt(curses: Curse[]): string {
  const cursesText = curses
    .map(
      (c, i) => `Curse ${i + 1}:
- id: ${c.id}
- type: ${c.type}
- story: ${c.story}
- loophole: ${c.loophole}`,
    )
    .join('\n\n');

  return `Task: JUDGE_BATCH_QUALITY

You are the Judge, a strict quality gate. Decide whether each of the following curses is SPECIFIC to its wish (not generic).

${cursesText}

A curse is generic if it could apply to almost any wish (for example "the system could have bugs") without pointing to concrete words. A curse is specific if its "loophole" quotes or clearly points to the exact words that create the loophole and the story follows that loophole to a concrete bad outcome for a real stakeholder.

Return STRICT JSON ONLY matching this array shape:
[
  { "curseId": "<id>", "specific": boolean, "reason": string },
  { "curseId": "<id>", "specific": boolean, "reason": string }
]

One object per curse, in the same order as above.`;
}

/**
 * Judge — one prompt builder, two modes.
 *  - "quality" (during grant): given a curse, decide if it is specific or generic.
 *    Output: { specific: boolean, reason: string }.
 *  - "verdict": given a curse and a binding, decide if the binding closes the
 *    loophole. Output matches VerdictSchema. The Judge emits JSON only.
 */
export function buildJudgePrompt(
  curse: Curse,
  binding?: Binding,
  mode: JudgeMode = 'verdict',
): string {
  if (mode === 'quality') {
    return `Task: JUDGE_QUALITY

You are the Judge, a strict quality gate. Decide whether the following curse is SPECIFIC to its wish (not generic).

Curse:
- type: ${curse.type}
- story: ${curse.story}
- loophole: ${curse.loophole}

A curse is generic if it could apply to almost any wish (for example "the system could have bugs") without pointing to concrete words. A curse is specific if its "loophole" quotes or clearly points to the exact words that create the loophole and the story follows that loophole to a concrete bad outcome for a real stakeholder.

Return STRICT JSON ONLY matching: { "specific": boolean, "reason": string }`;
  }

  return `Task: JUDGE_VERDICT

You are the Judge. Decide whether the proposed binding really CLOSES the loophole in the curse. The Judge is strict: the binding only closes the curse if, after applying it, the literal-compliance disaster in the story can no longer happen.

Curse:
- type: ${curse.type}
- story: ${curse.story}
- loophole: ${curse.loophole}

Binding:
- kind: ${binding ? binding.kind : 'none'}
- clause: ${binding ? binding.clause : 'none'}

Return STRICT JSON ONLY matching this shape:
{
  "closed": boolean,
  "reason": string,
  "property": string
}

Set "closed" to true only if the binding closes the loophole; otherwise false. The "reason" must explain the ruling.
If closed is true, "property" is ONE universally quantified, testable sentence about the system's behaviour that the binding guarantees. It starts with "For any" and is at most 40 words (e.g. "For any project whose owner has left, at least one member can still delete it.").
If closed is false, "property" is the empty string.
Emit JSON only — no prose outside the object.`;
}

/** Replacement helper: regenerate one specific curse to replace a generic one. */
export function buildReplacementPrompt(wish: Wish, curse: Curse): string {
  return `Task: REPLACE_CURSE

You are the Paw. The curse below was judged generic. Replace it with a SPECIFIC curse for the same wish, following all the same rules (specific, plausible, bindable). It must use a different angle than the one rejected.

Wish: ${wish.text}${contextLine(wish)}

Rejected curse:
- type: ${curse.type}
- story: ${curse.story}
- loophole: ${curse.loophole}

Curse taxonomy tags (use one EXACTLY): permissions, time, money, scale, abuse, privacy, accessibility, data-loss, concurrency, edge-input. PG-13 only. No real people. No gore. No hate.

Return STRICT JSON ONLY for a single curse object:
{ "type": "<one tag>", "story": "<max 2 sentences>", "loophole": "<exact words in the wish>" }
Do not include an id; the system keeps the original one.`;
}
