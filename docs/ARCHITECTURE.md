# REFRACT — Architecture Contract

This file is the **binding contract** between all builder agents. Module boundaries,
exported signatures and shared data shapes defined here MUST NOT be changed by a
builder without the orchestrator updating this file first. If a builder believes the
contract is wrong, it reports that in its result instead of silently changing it.

## 0. Product

Browser puzzle game. A white beam leaves an emitter, travels a walled maze, is steered
by player-placed **mirrors** and split by player-placed **prisms** into a real dispersed
spectrum. Three colored **receptors** must each receive light of their own color.
Solo + realtime multiplayer (shared board, named cursors).

Target quality bar: the reference frames in `reference/frames/` and `reference/dense/`.
Beating them is the goal, matching them is the floor.

**THIS IS NOT A CLONE.** Decided by Jurek, 2026-08-22: *"to nie powinno być 1:1! Zrób
takie działanie ale mapy mogą być inne."* We reproduce the **mechanic** and the **craft**.
The **maps are ours** — all 24 levels are original designs with original names. Do not
reconstruct the reference's "LEVEL 13 — THE LONG SPECTRUM" layout and do not reuse its
name. Copy the reference's beam physics, bloom falloff, dispersion, lighting and
restraint; do not copy its geometry. Where our own art direction beats the reference,
take it. Full detail: `docs/ORCHESTRATOR-NOTES.md` section 8 — **read that file, it is
binding**.

## 1. Stack & constraints

- Vanilla **ES modules**, no build step, no bundler, no framework. `<script type="module">`.
- **WebGL2** for the board (beams, walls, optics, bloom). DOM/CSS for HUD chrome.
- **Web Audio API** for sound, `.ogg` assets in `assets/audio/`.
- **Firebase RTDB** (compat-free modular SDK from CDN) for multiplayer.
- No `npm install` in the shipped site. CDN ES-module imports are allowed.
- English code, comments and commits. No inline commentary beyond a one-line file header.
- Every file must be delivered whole, never as a partial patch.

## 2. Directory layout

```
index.html            single entry, DOM chrome + <canvas id="board">
CNAME                 refract.gzowo.fun
css/ui.css            all HUD styling
js/main.js            bootstrap: load level, build state, run frame loop
js/state.js           central store + tiny event emitter
js/input.js           pointer/keyboard → intents
js/audio.js           sound bank + music
js/levels.js          LEVELS array (data only)
js/solver.js          validator + hint engine
js/net.js             Firebase multiplayer
js/optics/geometry.js vec math, segment/ray intersection
js/optics/spectrum.js CIE 1931 CMF, wavelength→linear sRGB, Sellmeier dispersion
js/optics/trace.js    the raytracer
js/render/gl.js       WebGL2 context, program/FBO/VAO helpers
js/render/textures.js procedural textures (brick, noise, grain)
js/render/pipeline.js HDR target → bloom chain → composite
js/render/beams.js    beam geometry + additive draw
js/render/board.js    walls, emitter, receptors, optic sprites, protractor
js/ui/hud.js          title, top-right buttons, inventory dock, used/par, hint line
js/ui/modals.js       solved / levels / name-entry / multiplayer panels
js/ui/cursors.js      local cursor styling + remote named cursors
assets/cursors/*.png  Kenney cursor pack (CC0)
assets/audio/*.ogg    Kenney audio (CC0)
progress/index.html   live progress page (round-by-round, screenshots)
docs/                 this contract + REFERENCE.md + round logs
tools/                dev-only scripts (screenshot capture, level validation)
```

## 3. Coordinate system

- Logical board space: **1000 × 1000 units**, origin top-left, +x right, +y down.
- Design grid: **50 units** per cell → 20 × 20 cells. Optics snap to 25-unit half-cells.
- Outer wall ring is **40 units** thick, occupying the border of the 1000×1000 box.
  Playable interior is therefore `[40, 960] × [40, 960]`. Interior ledges use the same
  40-unit thickness — the reference makes no distinction. (Measured at 38.7 u; rounded to
  40 for grid sanity. A 30 u wall reads visibly flimsy — see `docs/REFERENCE.md` §1.2.)
