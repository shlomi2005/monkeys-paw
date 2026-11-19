---
name: curse-a-spec
description: Use when asked to stress-test, review or find loopholes in a spec. Curses the requirements of a `.kiro/specs/<feature>/requirements.md` with the Monkey's Paw and tests a closing clause for each loophole.
---
# Curse a spec

1. Find `.kiro/specs/<feature>/requirements.md` and read it.
2. Pick the requirements most likely to hide a loophole: permissions, deadlines, money, limits, deletion, shared state.
3. Call `paw_curse` once per picked requirement. Send at most 500 characters of the requirement and, as `context`, one line about the feature.
4. Report each loophole by requirement number, curse type and story.
5. Write one EARS clause per loophole (`WHEN ... THE SYSTEM SHALL ...`).
6. Test each clause with `paw_bind`, using the handle that `paw_curse` returned (for example `3f2a9c1e:curse-2`).
7. Offer only the clauses that came back `CLOSED`. Say plainly which loopholes stay open.
8. Never edit the spec unless the user asks.

If a tool returns an error, report its sentence and stop. The Paw is resting, not broken.
