// Kenney cursor art for the local pointer plus interpolated, named cursors for remote players.

import { state, on } from '../state.js';
import { boardMetrics } from './hud.js';

const SRC = '../../assets/cursors/';

// name → { file, hotspot in 32 px art space, boxW/boxH = drawn size in CSS px }
//
// REFERENCE.md 8 measures four sprites in a 720 px frame: arrow 18 x 30, open hand 24 x 30,
// closed hand 22 x 22, pointing hand 20 x 30. Re-measured off the frames themselves, the
// arrow is 17 x 29 on ref_001 and ref_010 and 17 x 37 on ref_030 — aspect 0.59, i.e. a tall
// arrow with a long tail.
//
// Kenney's art cannot reach that aspect under a UNIFORM box, and this is the whole defect:
// `pointer_a` has an alpha bbox of 32 x 40 in its 64 px canvas (aspect 0.80), `pointer_b` is
// the same 0.80 and `pointer_c` is 0.786, so no single `box` value exists that renders 17 x 29.
// Drawn at the old box 40 it came out 20 x 24.5 — 16 % too short and 18 % too wide, which is
// why it read as a stubby lozenge rather than a cursor. The same is true of `hand_point`,
// whose bbox is 57 x 56: at box 27 it drew 24 x 23.6, a square blob where the reference has a
// 20 x 30 hand.
//
// So the box is now two numbers and the sprite is drawn NON-UNIFORMLY. boxW/boxH are chosen
// from each file's own alpha bbox so that the visible art lands on the measured target:
//
//   idle    pointer_a   bbox 32 x 40 of 64  →  34 x 46   draws 17.0 x 28.8   (target 17 x 29)
//   point   hand_point  bbox 57 x 56 of 64  →  22.5 x 34 draws 20.0 x 29.8   (target 20 x 30)
//   open    hand_open   bbox 53 x 57 of 64  →  29 x 33.7 draws 24.0 x 30.0   (target 24 x 30)
//   closed  hand_closed bbox 51 x 47 of 64  →  27.6 x 30 draws 22.0 x 22.0   (target 22 x 22)
//
// `cross`, `disabled` and `busy` have no counterpart in the footage and stay square.
//
// `pointer_a` is the shape the reference actually uses: a classic arrow with a tail and a
// notch. `pointer_b`, which this used to load, is a plain triangle with neither.
const SPRITES = {
  idle:     { file: 'pointer_a.png', hx: 9.5, hy: 6, boxW: 34, boxH: 46 },
  point:    { file: 'hand_point.png', hx: 10, hy: 2, boxW: 22.5, boxH: 34 },
  open:     { file: 'hand_open.png', hx: 16, hy: 16, boxW: 29, boxH: 33.7 },
  closed:   { file: 'hand_closed.png', hx: 16, hy: 16, boxW: 27.6, boxH: 30 },
  cross:    { file: 'cross_large.png', hx: 16, hy: 16, boxW: 30, boxH: 30 },
  disabled: { file: 'cursor_disabled.png', hx: 16, hy: 16, boxW: 30, boxH: 30 },
  busy:     { file: 'cursor_busy.png', hx: 16, hy: 16, boxW: 30, boxH: 30 },
};

const LOCAL_FILL = '#2131c7';
const OUTLINE = '#ffffff';
const DISABLED_FILL = '#c7314a';

const REMOTE_PALETTE = [
  '#4696e7', '#4cd6b4', '#e05a8c', '#edb950',
  '#8f7bff', '#6fbf7a', '#ff8a4c', '#5ad2ff',
];

const BASE = 32;
// Remote cursors are drawn at 80 % of the local arrow, which is what the old REMOTE_BOX 32
// against the old idle box 40 already amounted to.
const REMOTE_SCALE = 0.8;

