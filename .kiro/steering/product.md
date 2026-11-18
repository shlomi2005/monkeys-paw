# Product: The Monkey's Paw

"Make a wish. The Paw grants it — exactly."

The Monkey's Paw is a web app that stress-tests a software requirement. The user writes a wish (a requirement,
optionally with app context). The Paw grants it literally and acts out up to five curses: short, concrete,
plausible stories of the requirement being followed to the letter and going wrong. Each curse curls one finger
of the paw. The user closes each loophole by rewriting the wish or binding an EARS clause; a Judge decides
whether the loophole is really closed, and only then does the finger open. When the paw rests, the user exports
a Kiro-ready spec: `requirements.md` (user story + EARS acceptance criteria) and `properties.md` (one correctness
property per closed curse, ready for property-based testing).

Why it matters: AI coding agents are literal genies. They build what you wrote, not what you meant.
Spec-driven development only works when the spec is airtight. The Paw makes finding the holes fast and fun.

Audience: product managers, founders, students, junior developers, and anyone writing specs for Kiro.

Tone: dry comedy-horror. Eerie, elegant, never gory. PG-13. No real people. The Paw is witty, not cruel.

Also shipped: a Kiro power (`monkeys-paw`) with an MCP server and a hook, so the Paw can comment on loopholes in
any `.kiro/specs/*/requirements.md` inside Kiro.
