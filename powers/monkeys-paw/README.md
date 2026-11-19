# The Monkey's Paw (Kiro power)

Make a wish. The Paw grants it, exactly. Give it a software requirement and it shows how the requirement can be
followed to the letter and still go wrong, then judges the clause you write to close each loophole.

## Install

In Kiro: Powers panel > Add Custom Power > Import power from a folder (this folder), or from a repository URL that
points at this folder. Node 22 must be on your PATH.

## Set the API address

Set `PAW_API_URL` to the address of a Paw API. Today the default is a placeholder (`https://paw-api.invalid`) that
never resolves, so without the setting the tools answer "Cannot reach the Paw API".

## Tools

- `paw_curse`: curse one requirement (500 characters at most, optional one-line `context`). Returns up to five
  loopholes, each with a handle. Example: `paw_curse(requirement="Only the owner can delete a project.")`.
- `paw_bind`: test a clause against one loophole. The Judge answers CLOSED or OPEN. Example:
  `paw_bind(curse="3f2a9c1e:curse-0", amendment="WHEN the owner leaves, THE SYSTEM SHALL name a successor.")`.

## Skills

- `curse-taxonomy`: the ten curse types and what makes a curse good.
- `curse-a-spec`: curse the requirements of a `requirements.md` and test a closing clause for each loophole.
- `spec-loophole-hook`: copies a file hook into your workspace so the Paw comments after each saved `requirements.md`.

## The fine print

File hooks fire only for saves made by the agent. Each review costs an agent loop and up to 3 API calls. Wishes are
not stored with any identity. The server keeps the last 20 grants in memory and writes nothing to disk.

Third-party notices: `server/NOTICE.md`. Licence: MIT.