// The reference cursor body is SHADED, not flat. Measured inside the silhouette on ref_001,
// ours ran R std 18.8 / B std 4.8 with p5→p95 of R 33→88 and B 199→213 — a single flat blue.
// The reference runs R std 57.9 / B std 39.3 with p5→p95 of R 20→186 and B 130→255: it goes
// from a dark blue on one edge to a near-white highlight on the other, which is what gives it
// volume and stops it reading as a sticker.
//
// Rather than hardcode a second and third blue, both stops are derived from whatever fill the
// sprite is being tinted with, so remote players in eight different colours get the same
// treatment for free.
// The highlight colour mixes toward white by SHADE_LIGHT on every channel EXCEPT the fill's own
// dominant one, which goes all the way. That is not a flourish, it is what the measurement
// says: the reference highlight reaches B 255 while its R only reaches 186, so blue saturates
// first and the highlight stays a blue-white rather than turning grey. Against #2131c7 these
// produce (186, 191, 255) at the highlight and (15, 22, 90) in shadow.
const SHADE_LIGHT = 0.69;
const SHADE_DARK = 0.45;
// Direction the light runs, as a unit vector in sprite space: lit at the upper left, where the
// arrow's tip and leading edge are, falling away to the lower right.
const SHADE_DIR = [0.8, 0.6];
// How far along that gradient the body has darkened to the shadow stop. The body gradient is
// deliberately gentle: enlarging ref_030's cursor shows the reference body is a fairly EVEN
// saturated blue and that almost all of its measured variance comes from a bright inner rim
// running just inside the white outline, not from a wash across the fill. A smooth wash is the
// obvious way to read "R p5 20, p95 186" and it is the wrong one.
const BODY_SHADE = 1.0;
// The inner highlight rim: distance in CSS px from the outline at which it peaks, its Gaussian
// half-width, and how far toward the highlight colour it pulls at full strength.
const INNER_D = 1.5;
const INNER_W = 1.45;
const INNER_K = 1.0;
const SHADOW = 'drop-shadow(0 1.5px 2.5px rgba(0, 0, 0, 0.78))';

// state.cursor.style is what input.js actually writes. `state.hoverKind`, which this module
// used to read, is declared nowhere in the codebase, so the open-hand and pointing-hand
// states were unreachable and only idle and closed ever appeared.
const HOVER_TO_SPRITE = {
  arrow: 'idle',
  idle: 'idle',
  point: 'point',
  handle: 'point',
  ui: 'point',
  open: 'open',
  optic: 'open',
  closed: 'closed',
  grab: 'closed',
  cross: 'cross',
  disabled: 'disabled',
  busy: 'busy',
};

// The reference footage always has a cursor in frame; screenshots cannot capture an OS
// cursor, so in capture mode the DOM stand-in is parked where the footage parks it —
// just below the protractor ring of the selected optic (ref_010: ring centre (147.7, 277),
// arrow tip (151, 312), i.e. +6 u right and +62 u down at that frame's scale).
const CAPTURE_PARK = { x: 6, y: 62 };

// With nothing selected there is no optic to park against, and the stand-in used to be hidden
// outright — which is why four of nine blind pairs could be told apart on cursor presence
// alone. All 150 reference frames have one. Two fallbacks, both taken from the footage:
//
//   IDLE_PARK  ref_001's idle arrow sits with its tip at (511, 408) in a 720 x 694 frame,
//              i.e. 71.0 % across and 58.8 % down, over open board.
//   MODAL_PARK with the solve panel up, ref_038 puts a pointing hand at (589, 411) — 81.8 %
//              across, 59.2 % down — out on the board clear of the panel, NOT on a button.
//              REFERENCE.md 8's "hovering the FREE PLAY button" does not survive its own
//              frame: in both ref_034 and ref_038 the hand is over open board.
const IDLE_PARK = { fx: 0.710, fy: 0.588 };
const MODAL_PARK = { fx: 0.818, fy: 0.592 };

const captureMode = (() => {
  try {
    return new URLSearchParams(window.location.search).has('capture');
  } catch (err) { void err; return false; }
})();

let started = false;
let layer = null;
let remoteLayer = null;
let localEl = null;
let localImg = null;
let override = null;
let applied = '';
let domMode = false;
let autoPark = false;
let localPx = { x: -100, y: -100 };
let tintedIdle = null;

const remotes = new Map();
let raf = 0;
let lastT = 0;

/* ---------- image tinting ---------- */

const imageCache = new Map();