- The board is centred horizontally in the viewport but centred vertically in
  `viewportHeight − dockHeight`, so it sits slightly above true centre, as the reference
  does, leaving room for the inventory dock.
- The canvas is a square that fits the viewport with margin; `render/gl.js` owns the
  board→pixel transform and exposes it. UI code must never hardcode pixel positions
  of board features — ask the transform.
- Angles are in **radians**, measured counter-clockwise from +x, and stored normalized
  to `[0, 2π)`. The HUD prints plain `(angle * 180 / Math.PI).toFixed(1) + '°'`. There is
  no clockwise-from-up conversion — REFERENCE.md 10.3 conflict 2 measured the reference's
  readout as plain CCW-from-+x degrees.

## 4. Shared data shapes

```js
// A level (js/levels.js) — pure data, no functions.
{
  id: 13,
  name: 'SLOW WATER',                            // OUR name. Never reuse a reference name.
  par: 5,
  emitter: { x: 120, y: 175, dir: 0 },           // dir in radians, beam leaves this way
                                                 // Emitters are FREE-STANDING housings in
                                                 // the interior, clear of the wall — not
                                                 // fixtures embedded in it.
  walls: [ { x, y, w, h } ],                     // axis-aligned, board units, interior only
  receptors: [ { x, y, color: 'blue' } ],        // color ∈ 'red'|'orange'|'yellow'|'green'|'cyan'|'blue'|'violet'
  inventory: { mirror: 4, prism: 1 },
  fixed: [ { type:'mirror'|'prism', x, y, angle } ], // pre-placed, not removable
  hint: 'One prism, late.',
  solution: [ { type:'mirror', x, y, angle } ],  // REQUIRED. The author's known solution.
}

// A placed optic (runtime, in state).
{ id: 'o7', type: 'mirror'|'prism', x, y, angle, fixed: false, owner: 'p3'|null }

// A traced ray segment, produced by optics/trace.js
{ ax, ay, bx, by, nm, intensity, generation, terminal, perp }
//   nm         wavelength in nanometres, or 0 for composite white
//   intensity  0..1 linear radiance multiplier
//   generation bounce depth (0 = straight out of emitter)
//   terminal   null | 'wall' | 'receptor:<id>' | 'depth' | 'escape'
//   perp       +1 or -1. The sign of the ray's transverse frame, which decides which
//              shoulder of the beam is warm and which is cool. Initialised to +1 at the
//              emitter and FLIPPED at every mirror reflection, exactly as physical
//              handedness is. It must be carried by the tracer — the renderer cannot
//              derive it from the segment direction. See docs/REFERENCE.md 4.2, which
//              measured this across four generations of one beam path.

// Receptor evaluation, produced by optics/trace.js
{ id, color, litNm, litIntensity, satisfied: bool }
```

## 5. Module contracts

### js/optics/geometry.js
```js
export const EPS
export function raySegment(ox, oy, dx, dy, ax, ay, bx, by)   // → t | null
export function rayAABB(ox, oy, dx, dy, x, y, w, h)          // → {t, nx, ny} | null
export function reflect(dx, dy, nx, ny)                      // → [dx, dy]
export function refract(dx, dy, nx, ny, eta)                 // → [dx, dy] | null (TIR)
export function rotate(x, y, a)
export function norm(a)                                      // angle → [0, 2π)
```

### js/optics/spectrum.js
```js
export const NM_MIN, NM_MAX                     // 380, 700
export function cieXYZ(nm)                      // → [X, Y, Z]  (1931 2° CMF, analytic fit)
export function nmToLinearRGB(nm)               // → [r, g, b] linear, normalized to peak 1
export function nmToSRGB(nm)                    // → [r, g, b] 0..1 gamma-encoded
export function sellmeierIOR(nm, glass)         // → n; glass ∈ 'SF11'|'BK7'|'FLINT'
export function sampleWavelengths(count)        // → Float32Array, perceptually even spacing
export const RECEPTOR_BANDS                     // { blue:[435,490], green:[500,565], ... } nm windows
```
Dispersion must be **physical**: a high-dispersion flint glass (SF11-like, Abbe ≈ 25) so the
fan is visibly wide, matching the reference's broad rainbow wedge.

