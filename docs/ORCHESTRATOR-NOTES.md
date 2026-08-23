# Orchestrator notes — observations from the reference that are easy to miss

These are things I verified myself against the frames. They are binding, same as the
contract. `docs/REFERENCE.md` (written by the reference analyst) is the fuller document;
this file holds the specific traps.

## 1. The beam's warm fringe is CHIRAL, not symmetric

This is the single most characteristic property of the reference beam and every naive
implementation gets it wrong by making the beam symmetric.

Evidence, `ref_025.jpg`:
- The top corridor beam travels **right**. Its amber/gold fringe sits along its
  **bottom** edge.
- The middle corridor beam travels **left**. Its amber/gold fringe sits along its
  **top** edge.

Both beams are horizontal, so this is not a global "warm underneath" gradient. The warm
fringe is on the **right-hand side of the direction of travel**, and there is a
correspondingly cooler, faintly blue-white fringe on the left-hand side. It reads as the
beam itself being very slightly dispersed — a prismatic edge on a beam of white light.

**SUPERSEDED IN PART — read `docs/REFERENCE.md` 4.2, which is more accurate than this
note.** My "right-hand side of travel" rule happens to fit generations 0 and 2 but fails
on the others. The measured truth is better: the transverse fringe axis is a real property
carried by the ray and **mirrored at every reflection**, like physical handedness. The
tracer therefore emits a signed `perp` field (+1 / -1) on every segment, initialised to +1
at the emitter and flipped at each mirror bounce. See the segment shape in
`ARCHITECTURE.md` section 4.

Implementation: in the beam fragment shader, the cross-sectional coordinate must be
**signed**, multiplied by the segment's `perp`, and the shoulder tint lerps from cool on
the negative side to warm on the positive side. Do not use `abs()` on the cross-section
coordinate for the tint — only for the intensity profile, which IS symmetric. Concretely,
REFERENCE.md 4.2 gives it as: offset the R channel's profile by +2.6 px and the B channel's
by -2.6 px along `perp`, then boost the resulting chroma difference by about 1.3x.

## 2. Receptors are always emissive

They are not dark-when-unsolved. In every frame, including `ref_001.jpg` where nothing
has been placed yet, all three receptor rings glow strongly in their own colour with
visible bloom, and their flags are already coloured. Satisfaction is communicated by an
*increase* — a brighter ring, a saturated core, a raised flag, a burst — not by turning
a dark thing on. Building them dark-until-lit will read as wrong immediately.

## 3. A prism does not only disperse

`ref_025.jpg` shows, besides the rainbow fan: a broad grey/white wedge continuing
down-left, and a thin grey line going down-right. These are Fresnel reflections off the
prism's entry and exit faces. They are dim, desaturated and important — they are most of
what makes the prism read as a physical piece of glass rather than a rainbow dispenser.
The tracer should emit a low-intensity reflected ray at each prism surface.

## 4. The angle readout in the reference is unnormalised — beat it

`ref_030.jpg` reads `377.5°`. The reference is accumulating raw drag rotation instead of
normalising. Ours normalises to `0–360` (or better, shows the angle relative to the
board axis). This is one of several places where the reference is simply worse and we
should not copy it.

## 5. Other places the reference is weak, where we should beat it

- The SOLVED panel offers only `FREE PLAY` — no next level, no move count comparison
  beyond a single line, no route back to the level grid.
- The inventory dock tiles are cramped and their count badges collide with the tile edge.
- There is no visible feedback when a receptor is receiving the *wrong* colour, so a
  near-miss is indistinguishable from a total miss.
- The hint line under the board is nearly unreadable at the reference's contrast.
- Beam intersections just add up and blow out to flat white; there is no sense of the
  beams crossing.
- Nothing in the reference reacts to a beam passing close to a wall other than the bloom
  spilling onto it.

## 6. Measured geometry sanity checks

Frame is 720 x 694. Board outer box spans roughly x 80–645, y 55–620, so the board is
square at about 565 px, and the outer wall ring is about 18 px thick — 3.2% of the board,
which matches the 30/1000 units in the contract. Keep it.

## 7. Cursor

The reference cursor is a blue-filled arrow with a white outline, an open blue hand while
dragging out of the dock, and a blue pointing hand over buttons. Our Kenney set is white
with a dark outline; tint the fill to match this blue for the local player, and give each
remote player a different fill colour from the same family.

---

## 8. THIS IS NOT A CLONE — decided by Jurek, 2026-08-22

Explicit instruction: *"to nie powinno być 1:1! Zrób takie działanie ale mapy mogą być
inne."* The **mechanic** is what we reproduce — a white beam, mirrors that steer it,
prisms that split it into a real dispersed spectrum, three coloured receptors that each
need their own colour, an inventory with a par count. The **maps are ours**.

What this changes:

- **Levels are original.** All 24 are our own design. Do not reconstruct the reference's
  "LEVEL 13 — THE LONG SPECTRUM" layout, and do not use its name. Our levels get our
  names and our geometry. This was already the brief for the levels builder; it is now
  binding for everyone.
- **The reference is a QUALITY BAR, not a template.** We copy craft: the beam's physical
  profile, the chiral warm/cool fringe, the bloom falloff, the dispersion physics, the
  restraint of the chrome, the sense that the board is a lit physical object. We do not
  copy its wall positions, its level, or its exact HUD arrangement.