function loadImage(file) {
  if (imageCache.has(file)) return imageCache.get(file);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = new URL(SRC + file, import.meta.url).href;
  });
  imageCache.set(file, p);
  return p;
}

function hexToRGB(hex) {
  const h = String(hex).replace('#', '').trim();
  const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h.slice(0, 6);
  const n = parseInt(full, 16);
  if (!isFinite(n)) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// The white rim the reference cursor carries is thin: measured on ref_001's idle arrow
// (x 511-529, y 408-437) it is 1 px against a 19 px sprite, and the blue body fills the rest.
// The Kenney outline is far heavier than that — drawn at box 40 it lands 2.5 px wide, which
// is what made our arrow read as a sticker pasted over the board rather than a cursor.
//
// The rim cannot be thinned by biasing the luminance ramp, because the source border is
// solidly black rather than a soft edge, and it cannot be thinned by shrinking the sprite
// without taking the whole cursor under the size REFERENCE.md 8 specifies. So the border is
// eroded geometrically instead: flood the dark border inward from the silhouette edge, keep
// RIM_PX of it, and hand the rest to the body. Dark pixels that are NOT reachable from the
// edge through dark pixels — the knuckle creases and finger lines inside the hands — are
// untouched, so the sprites keep their internal drawing.
const RIM_PX = 1.25;

function shadeStops(fillHex) {
  const f = hexToRGB(fillHex);
  let top = 0;
  if (f[1] > f[top]) top = 1;
  if (f[2] > f[top]) top = 2;
  const light = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const w = i === top ? 1 : SHADE_LIGHT;
    light[i] = f[i] + (255 - f[i]) * w;
  }
  return {
    light,
    base: f,
    dark: [f[0] * SHADE_DARK, f[1] * SHADE_DARK, f[2] * SHADE_DARK],
  };
}

