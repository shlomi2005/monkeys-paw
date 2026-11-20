# The Monkey's Paw (Kiro power)

Make a wish. The Paw grants it, exactly. Give it a software requirement and it shows how the requirement can be
followed to the letter and still go wrong, then checks the clause you write to close each loophole.

The power runs on your own Kiro agent, with your own model and credits. It sends nothing to any server of ours.
`PAW_API_URL` is optional: setting it switches on remote mode, with `paw_curse` and `paw_bind` against a Paw API you
run.

## Install

In Kiro: Powers panel > Add Custom Power > Import power from a folder (this folder), or from a repository URL that
points at this folder. Node 22 must be on your PATH.

## Tools

Local mode is the default. Your agent writes the curses and the verdicts. The tools give it the rules and check the form.
They call no model and no server.

- `paw_rules`: the rules of the Paw (`kind` `curse`) or of the Judge (`kind` `bind`). Example: `paw_rules(kind="curse")`.
- `paw_check_curses`: checks 3 to 5 curses you wrote for one requirement (500 characters at most). Example:
  `paw_check_curses(requirement="Only the owner can delete a project.", curses=[{type, story, loophole}, ...])`.
- `paw_check_verdict`: checks your verdict on a clause. Example:
  `paw_check_verdict(curse={type, story, loophole}, amendment="WHEN the owner leaves, THE SYSTEM SHALL name a successor.", verdict={closed, reason})`.

In remote mode (`PAW_API_URL` set to a usable `http(s)` URL) two more tools appear: `paw_curse` and `paw_bind`. They call the
Paw API you run, and its Judge answers.

## Skills

- `curse-taxonomy`: the ten curse types and what makes a curse good.
- `curse-a-spec`: curse the requirements of a `requirements.md` and test a closing clause for each loophole.
- `spec-loophole-hook`: copies a file hook into your workspace so the Paw comments after each saved `requirements.md`.

## The fine print

In local mode the Judge is your own agent judging your own clause, so it must be strict. A verdict that passes
`paw_check_verdict` has the right form, and it can still be wrong.

File hooks fire only for saves made by the agent. Each review costs one agent loop of your credits. The server writes
nothing to disk.

Third-party notices: `server/NOTICE.md`. Licence: MIT.