- **The blind comparison changes shape.** Because the layouts differ, the critic can no
  longer be asked "which panel is the same frame". The question becomes: *"one of these
  two screenshots is from a polished commercial puzzle game and one is from an amateur
  build — which is which, and what gave it away?"* That is a harder and more honest test
  than layout matching, and it is the test we now run. The scenes must therefore be
  matched by KIND — a long straight beam against a long straight beam, a dispersion fan
  against a dispersion fan, a selection protractor against a selection protractor — not
  by layout.
- **We are free to be better-looking.** Anywhere our own art direction beats the
  reference, take it. Section 5 lists where the reference is already weak.

---

## 9. My own reading of the build, 2026-08-23

I drove the real game and compared it against the reference myself. These are the tells I
can see, in priority order. A critic may phrase them differently; these are binding
regardless.

### 9.1 The beam reads as vector art, not as light — this is the biggest tell

Two faults compound:

1. **The fringe is a hard-edged coloured outline.** Right now there is a distinct
   red-orange line and a distinct blue line running along the beam's two edges, crisp
   enough to look like a sticker or a chromatic-aberration artifact on a solid bar. The
   reference's shoulders are SOFT: measured in REFERENCE.md 4.2, the warm shoulder peaks
   around 0.9–1.4x the FWHM half-width and blends back into the core over roughly 15 px.
   Ours transitions in about 2 px. The fringe must be a gradient across the beam's whole
   shoulder region, not a stroke at its border.
2. **There is no grain.** The core is perfectly, mathematically smooth. REFERENCE.md 4.3
   measured anisotropic noise concentrated in the core — correlation length about 3 px
   across the beam and 8–18 px along it, and recommends authoring at 4–6 % RMS because
   video compression eats it down to the measured 1.2 %. A flawless gradient is the single
   clearest "clean vector render" signature.

Together these make the beam look like a white pipe with coloured piping. It should look
like a volume of lit, dusty air.

### 9.2 The dispersion fan is too saturated and too even

It currently reads like a CSS linear-gradient rainbow: vivid green, uniform width, printed
edges. REFERENCE.md 5.2 measured the opposite — **green is the LEAST saturated point in
the fan (0.22–0.31)**, hue separation does not begin until about 120 units from the prism,
and the fan brightens near the prism and widens as it travels. Ours separates immediately
and holds a near-constant width. Desaturate the middle of the fan, delay the separation,
and let the wedge genuinely spread.

### 9.3 Light still does not reach the walls

Proximity lighting was implemented but I cannot see it. In a frame with several beams at
full brightness passing within a hundred units of brick, the brick is visually unchanged.
Either the light array is not being populated, the falloff constants are far too tight, or
the contribution is being added below the visible threshold. Verify it by capturing one
frame with beams and one without and differencing the wall pixels — if the difference is
under a couple of percent it is not working, which is exactly the reference's failure that
we said we would beat.

### 9.4 Interior wall slabs look pasted on

The border ring and the interior slabs use visibly different brick scales, and the interior
slabs have hard rectangular edges with no bevel or contact shadow, so they read as
rectangles laid on top of the board rather than masonry belonging to it. Brick scale must
be continuous across every wall, and interior slabs need the same top-left lighting and
far-edge rim the border has.

### 9.5 Mirrors are nearly invisible

At a glance a placed mirror is a thin white line that disappears against a bright beam. It
needs enough substrate and contrast to read as a physical object even when lit hard.

### 9.6 Level colour legibility

At least one level pairs blue with cyan among its three receptors, which are hard to tell
apart at ring size and harder once the fan is on them. Prefer maximally distinct triples.

## 10. Beam, after the round-2 restoration — two faults remain

The antisymmetric-fringe rewrite was the right diagnosis and the per-channel numbers now
track REFERENCE.md 4.2 closely. Width is also fine: our FWHM measures about 57 board units
against the reference's 54.6, so anyone reporting the beam as "too thin" or "too fat" is
measuring in frame pixels without converting through the board scale. Do not chase width.

What is still wrong is brightness distribution, in two specific ways:

### 10.1 RETRACTED — I was wrong about the grain

I wrote here that the grain was far too strong and was perforating the core. That was an
eyeball call and it is wrong. The round-2 beam critic measured the rendered output
properly: **0.23 % RMS on our beam centreline against 0.96 % measured on the reference
frame**, using a 13-px running-mean subtraction on the residual. The grain is roughly four
times too WEAK, not too strong, even though the shader comment claims to author 4.6 %.
Something between the authored amplitude and the final composite is swallowing it.

Keep this retraction visible rather than deleting it: a measured number beats an
impression, and the streaky, semi-transparent look I was reacting to comes from the beam
being too dim overall — see 10.2 — not from noise eating the core.

### 10.2 There is almost no bloom halo

In the reference a beam sits inside a broad, soft glow that reaches well beyond the beam's
own width and lifts the black around it. Ours falls to background within a few pixels of
the shoulders, which is what makes it read as a flat drawn shape rather than a light
source. This is the pipeline's bloom, not the beam shader: the beam must write HDR values
well above 1.0 in its core so the bright-pass has something to work with, and the bloom's
radius and intensity must be large enough to produce a visible halo. Verify by measuring
how far from the beam centreline the frame is still measurably above the empty-board black,
and compare that distance against the same measurement on ref_001.jpg.

### 10.3 Width is correct — do not chase it

Our FWHM measures about 57 board units against the reference's 54.6. Anyone reporting the
beam as "too thin" or "too fat" is measuring in frame pixels without converting through the
board scale: the reference frame is 720 px wide with a 568 px board (0.568 px per unit),
our captures are 1440 px with a ~1130 px board (1.13 px per unit). Convert before comparing.

