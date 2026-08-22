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
