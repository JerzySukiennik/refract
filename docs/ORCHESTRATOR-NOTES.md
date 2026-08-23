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


---

## 11. Round 2 outcome, and the overshoot to fix now

Round 2 closed six well-measured gaps and the build is much stronger: grain is on screen at
1.05 % RMS against the reference's 0.95, the brick bond is world-space, mirrors have a
silhouette again, the protractor reads correctly with no ticks, rotation ticks through all
18 detents with accented magnets and haptics, and the fan is rebuilt on linear spectral
power so additive blending integrates correctly. The fan is now properly neutral near the
prism, which was the round-1 complaint.

### 11.1 RECEPTOR GLOW HAS MASSIVELY OVERSHOT — top priority

This is now the worst thing in the game by a wide margin, and it is the same overshoot
pattern that hit the beam in round 1: a critic correctly said "receptors read as unlit
icons whose halo dies 8 px out", and the fix went so far the other way that each receptor
now paints a saturated blob roughly 300 px across. On the SWITCHBACK dispersion capture the
blue receptor's glow covers something like a quarter of the board and completely obliterates
the rainbow fan that the level exists to show. Three receptors sitting near each other merge
into one continuous wash of light.

The rule: a receptor is a small lamp, not a floodlight. It should read as clearly emissive
and it should tint the board immediately around it — but the fan, the beams, the brick and
the other receptors must all remain fully legible through it. Concretely, bring the halo
down until its contribution has fallen below a few percent of peak by roughly one ring
diameter out, and make sure two adjacent receptors do not merge. Then verify on the
dispersion capture that the FAN IS THE BRIGHTEST THING IN THAT REGION, because it is the
subject of the shot.

### 11.2 The lesson, now twice

Both times a critic's gap was real and the fix overshot it. When a critic says "X is too
small / too dim / too weak", the correct move is to measure the reference's value, move to
that value, then capture and confirm you landed ON it. Do not move until it "looks
different". Every builder brief now says this and it still happened, so verify it in review
rather than trusting the report.

### 11.3 Also outstanding, from the round-2 critics' own next-three lists

- The beam's haze skirt is 4–18x too strong: lateral falloff reads 8.5 / 6.0 / 4.6 % of
  core at 26 / 30 / 40 px against the reference's 3.2 / 1.3 / 0.25 %. It dissolves the
  sharp V at every mirror and stops the beam ever reaching black.
- Per-bounce attenuation is invisible: our generations measure 0.801 / 0.787 / 0.750
  (−1.7 %, −4.7 %) where the reference shows 0.885 / 0.755 (−14.7 %) for the contract's
  10 % per bounce. A four-bounce path currently reads uniformly bright and loses all sense
  of travel.
- The emitter housing is oversized: 31 x 22 reference px against the measured 17 x 18, fill
  #605E67 against #4D4B50, and its slit spans 44 px against a beam FWHM of 33 — the
  reference's slit is exactly the FWHM, so aperture and beam agree.
- `solver.solve` intermittently returns nothing, which makes `script('folding')` and
  `script('solved')` occasionally capture an empty board. Two separate agents hit this and
  lost measurements to it. It needs a real fix, not a retry.

## 12. Ownership gap: mobile/touch has no owner

The round-3 `feel` critic reported: *"THE TOUCH LAYER IS STILL BUILT AT MOUSE SCALE — round 2
flagged it and round 3 did not move it."* That is not a builder being lazy. It is my
decomposition failing.

Mobile correctness spans three different builders' file sets:
- tap target sizes for the rotate handle live in `js/input.js` (the `feel` builder)
- HUD chip sizes and the tap-to-place ghost live in `js/ui/hud.js` and `css/ui.css` (the
  `hud` builder)
