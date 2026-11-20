---
name: curse-a-spec
description: Use when asked to stress-test, review or find loopholes in a spec. Curses the requirements of a `.kiro/specs/<feature>/requirements.md` with the Monkey's Paw, on your own agent, and tests a closing clause for each loophole.
---
# Curse a spec

The Paw runs on your own agent. You write the curses and you judge the clauses. The tools supply the rules and check your form. No Paw API is needed.

1. Find `.kiro/specs/<feature>/requirements.md` and read it.
2. Pick the requirements most likely to hide a loophole: permissions, deadlines, money, limits, deletion, shared state.
3. Call `paw_rules` with `kind` `curse` once, and follow what it returns.
4. For each picked requirement, write 3 to 5 curses yourself (each with a `type`, a `story` and a `loophole`, no ids). Call `paw_check_curses` with the requirement (at most 500 characters: its user story and key acceptance criteria) and the curses. If the check fails, fix the curses and call it once more. If it fails again, say so in one line and skip that requirement.
5. Report each loophole by requirement number, curse type and story.
6. Write one EARS clause per loophole (`WHEN ... THE SYSTEM SHALL ...`).
7. Call `paw_rules` with `kind` `bind` once, and follow what it returns.
8. Judge each clause yourself, strictly: if in doubt, it is not closed. Call `paw_check_verdict` with the curse, the clause and your verdict. If the check fails, fix the verdict and call it once more.
9. Offer only the clauses that came back `CLOSED`. Say plainly which loopholes stay open.
10. Never edit the spec unless the user asks.

The Judge here is your own agent judging your own clause, so be strict. A verdict that passes `paw_check_verdict` has the right form. It can still be wrong.

If a tool errors twice, report its sentence and stop. The Paw is resting, not broken.