### js/optics/trace.js
```js
export function traceScene(level, optics, opts) 
// → { segments: RaySegment[], receptors: ReceptorEval[], solved: bool, stats: {...} }
```
Rules:
- The emitter emits **composite white** (`nm = 0`) which renders as the white/amber core beam.
- A white ray hitting a **prism** is split into `opts.spectralSamples` (default 48) wavelength
  rays at the entry face, each refracted by its own IOR, traced independently, and each
  refracted again at the exit face. Total energy is conserved: each sample carries
  `1 / spectralSamples` of the parent intensity.
- A wavelength ray hitting a prism refracts again (no further splitting).
- Mirrors are two-sided, perfectly reflecting, finite-length segments with a small
  thickness for hit-testing; grazing hits below `EPS` are ignored.
- Walls absorb. Rays terminate at walls.
- Max `opts.maxBounces` (default 64) and max `opts.maxSegments` (default 4000).
- A receptor is satisfied when the total intensity it receives inside its `RECEPTOR_BANDS`
  window is ≥ `opts.receptorThreshold` (default 0.06) **and** at least 3× the intensity it
  receives outside that window. White light alone must NOT satisfy a colored receptor.
- Must be **deterministic** and allocation-light: reuse buffers, target < 3 ms for a
  48-sample prism scene on an Intel MacBook.

### js/render/gl.js
```js
export function initGL(canvas)                  // → gl (WebGL2, no antialias, alpha:false)
export function createProgram(gl, vs, fs)
export function createFBO(gl, w, h, {float, linear})
export function createQuad(gl)
export function resize(gl, canvas)              // → {w, h, dpr}
export function boardToPixel(w, h)              // → {scale, ox, oy} board units → CSS px
export function pixelToBoard(px, py)            // → {x, y}
```

### js/render/pipeline.js
```js
export function createPipeline(gl)
// → { begin(w,h), drawSceneCallback, end(), setParams({bloom, grain, aberration, vignette, exposure}) }
```
HDR scene target (RGBA16F) → threshold → 5-tap progressive downsample/upsample bloom →
composite with ACES-ish tonemap, film grain, subtle chromatic aberration and vignette.

### js/render/beams.js
```js
export function createBeamRenderer(gl)
// → { upload(segments), draw(gl, viewProj, time), dispose() }
```
Each segment becomes a quad expanded along its normal. Fragment shader gives a
cross-sectional profile (hot near-white core, warm amber shoulders for white light;
spectral color for wavelength rays), animated longitudinal grain, and end caps.
Additive blending in linear HDR space.

### js/render/board.js
```js
export function createBoardRenderer(gl)
// → { draw(gl, level, optics, state, time), hitTest(x, y), dispose() }
```
Draws brick walls (procedural texture + mortar + subtle normal-ish shading), emitter
housing with glow, receptor rings and flags (unlit / lit states), mirror and prism
sprites, ghost preview during drag, and the protractor ring + angle readout for the
selected optic.

### js/state.js
```js
export const state          // plain object, single source of truth
export function on(evt, fn) / off / emit(evt, payload)
export function setLevel(index)
export function addOptic(partial) / removeOptic(id) / moveOptic(id, x, y) / rotateOptic(id, a)
export function undo() / redo() / reset()
```
`state` fields: `levelIndex, level, optics[], selectedId, dragging, trace, solved, used,
sound, players{}, me, roomId, mode('solo'|'multi')`.
Every mutation emits `'change'` exactly once and re-runs the trace **at most once per frame**.

### js/ui/hud.js / modals.js / cursors.js
DOM only. They read `state`, subscribe to `'change'`, and call the exported mutators.
They never touch WebGL.

