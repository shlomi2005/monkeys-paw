# UI brief — "The Living Engraving"

Art direction (chosen): a Victorian 1900s engraving on aged parchment. Sepia and black ink, cross-hatching, ornate
frames, one accent colour only: blood red. Reference: `docs/art/concept-victorian.png`.

## The page
- One parchment "plate" fills the screen, with an ornate engraved border, two smoking braziers at the sides and
  heavy curtains in the corners (subtle idle animation: smoke drifts, curtains breathe).
- Centre: **the paw**, drawn as a living engraving: a 3D paw rendered with an ink cross-hatching shader so it looks
  printed, yet its five fingers curl and open smoothly. A red cord is tied around the wrist.
- Around the paw: **five wish circles** in an arc, exactly like the concept. Empty circles are blank parchment.
  When a curse arrives, its circle fills with an engraved vignette title, the curse type as a small engraved label,
  and the 1–2 sentence curse. One circle = one finger.
- Bottom: the **wish line**, a quill-and-ink input on a ruled band: "I wish that…" plus an optional "for…" context
  field and a "Make the wish" seal button. Under it, a row of example wishes as small calling cards.

## The moments
1. **Make the wish** → the ink of the wish line soaks into the paper, the paw twitches, red rays pulse behind it,
   "Granted." is stamped in red, and the Genie's narration appears as an engraved caption.
2. **A curse lands** → one finger curls with a dry creak; its circle fills with ink from the centre outwards.
3. **Bind the loophole** → clicking a circle opens a "binding" card: the suggested EARS clause in an editable field
   (plus "or rewrite the whole wish"). Submit = a red wax seal presses onto the circle.
4. **The Judge's verdict** → closed: the seal holds, the finger opens with a sigh, the circle turns to a calm
   engraved laurel. Not closed: the seal cracks and a line appears: "The paw remembers."
5. **The paw rests** (all open) → the paw lies down flat; a "Wish Integrity" medal (0–5 laurels) is engraved;
   two buttons: "Take the scroll" (download `requirements.md` + `properties.md`) and "Open in Kiro" (zip with
   `.kiro/specs/<name>/`). A share card renders the plate with the funniest curse.

## Type and colour
- Display: an engraved Victorian serif (OFL, e.g. "IM Fell English" or "Playfair Display"); body: a readable serif.
- Colours: parchment #e9d8b4, ink #2b1d12, sepia #7a5a3a, blood red #8f1d14 (accent only).
- Contrast AA for all text; never light ink on light parchment for body text.

## Must-haves
- Works at phone width: circles become a vertical list under the paw; the paw stays visible and small.
- `prefers-reduced-motion`: no finger animation, swap to instant state + text cue.
- Keyboard: tab through wish line, example cards, circles, binding card; Enter to submit.
- Sound (off by default, a small engraved toggle): creak on curl, sigh on open, stamp on "Granted."
- Load fast: `docs/art/paw/paw-mobile.glb` (2.0 MB) on phones, `paw-web.glb` (2.9 MB) on desktop, and `paw-poster.jpg`
  as the static fallback while it loads or if WebGL is missing. Asset contract: `docs/art/paw/PAW-ASSET.md`.
- Finger order: curses curl thumb, index, middle, ring, little; a closed loophole opens the most recently curled digit.
