---
name: curse-taxonomy
description: Use when classifying or writing a loophole in a requirement. The ten curse types, what makes a curse good, and one worked example.
---
# Curse taxonomy

A curse is a short story (max 2 sentences) where the system obeys the wish *exactly* and the result is clearly
bad for a real stakeholder. Every curse must be:
- **Specific** to this wish and its context (it must quote or point to the words that create the loophole).
- **Plausible** — something a real implementation could do while passing a literal reading of the wish.
- **Different** from the other curses in the same grant (different type or different stakeholder).
- **Bindable** — there is a clear clause that would close it.

Curse types (use the tag exactly):
- `permissions` — who may do what; owners leaving, roles, delegation, admins.
- `time` — deadlines, time zones, daylight saving, expiry, ordering of events.
- `money` — rounding, currency, refunds, double charges, free loopholes.
- `scale` — zero items, one item, millions of items, very long input.
- `abuse` — a hostile user follows the rule to harm others or the system.
- `privacy` — exposing or keeping data nobody meant to expose or keep.
- `accessibility` — people with disabilities, slow networks, small screens, other languages.
- `data-loss` — deletion, overwrite, undo, backups.
- `concurrency` — two users at once, retries, duplicates, race conditions.
- `edge-input` — empty, unicode, emoji, right-to-left text, negative numbers, null.

Bad curse (generic, reject): "The system could have bugs." Good curse (specific): wish "Only the owner can delete a
project" → `permissions`: "The owner quits the company. Granted: nobody may delete the project, ever."
