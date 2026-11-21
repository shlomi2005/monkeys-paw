# Screenshot receipts

Full-page screenshots of the web app in each phase of a round, on desktop (1280 px) and mobile (390 px):
`idle`, `curses-landed`, `card-open`, `not-closed`, `closed`, `rested`, `stopped` and `reduced-motion`. Desktop also has
`poster-only`, the page in a browser without WebGL. Mobile skips that one.

Two more desktop pictures are taken at 1440 x 900 with the longest narration (260 characters): `desktop-1440-curses-landed.png`
and `desktop-1440-rested.png`. They show the plate after the polish: the stamp beside the wrist, the big paw, the narration
band, and the medal and buttons beside it. Layout is checked in numbers by `layout.desktop.spec.ts` and `layout.mobile.spec.ts`.

Files are named `<project>-<phase>.png`, for example `desktop-rested.png` and `mobile-card-open.png`.

Make them with `pnpm -C apps/web exec playwright test --grep @receipt`. The `ui-screenshot-receipt` hook runs the same
command when a component or stylesheet is saved. Each run overwrites the files.

The PNGs are gitignored (`apps/web/e2e/receipts/*.png`). They are regenerated on every UI save, so committing them would
only churn binary files. This README is the only committed file here.