- how much of the phone screen the board occupies lives in `js/render/gl.js` (nobody's)

Each round every builder correctly reported "not my files" and moved on, so the item has
survived two full rounds untouched. Whenever a defect keeps reappearing with "not mine"
attached, the fix is a builder whose file set matches the defect's real shape — not another
round of the same split.

**Round 4 must run a single MOBILE builder owning `js/input.js`, `js/ui/hud.js`,
`css/ui.css` and `js/render/gl.js` together**, briefed on: 44 px minimum touch targets, a
ghost preview for the tap-to-place path so the player is not tapping blind, and a board that
uses the phone screen properly (it currently renders 296 px inside an 812 px viewport,
leaving about 64 % of the screen empty). Primary target is Safari on an iPhone XR.

The same lesson applies generally: piece boundaries are drawn for the RENDERER's benefit,
and a defect that lives across them needs a differently-shaped owner for one round.

---

## 13. Round 3 outcome, and two process faults that were mine

Round 3 went well on craft. Notably, agents stopped overshooting: the receptor-glow builder
measured the reference itself first (5 % crossing at one ring diameter), took three measured
steps, re-captured after each, and deliberately stopped just short of the reference rather
than sailing past it. The beam builder refused to change two of its three assigned defects
because they were already closed at HEAD, and said so with numbers. That is exactly right.

### 13.1 My briefs carried stale numbers

Twice a builder was handed a defect described with figures from the PREVIOUS round's critic,
which a round-2 commit had already fixed. The beam builder had to spend its turn proving the
brief wrong instead of improving anything. **Brief from a fresh measurement of HEAD, never
from the last round's critic text.** Where a round-N critic's number is quoted into round
N+1, re-verify it against HEAD first or mark it explicitly as unverified.

### 13.2 The perf test was lying, and I let four agents wave it off

`tools/test-optics.mjs` timed max-of-N traces on `prismLevel` — an EMPTY box where nothing
absorbs, so every Fresnel reflection survives to bounce for its full depth budget. No real
board looks like that. It reported "slowest trace 11 ms" and four agents in a row correctly
sensed the number was unrepresentative and dismissed it as environmental. Each was right
that the test was bad and wrong that nothing was there.

The real distribution on a real level: **p50 0.98 ms, p99 8.97 ms, max 10.4 ms** on FEEDING
THE SECOND (442 segments). The median is comfortably inside budget; the p99 is not. The gap
is allocation — the tracer builds a fresh segment object per segment per call, so a drag at
60 Hz produces roughly 12k objects a second and the collector periodically stops the world
for ~9 ms. The player feels that as a hitch on the one interaction that has to be smooth,
and it will be worse on the target Intel MacBook.

The test now asserts p50 and p99 separately on the heaviest real level and names the cause.

**Lesson: when several independent agents dismiss the same signal, the usual fault is the
instrument, not the signal.** Fix the instrument before either believing or dismissing it.

### 13.3 Outstanding for round 4

1. **Pool the trace's segment objects** so p99 comes down to the median. `solver.js` holds
   two results at once, so pooling needs an explicit copy-on-retain, not a silent reuse.
2. **Mobile, with one owner** covering `js/input.js`, `js/ui/hud.js`, `css/ui.css` and
   `js/render/gl.js` together — see section 12. Round 3's feel builder closed the parts it
   owned (rotate handle now 43.8 px against a 44 px target, dock drag works on touch, long
   press removes, haptics on every event) and correctly reported the rest as not its files:
   HUD chips still 45x19.8 px against a 44 px minimum, modal buttons 26.5 px tall, text
   inputs 28.2 px, tap-to-place still draws no ghost, and the board uses 28.7 % of a phone
   screen with 375 px of dead vertical space.
3. **The emitter mouth**, which the round-3 beam critic called the single biggest gap and
   which lives in `board.js`, not `beams.js` — so the beam builder could not touch it. Give
   it to whoever owns `board.js`.

---

## 14. Jurek's play-test, 2026-08-23: the prism must be a piece, not scenery

Feedback while playing: *"Nie da się obracać ani poruszać tego refraktora — on powinien być
jako drugi coś do położenia przez graczy!"* — you cannot rotate or move the refractor; it
should be the second thing players place.

He was right, and it was a real defect rather than a preference. Levels 1–4 and TERMINUS
shipped the prism in `fixed:` with `inventory.prism = 0`, so across the entire opening of
the game the prism was scenery: unselectable, unrotatable, unmovable. The player met the
game's second mechanic as something they could only look at.

Fixed: every prism is now inventory on every level. `fixed:` is reserved for MIRRORS used
deliberately as obstacles (FIXED IDEAS, CATHEDRAL), which is a real mechanic; it must never
again hold the piece a level is teaching.

**Design rule, binding from now on: if a level introduces or depends on a mechanic, the
player must be able to hold that mechanic in their hands.** A pre-placed example is a
tutorial device, not a substitute for the verb.

Consequence to remember: freeing the prism lowered the true minimum on two levels, because
a placeable prism can go anywhere. Par must equal the true minimum (ARCHITECTURE.md 12), so
THE LONG FALL went 3 → 2 and TERMINUS went 5 → 3.

### 14.1 Queued: TERMINUS needs a design pass

TERMINUS is the final level and now falls to three optics. It has only two interior walls,
so the board is too open to force a long path — the solver finds
`prism@500,200 + mirror@200,550 + mirror@300,350`. Lowering par kept the game honest but
cost the finale its weight.

The fix is geometry, not par: add interior structure so a fan thrown near the emitter cannot
reach all three receptors, forcing the beam to travel before it is split. The solver is the
verifier — change walls, re-run `node tools/validate-levels.mjs`, and iterate until the
minimum is back at 5 with the authored solution intact. Do not simply raise par; the
validator will correctly reject it.
