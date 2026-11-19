---
name: spec-loophole-hook
description: Use when the user wants the Monkey's Paw to comment on loopholes automatically each time the agent saves a requirements.md. Installs a file hook into the workspace.
---
# Install the loophole hook

1. Check that `.kiro/hooks/` exists in the user's workspace. Create it if it does not.
2. If `.kiro/hooks/paw-reviews-requirements.json` already exists, stop and say so. Do not overwrite it.
3. Copy `references/paw-reviews-requirements.json` from this skill to `.kiro/hooks/paw-reviews-requirements.json`.
4. Tell the user three things. The hook runs an agent loop and up to 3 Paw API calls each time the agent saves a `requirements.md`. File hooks fire only for saves made by the agent. The hook can be switched off with `"enabled": false`, and `PAW_API_URL` must be set for the `paw_curse` tool to work.