function tint(img, cw, ch, fillHex, outlineHex, dpr) {
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Non-uniform on purpose: the source art's aspect is not the reference cursor's aspect, and
  // no uniform scale of it ever will be. See the note on SPRITES.
  ctx.drawImage(img, 0, 0, cw, ch);

  const stops = shadeStops(fillHex);
  const line = hexToRGB(outlineHex);
  const data = ctx.getImageData(0, 0, cw, ch);
  const px = data.data;
  const n = cw * ch;

  // Luminance, the dark-border mask, and the silhouette's bounding box, which the shading
  // gradient is normalised against so it spans the art rather than the padded canvas.
  const lum = new Float32Array(n);
  const dark = new Uint8Array(n);
  let x0 = cw;
  let y0 = ch;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const p = y * cw + x;
      const i = p * 4;
      if (px[i + 3] < 24) { lum[p] = -1; continue; }
      const l = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
      lum[p] = l;
      if (l < 0.5) dark[p] = 1;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0) { x0 = 0; y0 = 0; x1 = cw - 1; y1 = ch - 1; }

  // Chamfer distance from the outside, following dark pixels only. dist stays 0 for the body
  // and for interior dark detail, which is exactly the set that must not be eroded.
  const dist = new Float32Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const p = y * cw + x;
      if (!dark[p]) continue;
      let edge = x === 0 || y === 0 || x === cw - 1 || y === ch - 1;
      if (!edge) {
        for (let dy = -1; dy <= 1 && !edge; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (lum[(y + dy) * cw + (x + dx)] < 0) { edge = true; break; }
          }
        }
      }
      if (edge) { dist[p] = 1; queue[tail++] = p; }
    }
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % cw;
    const y = (p - x) / cw;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const q = ny * cw + nx;
        if (!dark[q] || dist[q] > 0) continue;
        dist[q] = dist[p] + (dx && dy ? 1.41 : 1);
        queue[tail++] = q;
      }
    }
  }

  // A second chamfer, this time INTO the body, seeded from every body pixel that touches the
  // outline or the transparent surround. It is what puts the inner highlight rim a fixed
  // distance inside the silhouette on every edge instead of at a fixed image coordinate.
  const bodyDist = new Float32Array(n);
  head = 0;
  tail = 0;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const p = y * cw + x;
      if (lum[p] < 0 || dark[p]) continue;
      let edge = x === 0 || y === 0 || x === cw - 1 || y === ch - 1;
      if (!edge) {
        for (let dy = -1; dy <= 1 && !edge; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const q = (y + dy) * cw + (x + dx);
            if (lum[q] < 0 || dark[q]) { edge = true; break; }
          }
        }
      }
      if (edge) { bodyDist[p] = 1; queue[tail++] = p; }
    }
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % cw;
    const y = (p - x) / cw;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const q = ny * cw + nx;
        if (lum[q] < 0 || dark[q] || bodyDist[q] > 0) continue;
        bodyDist[q] = bodyDist[p] + (dx && dy ? 1.41 : 1);
        queue[tail++] = q;
      }
    }
  }

  const d = dpr || 1;
  const rim = RIM_PX * d;
  const hlD = INNER_D * d;
  const hlW = INNER_W * d;
  const span = Math.max((x1 - x0) * SHADE_DIR[0] + (y1 - y0) * SHADE_DIR[1], 1);
  for (let p = 0; p < n; p++) {
    if (lum[p] < 0) continue;
    let k = lum[p];
    if (dist[p] > 0) {
      // Inside the eroded band the pixel keeps the rim; past it, it joins the body.
      const t = (dist[p] - rim) / (1.2 * d);
      k = Math.min(Math.max(t, 0), 1);
    }
    const x = p % cw;
    const y = (p - x) / cw;
    const g = Math.min(Math.max(((x - x0) * SHADE_DIR[0] + (y - y0) * SHADE_DIR[1]) / span, 0), 1);
    const shade = g * BODY_SHADE;
    const fill = [
      stops.base[0] + (stops.dark[0] - stops.base[0]) * shade,
      stops.base[1] + (stops.dark[1] - stops.base[1]) * shade,
      stops.base[2] + (stops.dark[2] - stops.base[2]) * shade,
    ];
    if (bodyDist[p] > 0) {
      // Only the lit edges carry the rim; the trailing ones stay in shadow, which is what
      // stops the highlight from reading as a second outline all the way round.
      const side = Math.min(Math.max(1 - g / 0.8, 0), 1);
      const band = Math.exp(-Math.pow((bodyDist[p] - hlD) / hlW, 2));
      const w = band * side * INNER_K;
      for (let ch3 = 0; ch3 < 3; ch3++) fill[ch3] += (stops.light[ch3] - fill[ch3]) * w;
    }
    const i = p * 4;
    px[i] = line[0] + (fill[0] - line[0]) * k;
    px[i + 1] = line[1] + (fill[1] - line[1]) * k;
    px[i + 2] = line[2] + (fill[2] - line[2]) * k;
  }
  ctx.putImageData(data, 0, 0);
  return c.toDataURL('image/png');
}

function boxOf(name) {
  const spec = SPRITES[name];
  return {
    w: (spec && spec.boxW) || BASE,
    h: (spec && spec.boxH) || BASE,
  };
}

// `scale` shrinks or grows a sprite while keeping the proportions the SPRITES table fixed.
async function buildSprite(name, fillHex, scale) {
  const spec = SPRITES[name];
  const img = await loadImage(spec.file);
  const k = scale || 1;
  const w = ((spec && spec.boxW) || BASE) * k;
  const h = ((spec && spec.boxH) || BASE) * k;
  return {
    x1: tint(img, Math.round(w), Math.round(h), fillHex, OUTLINE, 1),
    x2: tint(img, Math.round(w * 2), Math.round(h * 2), fillHex, OUTLINE, 2),
    w,
    h,
    // Hotspots are authored in the 32 px art space, so each axis scales by its own factor.
    hx: spec.hx * (w / BASE),
    hy: spec.hy * (h / BASE),
  };
}

const supportsImageSet = (() => {
  try {
    return CSS.supports('cursor', 'image-set(url("data:image/png;base64,") 1x) 0 0, auto');
  } catch (err) { void err; return false; }
})();

function cursorValue(sprite) {
  const art = supportsImageSet
    ? 'image-set(url("' + sprite.x1 + '") 1x, url("' + sprite.x2 + '") 2x)'
    : 'url("' + sprite.x1 + '")';
  return art + ' ' + Math.round(sprite.hx) + ' ' + Math.round(sprite.hy);
}

