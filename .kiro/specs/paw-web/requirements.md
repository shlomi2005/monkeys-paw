# Paw Web — Requirements

## Introduction

Vite + React 19 + TypeScript web app with react-three-fiber. Calls `apps/api` via fetch (iron-rules.md §1:
API holds Gemini key). Renders Victorian-engraved paw and curse circles in 3D, fallback to static JPG.

**Scope:** wish line and examples, 3D paw (load mobile.glb ≤768px, web.glb >768px, poster.jpg fallback),
curl/open animations, five curse circles and binding card, Judge verdict, rest state, accessibility
(keyboard, reduced-motion, AA contrast), mobile layout, sound (off by default), privacy (no storage), performance.

**Out of scope:** API server, pure logic, Kiro power, model rigging, prompts.

**Aesthetic:** Sepia (#7a5a3a) + ink (#2b1d12) on parchment (#e9d8b4), blood-red accent (#8f1d14), OFL fonts,
ornate border, idle brazier/curtain animation, cross-hatched paw shader.

---

## Glossary

- **Wish**: requirement text + optional context.
- **Grant**: narration + 3–5 curses.
- **Curse**: 1–2 sentence disaster story; each curls one finger.
- **Binding**: rewritten wish or EARS clause.
- **Verdict**: `closed: true/false` + reason + optional property.
- **Integrity**: 0–5 score: `floor(closed / total * 5)`.
- **Circles**: five positions, one per curse; fill with vignette + type + story on arrival.
- **Seal**: red wax icon; holds (closed) or cracks (open).
- **Paw LIFO**: a stack of digits. Curse n (1-based, in Grant order) curls digit n in the fixed order thumb →
  index → middle → ring → little. A closed verdict opens the most recently curled digit that is still curled,
  whichever circle was bound, so the thumb is always last to open.

---

## Requirements

### Requirement 1: Page layout

**User story:** As a spec author, I want a single parchment plate with the paw at centre, five circles
around it, and the wish line at the bottom.

**Acceptance criteria:**

1. **RENDER** one full-viewport parchment plate: ornate engraved border (ink #2b1d12, sepia accents #7a5a3a),
   parchment background #e9d8b4 with noise texture.
2. **ADD** two smoking braziers (left/right edges, idle animation 2–3s loop) and heavy curtains (top corners,
   breathing animation ~500ms).
3. **CENTRE:** 3D paw scene (Req 2), 1:1 aspect, responsive to width.
4. **AROUND PAW (5 POSITIONS):** five empty circles (empty parchment disc, ink stroke, ~80px desktop) in arc
   layout. Desktop (≥768px): ring above/below paw. Mobile (<768px): vertical list below paw.
5. **CIRCLES FILL** when curse arrives: vignette frame, curse-type label (sepia, small), story (1–2 lines,
   serif, ink on parchment).
6. **BOTTOM:** wish line (ruled band: horizontal ink lines) with "I wish that…" input, "for…" context
   (collapsible), "Make the wish" seal button, example cards row below.
7. **LAYOUT:** responsive scale; circles reflow on breakpoint; all text ≥16px mobile, ≥18px desktop, line-height ≥1.5.

### Requirement 2: 3D paw scene (r3f)

**User story:** As a spec author, I want to see the paw as a living engraving with smooth finger
curl/open animations.

**Acceptance criteria:**

1. **USE r3f** with THREE.Scene, sepia-tinted ambient + directional lighting (soft shadows). Per
   PAW-ASSET.md the wrist is at the origin, the paw is 1 unit high (Y up) and the palm faces +Z, so the
   camera SHALL sit on the +Z side and look back toward the paw (target around y = 0.5), at a distance that
   frames the whole paw.
2. **ON MOUNT:** detect viewport (≤768px → load mobile.glb 2.0MB, >768px → web.glb 2.9MB) via
   navigator.userAgentData or matchMedia. If load fails or WebGL unavailable, show paw-poster.jpg (57KB)
   static fallback.
3. **WHILE LOADING:** show poster.jpg (fade-in on GLB ready, 300ms).
4. **PAW MATERIAL:** cross-hatched shader: sample normal map for hatch direction/density, render ink lines
   (#2b1d12) with blood-red accent (#8f1d14) on PBR base colour. Result: printed engraving on parchment.
5. **CORD:** separate material, blood-red with rope texture.
6. **FIRST FRAME:** render `rest` state within 16ms (60 FPS, no jank).
7. **CURSE ARRIVES:** WHEN a curse arrives, THE SYSTEM SHALL raise the `amount` of its digit N (thumb 0–little 4)
   from 0 to 1 over 500ms (easing cubic-out: fast attack, quiet settle) and curl only that digit. THE SYSTEM
   SHALL NOT move two digits at once.
   - **DIRECT JOINT CONTROL:** the scene drives the digit's joints per `docs/art/paw/runtime-controls.json`.
     Each frame, for every joint of the digit, THE SYSTEM SHALL start from the joint's
     `bind_local_rotation_xyzw`, apply the listed operations in order with
     `angle = max_degrees * clamp(amount, 0, 1)`, and never accumulate rotations from frame to frame.
   - **NO COMPETING ANIMATION:** BEFORE taking direct control, THE SYSTEM SHALL stop any animation action
     that targets the same joints.
   - **DIGIT TO JOINTS:** thumb = `thumb_cmc`, `thumb_mcp`, `thumb_ip`; index / middle / ring / little =
     `<digit>_mcp`, `<digit>_pip`, `<digit>_dip`.
8. **LOOPHOLE CLOSED:** WHEN the paw opens a digit, THE SYSTEM SHALL lower that digit's `amount` from 1 to 0
   over 1208ms (the asset's soft open) with smoothstep-like easing (ease-in-out, gentle start and gentle end,
   the "relief" feel of PAW-ASSET.md). The digit opened is the most recently curled digit still curled (Req 5,
   step 3).
9. **REDUCED MOTION:** swap animation to instant state change with text cue ("curled" / "open").
10. **NO WEBGL:** render poster.jpg static, disable animations, keep UI interactive.

### Requirement 3: Wish line and examples

**User story:** As a spec author, I want to enter my requirement or pick an example, then make the wish.

**Acceptance criteria:**

1. **WISH LINE:** "I wish that…" input (~200 chars visible), "for…" context input (collapsible, ~100 chars),
   "Make the wish" seal button (blood-red, glow on hover).
2. **ON USER INPUT:** clear wish, dim examples (opacity) until submit.
3. **ON "MAKE THE WISH" OR ENTER:**
   - Validate wish non-empty (error if empty, in-character).
   - Call `POST /api/grant` with `{ wish: { text, context } }`.
   - Show loading state (<5s typical, "The Paw stirs…" or animated blots).
   - Success: stamp "Granted." in red, play creak sound.
   - Error (400, 503): show in-character error, no Grant.
   - Disable input/button until Grant arrives.
4. **EXAMPLES:** horizontal scrollable row (desktop) or vertical list (mobile), 3–5 visible, from
   `GET /api/examples`.
5. **EACH EXAMPLE CARD:** wish snippet (~50 chars, ellipsis), context snippet, "Example" label.
6. **CLICK EXAMPLE:** populate input, highlight card (border glow). Modify text → highlight clears.
7. **EXAMPLES NOT READY (503):** show placeholder, allow user wish, no block.
8. **KEYBOARD:** example cards focusable, Enter to select.
9. **WISH PRIVACY LINE:** near the wish input, one short line says that wishes are sent to Google's Gemini to write the
   curses, so the user should not type personal details. It is in the page's voice (tone.md: dry, eerie, short), its
   text is a constant in `api-messages.ts`, and it is tied to the wish input with `aria-describedby` (together with the
   message's id when a message shows). Its text is at least 1rem and meets AA contrast. It changes no layout beyond its
   own line.

### Requirement 4: Curse circles and binding card

**User story:** As a spec author, I want each curse to fill its circle and then click to open a binding
card where I propose a fix.

**Acceptance criteria:**

1. **CURSE ARRIVES:** animate circle fill (centre outward, 300ms, ease-out), vignette frame, curse-type
   label (sepia, top), story (1–2 lines, serif, centre), red wax seal icon (centre-bottom, unbroken).
2. **CLICK FILLED CIRCLE:** open binding card modal (parchment, ornate border):
   - Top: curse story + loophole quote (repeated for context).
   - Editor: pre-filled suggested EARS clause (editable).
   - Buttons: "Accept this clause", "Rewrite the whole wish", "Cancel".
3. **CLICK "ACCEPT":**
   - Call `POST /api/bind` with `{ grant, curseId, clause, kind: "ears-clause" }`.
   - Loading: "The Judge stirs…".
   - Verdict `closed: true`: seal closes (200ms), circle → laurel wreath (sepia), the most recently
     curled digit opens (Req 2, step 8; Req 5, step 3), play sigh sound. Close card.
   - Verdict `closed: false`: seal cracks (200ms), "The paw remembers." in blood-red appears below seal,
     tense sound, card stays open.
   - Error: show in-character error.
4. **CLICK "REWRITE":** close card, clear grant (curses disappear, paw→rest, circles empty), reset input.
5. **MOBILE:** full-screen or large bottom sheet, scrollable.
6. **KEYBOARD:** card focusable, navigate with Tab/Shift+Tab, Enter submits, Escape closes.

### Requirement 5: Paw state machine (LIFO)

**User story:** As an observer, I want fingers to curl in predictable order and open in LIFO sequence.

**Acceptance criteria:**

1. **MAINTAIN STATE:** THE SYSTEM SHALL keep `curled = []`, a stack of digit indexes (0–4 = thumb, index,
   middle, ring, little) in curl order. It holds digits, not curse IDs.
2. **CURSE ARRIVES:** WHEN a curse arrives, THE SYSTEM SHALL map curse n (1-based, in the order the Grant
   lists its curses) to digit n, push that digit onto `curled`, and animate its curl. The order is always
   thumb → index → middle → ring → little (never out of order). A Grant has 3–5 curses, so the digits beyond
   the curse count stay open. IF several curses arrive together, THE SYSTEM SHALL queue the curls and play
   them one after another.
3. **JUDGMENT CLOSES:** WHEN the Judge returns `closed: true` for a curse that is not yet closed, THE SYSTEM
   SHALL pop the top digit of `curled` and animate that digit open, whichever circle was bound. LIFO ensures
   the thumb opens last.
4. **NEVER TWO FINGERS ANIMATE SIMULTANEOUSLY** (Req 2, step 7); each curl/open sequential.
5. **FAILED JUDGMENT:** don't modify `curled`, don't animate finger; finger stays curled.
6. **EXPOSE AND KEEP IN STEP:** THE SYSTEM SHALL expose `curled.length` as the current finger count. WHEN
   all queued curls and opens have finished, THE SYSTEM SHALL keep `curled.length` equal to the number of
   curses in the Grant that are not yet closed.
7. **IDEMPOTENT CLOSE:** IF the Judge returns `closed: true` for a curse that is already closed, THEN THE
   SYSTEM SHALL NOT pop `curled` and SHALL NOT animate any digit.
8. **CIRCLES INDEPENDENT OF THE STACK:** THE SYSTEM SHALL map circle n to curse n regardless of the contents
   of `curled`. WHEN a verdict closes a curse, THE SYSTEM SHALL give that curse's own circle its seal and
   laurel, while the digit that opens is chosen only by the stack.

### Requirement 6: Rest state and integrity

**User story:** As a spec author, I want to see my final integrity score (0–5 laurels) and download my spec.

**Acceptance criteria:**

1. **WHEN EVERY CURLED DIGIT HAS BEEN OPENED** (`curled` is empty after a pop, which means every curse is
   closed), THE SYSTEM SHALL transition to rest:
   - Rest moment: all five digits open (the `rest` clip pose, or every runtime-control `amount` at 0), plus a
     slow whole-paw sink and tilt done in code on the `wrist` joint or the model root. It lasts about 2s.
     THE SYSTEM SHALL NOT use the `sequence` clip for this.
   - WHILE `prefers-reduced-motion: reduce` is set, THE SYSTEM SHALL apply the rest pose, sink and tilt
     instantly.
   - WHEN the user clicks "Rewrite" (after this ending or after the stop ending of criterion 7), THE SYSTEM
     SHALL return the paw upright, restore every digit to open (`amount` 0), and clear `curled`.
   - WHILE no Grant is active, THE SYSTEM SHALL idle the paw in the `rest` pose and SHALL NOT show the medal.
   - THE SYSTEM SHALL show the final circles, the medal and the export buttons per criterion 8.
2. **TWO EXPORT BUTTONS:**
   - **"Take the scroll":** call `POST /api/export`, download ZIP with `requirements.md` +
     `properties.md` as `monkeys-paw-<wishId>.zip`. On success: confirm ("Scroll saved!"). On error: show
     error.
   - **"Open in Kiro":** call `POST /api/export`, render modal with copy-to-clipboard: drop folder into
     `.kiro/specs/`, run `kiro open monkeys-paw-<name>`.
3. **OPTIONAL SHARE CARD:** render parchment plate image with all circles and one highlighted curse;
   buttons: "Copy image", "Tweet", "Copy link".
4. **MOBILE:** buttons vertically stacked, larger tap targets (40px+).
5. **PERSIST** until user clicks "Rewrite" or page refreshes (no auto-save; no persistent storage).
6. **STOP CONTROL:** WHILE a Grant is active and at least one curse is still open, THE SYSTEM SHALL show a
   "Stop and take the scroll" control. It SHALL be reachable by keyboard and activatable with Enter and Space.
   WHILE no Grant is active, or WHILE every curse is closed, THE SYSTEM SHALL NOT show it.
7. **USER STOPS:** WHEN the user activates "Stop and take the scroll", THE SYSTEM SHALL end the round
   without a rest moment: curled digits stay curled (`curled` is not modified), no digit opens, and there is
   no sink or tilt. Each open circle SHALL show the cracked seal and "The paw remembers." Each closed circle
   keeps its laurel.
8. **FINAL DISPLAY (BOTH ENDINGS):** WHEN the round ends, either by criterion 1 (all curses closed) or by
   criterion 7 (user stops), THE SYSTEM SHALL show the "Wish Integrity" medal and the two export buttons of
   criterion 2. The medal SHALL show 0–5 filled laurels computed per the Glossary and the text
   "Integrity N/5: M closed, O open", where M is the number of closed curses and O the number of open curses.
   WHEN every curse is closed, O is 0 and N is 5.
9. **LOCK AFTER THE END:** WHILE the round has ended, either by criterion 1 or by criterion 7, THE SYSTEM
   SHALL NOT open the binding card when a circle is activated, and SHALL NOT make any further
   `POST /api/bind` call. This holds until the user clicks "Rewrite". The medal therefore never goes stale.
   Circles SHALL remain keyboard focusable and SHALL announce their final state (closed with laurel, or open
   with the cracked seal).
10. **STOP DURING QUEUED CURLS:** IF the user activates "Stop and take the scroll" while curls are still queued
    or playing, THEN THE SYSTEM SHALL complete the remaining queued curls instantly, without animation, before
    the round ends, so that the paw shows exactly one curled digit per open curse. Likewise, an open animation
    in progress SHALL finish instantly. The "`curled` is not modified" clause of criterion 7 applies to the
    stop action itself and not to these completed queued curls.

### Requirement 7: Sound design

**User story:** As a user with audio enabled, I want subtle Victorian sound effects for key moments.

**Acceptance criteria:**

1. **TOGGLE:** small engraved speaker icon (sepia, top-right, ~20px), default OFF.
2. **WHEN ON, PLAY:**
   - **Creak** (500ms, wood): finger curls.
   - **Stamp** (300ms, seal): "Granted." appears.
   - **Sigh** (800ms, relief): finger opens.
   - **Crack** (200ms, brittle): seal cracks.
3. **AUDIO:** CC0/original, ~128kbps MP3 or WAV, total <500KB.
4. **STORAGE:** localStorage key `pawSoundEnabled`; restore on reload.
5. **MIX:** –12dB peak, no clipping; fade out previous effect over 100ms if new one starts.

### Requirement 8: Accessibility

**User story:** As a user with keyboard or assistive tech, I want full access to all features.

**Acceptance criteria:**

1. **KEYBOARD:**
   - Tab order: wish input → context → "Make" button → examples → circles → binding card →
     "Stop and take the scroll" → export buttons.
   - Enter: submit input, activate example, accept binding, click export.
   - Escape: close binding card, deselect example.
   - Focus indicators: outline/glow/border, contrast ≥3:1.
2. **REDUCED MOTION (`prefers-reduced-motion: reduce`):**
   - No finger/circle/seal animations; state changes instant.
   - No brazier/curtain animations.
   - Transitions <100ms.
   - State labels persist ("Finger curled", "Seal cracks").
3. **CONTRAST:** WCAG AA (≥4.5:1 body, ≥3:1 large). Ink on parchment ~11:1, sepia ~5:1, blood-red ~6:1.
   Blood-red buttons: add darker red or border for interactive ≥3:1.
4. **SCREEN READER:**
   - Buttons/inputs: descriptive `aria-label`.
   - Circles: `aria-label` with curse type + status (e.g. "Permissions curse, open, click to bind").
   - Integrity display: `aria-live="polite"`, announce score.
   - Binding card: `role="dialog"`, `aria-labelledby`, `aria-describedby`.
   - SVG: `aria-hidden="true"` if decorative, `aria-label` if semantic.
5. **TEXT:** base ≥16px mobile / ≥18px desktop, line-height ≥1.5, 200% zoom without horizontal scroll.

### Requirement 9: Mobile and responsive

**User story:** As a mobile user, I want the UI to adapt so the paw stays visible and layout remains navigable.

**Acceptance criteria:**

1. **MOBILE (≤768px):**
   - Paw: ~150–200px (responsive).
   - Circles: vertical list below paw (~60px diameter, full-width with margins).
   - Inputs: vertical stack or wrap.
   - Examples: 3 visible in horizontal scroll or carousel.
   - Binding card: full-screen or large bottom sheet (80vh), scrollable.
   - Border: simplified (thinner, fewer details).
   - Sound/chrome: bottom-right, larger tap target (40px).
2. **DESKTOP (>768px):**
   - Paw: full scale (~300–400px).
   - Circles: arc around paw (2–3 above, 2 below).
   - Inputs: side-by-side with button.
   - Examples: horizontal row, 5+ visible.
   - Binding card: centred modal (~500px wide).
   - Border: full ornate detail.
3. **TOUCH:** tap targets ≥48px. No hover-only states; use focus/active or `@media (hover: hover)`.
4. **ROTATION:** reflow instantly on portrait↔landscape, no full refresh.

### Requirement 10: Performance

**User story:** As a user opening the Paw, I want fast initial paint and smooth interactions.

**Acceptance criteria:**

1. **FCP:** ≤1.5s on fast 3G (parchment, border, wish line, poster visible).
2. **LCP:** ≤3.0s on fast 3G (GLB loads or poster stays visible).
3. **CLS:** <0.1 (fixed layout, no shifts on GLB load).
4. **BUNDLE:** <200KB gzipped (excl. GLB, JPG).
5. **GLB:** pre-select mobile.glb (≤768px) or web.glb (>768px), lazy load, show poster while loading.
6. **FIRST FRAME:** ≤16ms from GLB loaded (60 FPS, one frame latency).
7. **NO JANK:** no layout thrashing, reflow <100ms on resize, input responsive.

### Requirement 11: Privacy and data

**User story:** As a user, I want my wishes to remain private and never stored.

**Acceptance criteria:**

1. **NO CLIENT STORAGE** of wishes, grants, bindings (all state in-memory, React/three.js).
2. **ON REFRESH/CLOSE:** all wishes and grants cleared.
3. **NO COOKIES** set by web app.
4. **API CALLS** via CORS (from API header), never include credentials.
5. **NO TELEMETRY** of wish text or user behaviour.
6. **URL:** never includes wish text, grant data, or tokens.

### Requirement 12: Assets and licensing

**User story:** As a player, I want authentic Victorian aesthetics and properly licensed assets.

**Acceptance criteria:**

1. **3D PAW:** paw-web.glb (2.9MB, desktop), paw-mobile.glb (2.0MB, mobile), from Blender/Tripo AI,
   9,989 quads, zero claw crossings.
2. **FONTS:** OFL-licensed serif (IM Fell English or Playfair Display for display, Crimson Text or Lora for
   body). Never proprietary or unlicensed.
3. **ARTWORK:** original (SVG border, braziers, curtains). Poster.jpg: original only.
4. **SOUND:** CC0 or original recordings (no copyrighted).
5. **COLOURS:** custom palette, not brand.
6. **LICENSE:** MIT on repo. Assets: OFL fonts, CC0 audio, original art, Blender models.

