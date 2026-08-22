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
- Outer wall ring is **30 units** thick, occupying the border of the 1000×1000 box.
  Playable interior is therefore `[30, 970] × [30, 970]`.
- The canvas is a square that fits the viewport with margin; `render/gl.js` owns the
  board→pixel transform and exposes it. UI code must never hardcode pixel positions
  of board features — ask the transform.
- Angles are in **radians**, measured counter-clockwise from +x, and stored normalized
  to `[0, 2π)`. The HUD displays degrees clockwise-from-up to match the reference
  protractor readout; conversion lives in `ui/hud.js` only.

## 4. Shared data shapes

```js
// A level (js/levels.js) — pure data, no functions.
{
  id: 13,
  name: 'THE LONG SPECTRUM',
  par: 5,
  emitter: { x: 30, y: 175, dir: 0 },            // dir in radians, beam leaves this way
  walls: [ { x, y, w, h } ],                     // axis-aligned, board units, interior only
  receptors: [ { x, y, color: 'blue' } ],        // color ∈ 'red'|'orange'|'yellow'|'green'|'cyan'|'blue'|'violet'
  inventory: { mirror: 4, prism: 1 },
  fixed: [ { type:'mirror'|'prism', x, y, angle } ], // pre-placed, not removable
  hint: 'One prism, late.',
}

// A placed optic (runtime, in state).
{ id: 'o7', type: 'mirror'|'prism', x, y, angle, fixed: false, owner: 'p3'|null }

// A traced ray segment, produced by optics/trace.js
{ ax, ay, bx, by, nm, intensity, generation, terminal }
//   nm         wavelength in nanometres, or 0 for composite white
//   intensity  0..1 linear radiance multiplier
//   generation bounce depth (0 = straight out of emitter)
//   terminal   null | 'wall' | 'receptor:<id>' | 'depth' | 'escape'

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
};
```

Levels, positions and angles passed through this API bypass inventory limits so that a
capture can compose any board state. It must be inert for normal players — it only reads
and writes state that the player could also reach.

## 10. Screenshot harness

`node tools/shoot.mjs <name> [--scene=<scene>]` serves the repo, loads the game at
**720 × 694** (the exact reference frame size, so blind comparisons are apples to
apples), drives `window.REFRACT`, and writes `progress/shots/<name>.png`.
Scenes are defined in `tools/scenes.mjs` and mirror specific reference frames.