async function installCursors() {
  const names = Object.keys(SPRITES);
  const built = await Promise.all(names.map((n) => buildSprite(n, n === 'disabled' ? DISABLED_FILL : LOCAL_FILL)));
  const s = document.documentElement.style;
  names.forEach((n, i) => {
    s.setProperty('--cur-' + n, cursorValue(built[i]));
    if (n === 'idle') tintedIdle = built[i];
  });
  if (localImg && tintedIdle && !localImg.dataset.sprite) {
    localImg.src = tintedIdle.x2;
    sizeLocal(tintedIdle);
  }
  applyCursor();
}

/* ---------- local cursor state ---------- */

function hoverSprite() {
  if (!state) return 'idle';
  const raw = state.hoverKind || (state.cursor && state.cursor.style);
  const mapped = raw ? HOVER_TO_SPRITE[raw] : null;
  if (mapped && SPRITES[mapped]) return mapped;
  return 'idle';
}

function derivedState() {
  if (!state) return 'idle';
  if (state.dragging) {
    const drag = typeof state.dragging === 'object' ? state.dragging : null;
    if (drag && drag.valid === false) return 'disabled';
    // REFERENCE.md 8 claims the pointing hand rides the protractor handle, but its own frames
    // say otherwise: ref_010 and ref_030 are both mid rotation-drag and both show the plain
    // arrow at the handle. The pointing hand appears only on the FREE PLAY button (ref_034,
    // ref_038). Moving and placing keep the closed fist.
    return drag && drag.kind === 'rotate' ? 'idle' : 'closed';
  }
  return hoverSprite();
}

function applyCursor() {
  const name = (override && SPRITES[override]) ? override : derivedState();
  if (name !== applied) {
    applied = name;
    document.documentElement.dataset.cursor = name;
  }
  if (domMode && localEl) syncLocalSprite(name);
}

function sizeLocal(sprite) {
  if (!localEl) return;
  localEl.style.width = sprite.w + 'px';
  localEl.style.height = sprite.h + 'px';
  localEl.dataset.hx = String(sprite.hx);
  localEl.dataset.hy = String(sprite.hy);
}

async function syncLocalSprite(name) {
  const spec = SPRITES[name];
  if (!spec || !localImg) return;
  if (localImg.dataset.sprite === name) return;
  localImg.dataset.sprite = name;
  try {
    const built = await buildSprite(name, name === 'disabled' ? DISABLED_FILL : LOCAL_FILL);
    if (localImg.dataset.sprite !== name) return;
    localImg.src = built.x2;
    sizeLocal(built);
    placeLocal();
  } catch (err) { void err; }
}

function placeLocal() {
  if (!localEl) return;
  const hx = parseFloat(localEl.dataset.hx || '12');
  const hy = parseFloat(localEl.dataset.hy || '8');
  localEl.style.transform = 'translate3d(' + (localPx.x - hx) + 'px,' + (localPx.y - hy) + 'px,0)';
}

export function setCursorState(name) {
  override = (name && SPRITES[name]) ? name : null;
  applyCursor();
}

export function cursorState() {
  return applied;
}

// Renders a DOM stand-in for the OS cursor. Screenshots cannot capture a CSS cursor, so the
// capture harness and any scripted demo drive this instead. Pass null to hand control back.
export function setLocalCursor(px, py) {
  if (!started) initCursors();
  if (!localEl) return;
  if (px == null) {
    domMode = false;
    autoPark = false;
    document.documentElement.dataset.cursorMode = 'native';
    localEl.classList.add('is-hidden');
    return;
  }
  domMode = true;
  document.documentElement.dataset.cursorMode = 'dom';
  localEl.classList.remove('is-hidden');
  localPx.x = px;
  localPx.y = py;
  syncLocalSprite(applied || 'idle');
  placeLocal();
}

// main.js resolves this module's hooks by trying a list of names; these are the ones it
// looks for. Without them `REFRACT.setHudCursor` and the remote-cursor push were both bound
// to null, which is why no capture in the project has ever contained a cursor.
export const setPosition = setLocalCursor;
export const setCursorPosition = setLocalCursor;
export const moveCursor = setLocalCursor;