### js/net.js
```js
export async function joinRoom(roomId, name)   // → { leave(), setCursor(x,y), broadcast(op) }
```
Firebase RTDB, project on `gzowotesla@gmail.com`. Room path `rooms/<id>` with
`optics/`, `players/<uid>` (name, color, cursor x/y, lastSeen), `level`. Presence via
`onDisconnect`. Optics ops are last-write-wins per optic id. `apiKey` in the Firebase
web config is a public client identifier and is allowed in the repo.

## 6. Non-negotiable feel rules

- 60 fps on an Intel MacBook Pro 2019 with integrated graphics. If an effect drops
  below that, reduce its quality, do not drop the frame budget.
- Every interaction has audio feedback and a sub-150 ms visual response.
- Rotation snaps to 5° with a magnet at 15° multiples; holding Shift disables snapping.
- Nothing pops in. Placement, selection, solving and receptor lighting are all animated.
- The native OS cursor is never visible once the game is running.

## 7. Definition of done for a piece

A piece is done when an independent critic, running the real game and capturing real
screenshots, cannot pick our build out of a blind side-by-side against the reference
frames — and then one more round past that.

## 8. Firebase (resolved)

Reuse the shared `gzowos-games` RTDB project (the Google Cloud project quota on this
account is exhausted, so all games share it and isolate by top-level branch). Refract's
data lives under `refract/` and nothing else. Config:

```js
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAaTuELH_mToxH3hRJ4WPIVTECSH7Z8-FY',
  authDomain: 'gzowos-games.firebaseapp.com',
  databaseURL: 'https://gzowos-games-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'gzowos-games',
  storageBucket: 'gzowos-games.firebasestorage.app',
  messagingSenderId: '658227201482',
  appId: '1:658227201482:web:627b44e3c4c2988bc4bb33',
};
```

Room path is therefore `refract/rooms/<id>`, not `rooms/<id>`.

## 9. Debug API (required — the screenshot harness depends on it)

`js/main.js` MUST expose a stable automation hook. Critics and the capture tool drive
the game through it; changing its shape breaks every round's evidence.

```js
window.REFRACT = {
  ready: Promise<void>,              // resolves once GL, assets and first trace are done
  setLevel(index): void,
  clearOptics(): void,
  place({type, x, y, angle}): string, // → optic id, board units, angle in radians
  select(id | null): void,
  setDrag(bool): void,               // fake a drag for capturing the protractor/ghost states
  setCursor(x, y): void,             // board units; moves the rendered local cursor
  setHudCursor(px, py): void,        // CSS px; for cursor-art screenshots
  solvedNow(): boolean,
  showModal(name | null): void,      // 'solved' | 'levels' | 'name' | 'multiplayer'
  state,                             // live reference to js/state.js state
  frames(n): Promise<void>,          // await n rendered frames (for settling animations)
  settle(): Promise<void>,           // await all springs at rest, then 2 more frames
  script(name): Promise<void>,       // named capture setups, see below
  fps,                               // rolling average frame rate, for the harness
};
```

Levels, positions and angles passed through this API bypass inventory limits so that a
capture can compose any board state. It must be inert for normal players — it only reads
and writes state that the player could also reach.

`script(name)` composes a board state by asking `solver.js` for a real solution to a real
level, never by hardcoding coordinates, so redesigning a level cannot break the capture
harness. Required names:

```
'folding'      a level needing 3+ mirrors; solution placed, last mirror selected mid-drag
'dispersion'   a level with a prism; solution placed except the final optic, fan in the open
'protractor'   one mirror alone in open board, selected, in rotate-drag
'solved'       a complete solution, every receptor satisfied
'multiplayer'  three fake remote players with names and cursor positions on the board
```

## 10. Screenshot harness

`node tools/shoot.mjs <name> [--scene=<scene>]` serves the repo, loads the game at
**720 × 694** (the exact reference frame size, so blind comparisons are apples to
apples), drives `window.REFRACT`, and writes `progress/shots/<name>.png`.
Scenes are defined in `tools/scenes.mjs` and mirror specific reference frames.


## 11. Resolutions of the conflicts REFERENCE.md 10.3 raised

Binding. Where this section and an earlier section disagree, this section wins.

1. **Wall thickness is 40 u**, interior `[40, 960]`, ledges included. Already applied to 3.
2. **No clockwise-from-up angle conversion.** Plain CCW-from-+x degrees, one decimal.
   Applied to 3.
3. **Emitters are free-standing housings placed in the interior**, roughly 40 u clear of
   the nearest wall face, not fixtures embedded in a wall. Applied to 4.
4. **The protractor ring has NO tick marks.** A plain hairline circle at about 30 % opacity
   plus the handle dot, and the readout centred 8 u above the ring — not beside the handle.
   This overrides the "tick marks at 15 degree multiples" in the board renderer brief.
   REFERENCE.md 10.1 item 13: the restraint is what makes it read as an instrument.
5. **Rotation snapping stays** at 5 degrees with a 15 degree magnet, Shift to disable. The
   readout must show the SNAPPED value, so it will read `20.0°`, never `19.7°`.
6. **The beam core must never clip to white.** Peak luminance stays in the 0.78–0.89 range
   after tonemapping. Clipping flattens the beam into a polygon and destroys the fringe,
   which is the whole look. Drive bloom from HDR values above 1.0 before the tonemap, not
   by blowing out the composited core.
7. **White light does not attenuate with distance; mirrors attenuate 10 % per bounce.**
   Both, not one or the other.
8. **Mortar is LIGHTER than the brick faces.** The common procedural-brick instinct is
   backwards here.
9. **The prism emits three things**: the primary fan, a weaker secondary fan with reversed
   hue order, and a narrow neutral residual. Rendering only the primary makes the prism read
   as a rainbow dispenser rather than as a piece of glass.
10. **Hue separation begins about 120 u from the prism**, not at its exit face. Near the
    prism the fan is close to neutral. Green is the least saturated point in the fan, not
    the most.
11. **Receptors extinguish after the solve burst** rather than staying lit under the panel,
    and the burst is three staggered expanding rings per receptor.

### Deliberate departures — we are beating the reference here, not missing it

- **Global film grain, vignette and chromatic aberration.** The reference has none: its
  black background measures a standard deviation of exactly 0.0, which reads as a clean
  vector render rather than a photographed scene. We keep all three, very subtle, because
  they tie the brick, the black and the beams into one image. Keep them low enough that
  the black still reads as black.
- **Real light spilling onto walls.** The reference has literally zero: what looks like
  glow is only bloom compositing. Per-fragment accumulation from nearby beam segments,
  tinted by wavelength, is the single biggest available upgrade and it is cheap. A spectrum
  sweeping across brick and painting it in sequence is the shot the reference never gets.
- **A dimmed, slightly blurred backdrop behind the solve panel**, so the panel has
  somewhere to sit instead of lying flat on a bright board.
- **A next-level affordance and a beat-par state** on the solve panel.
- **The hint line clear of the brick**, on its own row, at readable contrast.
- **Receptor spacing snapped to the grid.** The reference's is irregular for no reason.
- **A very light volumetric haze** so beams read as occupying air.


## 12. Levels must carry their own solution

Blind search is not a sufficient validator. `solver.js` discretises position and angle, so
a level can be perfectly solvable by a human and still time out the search — that is a
solver limitation being reported as a level defect, and it wasted a full round.

Therefore **every level carries a `solution` array**: the author's actual working placement,
in the same shape as `fixed`. `tools/validate-levels.mjs` must then check, in this order:

1. **The embedded solution really solves the level.** Load it, trace it, assert every
   receptor is satisfied. This is the authoritative test and it is exact, fast and
   deterministic. A level whose embedded solution does not solve is a broken level.
2. **The solution fits the inventory**, and `par === solution.length`.
3. **Search for something shorter.** If the solver finds a solution using fewer optics
   than `par`, that is a design defect — lower `par` to what the solver found, or change
   the geometry so the shortcut closes. Report it, do not silently accept it.
4. **Search timing out is NOT a failure.** Report it as `par unconfirmed` and move on. The
   embedded solution already proved solvability.
5. Geometry sanity: nothing embedded in a wall, every receptor reachable, the emitter's
   first ray actually enters the play area.

The exit code is non-zero only for checks 1, 2, 3 and 5.