/* ---------- capture parking ---------- */

function selectedOptic() {
  if (!state || state.selectedId === null || state.selectedId === undefined) return null;
  const list = Array.isArray(state.optics) ? state.optics : [];
  return list.find((o) => o && o.id === state.selectedId) || null;
}

// Whether a panel is up. Nothing on the panel is pointed at; the only thing that matters is
// that a modal is open, in which case the footage parks the cursor out on the board beside it.
function modalOpen() {
  return document.documentElement.getAttribute('data-modal') === 'open';
}

// In capture mode there is no pointer to follow, so the stand-in is parked where the footage
// parks it: out beside the panel when one is up, beside the selected optic's ring when
// something is selected, and otherwise over open board.
function parkTarget() {
  const w = window.innerWidth || 0;
  const h = window.innerHeight || 0;
  if (modalOpen()) {
    if (!w || !h) return null;
    return { x: w * MODAL_PARK.fx, y: h * MODAL_PARK.fy, sprite: 'point' };
  }
  const optic = selectedOptic();
  if (optic) {
    const m = boardMetrics();
    return {
      x: m.x + (optic.x + CAPTURE_PARK.x) * m.scale,
      y: m.y + (optic.y + CAPTURE_PARK.y) * m.scale,
      sprite: applied || 'idle',
    };
  }
  if (!w || !h) return null;
  return { x: w * IDLE_PARK.fx, y: h * IDLE_PARK.fy, sprite: 'idle' };
}

function updateParkedCursor() {
  if (!captureMode || !localEl || (domMode && !autoPark)) return;
  const target = parkTarget();
  if (!target) {
    if (autoPark) {
      autoPark = false;
      domMode = false;
      document.documentElement.dataset.cursorMode = 'native';
      localEl.classList.add('is-hidden');
    }
    return;
  }
  autoPark = true;
  domMode = true;
  document.documentElement.dataset.cursorMode = 'dom';
  localEl.classList.remove('is-hidden');
  localPx.x = target.x;
  localPx.y = target.y;
  syncLocalSprite(target.sprite);
  placeLocal();
}

/* ---------- remote cursors ---------- */

function colourFor(id, given) {
  if (given) return given;
  let h = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return REMOTE_PALETTE[h % REMOTE_PALETTE.length];
}

function readRemotePos(p) {
  const c = p && p.cursor ? p.cursor : p;
  if (!c) return null;
  const x = Number(c.x);
  const y = Number(c.y);
  if (!isFinite(x) || !isFinite(y)) return null;
  return { x, y };
}

function makeRemote(id, colour, name) {
  const el = document.createElement('div');
  el.className = 'remote-cursor is-entering';
  el.style.color = colour;
  const img = document.createElement('img');
  img.alt = '';
  img.style.width = SPRITES.idle.boxW * REMOTE_SCALE + 'px';
  img.style.height = SPRITES.idle.boxH * REMOTE_SCALE + 'px';
  img.style.filter = SHADOW;
  el.appendChild(img);
  const label = document.createElement('span');
  label.className = 'remote-name';
  label.textContent = String(name || 'GUEST').toUpperCase();
  el.appendChild(label);
  remoteLayer.appendChild(el);

  const rec = { el, img, label, colour, name, x: 0, y: 0, tx: 0, ty: 0, seeded: false, hx: 10, hy: 6 };
  buildSprite('idle', colour, REMOTE_SCALE).then((sprite) => {
    rec.img.src = sprite.x2;
    rec.img.style.width = sprite.w + 'px';
    rec.img.style.height = sprite.h + 'px';
    rec.hx = sprite.hx;
    rec.hy = sprite.hy;
  }).catch(() => { void 0; });
  remotes.set(id, rec);
  return rec;
}

export function updateRemoteCursors(players) {
  if (!started) return;
  const list = players || (state && state.players) || {};
  const seen = new Set();

  for (const id of Object.keys(list)) {
    if (id === state.me || (state.me && id === state.me.id)) continue;
    const p = list[id] || {};
    const pos = readRemotePos(p);
    if (!pos) continue;
    seen.add(id);

    let rec = remotes.get(id);
    const colour = colourFor(id, p.color);
    if (!rec) rec = makeRemote(id, colour, p.name);

    if (rec.colour !== colour) {
      rec.colour = colour;
      rec.el.style.color = colour;
      buildSprite('idle', colour, REMOTE_SCALE).then((s) => { rec.img.src = s.x2; }).catch(() => { void 0; });
    }
    const label = String(p.name || 'GUEST').toUpperCase();
    if (rec.name !== label) { rec.name = label; rec.label.textContent = label; }

    rec.tx = pos.x;
    rec.ty = pos.y;
    if (!rec.seeded) { rec.x = pos.x; rec.y = pos.y; rec.seeded = true; }
  }

  for (const [id, rec] of remotes) {
    if (seen.has(id)) continue;
    rec.el.remove();
    remotes.delete(id);
  }

  if (remotes.size) {
    placeRemotes();
    if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(tick); }
  }
}

export const setPlayers = updateRemoteCursors;
export const setRemote = updateRemoteCursors;
export const updatePlayers = updateRemoteCursors;

function placeRemotes() {
  const m = boardMetrics();
  for (const rec of remotes.values()) {
    const px = m.x + rec.x * m.scale;
    const py = m.y + rec.y * m.scale;
    rec.el.style.transform = 'translate3d(' + (px - rec.hx) + 'px,' + (py - rec.hy) + 'px,0)';
  }
}

function tick(now) {
  raf = 0;
  const dt = Math.min(0.1, Math.max(0.001, (now - lastT) / 1000));
  lastT = now;

  for (const rec of remotes.values()) {
    const k = 1 - Math.exp(-dt * 16);
    rec.x += (rec.tx - rec.x) * k;
    rec.y += (rec.ty - rec.y) * k;
  }
  placeRemotes();

  if (remotes.size) raf = requestAnimationFrame(tick);
}

/* ---------- wiring ---------- */

function onPointerMove(ev) {
  localPx.x = ev.clientX;
  localPx.y = ev.clientY;
  if (domMode && !autoPark) placeLocal();
}

function onStateChange() {
  applyCursor();
  updateParkedCursor();
  updateRemoteCursors(state.players);
}

export function initCursors() {
  if (started) return api;
  layer = document.getElementById('cursor-layer');
  remoteLayer = document.getElementById('remote-layer') || layer;
  if (!layer) throw new Error('cursors: #cursor-layer missing from index.html');

  localEl = document.createElement('div');
  localEl.className = 'dom-cursor is-hidden';
  localEl.style.width = boxOf('idle').w + 'px';
  localEl.style.height = boxOf('idle').h + 'px';
  localEl.style.filter = SHADOW;
  localEl.dataset.hx = String(SPRITES.idle.hx * (boxOf('idle').w / BASE));
  localEl.dataset.hy = String(SPRITES.idle.hy * (boxOf('idle').h / BASE));
  localImg = document.createElement('img');
  localImg.alt = '';
  localImg.style.width = '100%';
  localImg.style.height = '100%';
  localEl.appendChild(localImg);
  layer.appendChild(localEl);

  document.documentElement.dataset.cursorMode = 'native';
  window.addEventListener('pointermove', onPointerMove, { passive: true, capture: true });
  window.addEventListener('blur', () => { if (!domMode) setCursorState(null); });

  started = true;
  installCursors().catch(() => { void 0; });
  on('change', onStateChange);
  on('cursor', applyCursor);

  // Opening a modal is not a game-state change, so nothing would re-park the stand-in onto
  // its button. Watched only in capture mode, where the stand-in exists at all.
  if (captureMode && typeof MutationObserver === 'function') {
    const root = document.getElementById('modal-root');
    const obs = new MutationObserver(() => updateParkedCursor());
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-modal'] });
    if (root) obs.observe(root, { childList: true, subtree: true });
    window.addEventListener('resize', updateParkedCursor, { passive: true });
  }

  applyCursor();
  updateParkedCursor();
  return api;
}

const api = {
  init: initCursors,
  set: setCursorState,
  get: cursorState,
  setLocalCursor,
  setPosition,
  setPlayers,
  updateRemoteCursors,
};

export default api;
