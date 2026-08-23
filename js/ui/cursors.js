// Kenney cursor art for the local pointer plus interpolated, named cursors for remote players.

import { state, on } from '../state.js';
import { boardMetrics } from './hud.js';

const SRC = '../../assets/cursors/';

// name → { file, hotspot in 32 px art space, box = drawn size in CSS px }
//
// REFERENCE.md 8 measures four sprites in a 720 px frame: arrow 18 x 30, open hand 24 x 30,
// closed hand 22 x 22, pointing hand 20 x 30, all 2.5–3.3 % of frame width. The Kenney art
// does not fill its 32 px canvas by the same fraction for every shape — the arrow occupies
// 16 x 20 of it, the hands 25–28 — so the drawn box is per sprite rather than one global
// size. `pointer_a` is the shape the reference actually uses: a classic arrow with a tail
// and a notch. `pointer_b`, which this used to load, is a plain triangle with neither.
const SPRITES = {
  idle:     { file: 'pointer_a.png', hx: 9.5, hy: 6, box: 43 },
  point:    { file: 'hand_point.png', hx: 10, hy: 2, box: 27 },
  open:     { file: 'hand_open.png', hx: 16, hy: 16, box: 30 },
  closed:   { file: 'hand_closed.png', hx: 16, hy: 16, box: 28 },
  cross:    { file: 'cross_large.png', hx: 16, hy: 16, box: 30 },
  disabled: { file: 'cursor_disabled.png', hx: 16, hy: 16, box: 30 },
  busy:     { file: 'cursor_busy.png', hx: 16, hy: 16, box: 30 },
};

const LOCAL_FILL = '#2131c7';
const OUTLINE = '#ffffff';
const DISABLED_FILL = '#c7314a';

const REMOTE_PALETTE = [
  '#4696e7', '#4cd6b4', '#e05a8c', '#edb950',
  '#8f7bff', '#6fbf7a', '#ff8a4c', '#5ad2ff',
];

const BASE = 32;
const REMOTE_BOX = 32;
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

// Kenney outline sprites are a white body inside a black outline. Remap luminance so the
// body takes the player colour and the outline becomes the bright rim seen in the reference.
function tint(img, size, fillHex, outlineHex) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, size, size);

  const fill = hexToRGB(fillHex);
  const line = hexToRGB(outlineHex);
  const data = ctx.getImageData(0, 0, size, size);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const l = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
    px[i] = line[0] + (fill[0] - line[0]) * l;
    px[i + 1] = line[1] + (fill[1] - line[1]) * l;
    px[i + 2] = line[2] + (fill[2] - line[2]) * l;
  }
  ctx.putImageData(data, 0, 0);
  return c.toDataURL('image/png');
}

function boxOf(name) {
  const spec = SPRITES[name];
  return (spec && spec.box) || BASE;
}

async function buildSprite(name, fillHex, boxPx) {
  const spec = SPRITES[name];
  const img = await loadImage(spec.file);
  const box = boxPx || spec.box || BASE;
  const k = box / BASE;
  return {
    x1: tint(img, Math.round(box), fillHex, OUTLINE),
    x2: tint(img, Math.round(box * 2), fillHex, OUTLINE),
    box,
    hx: spec.hx * k,
    hy: spec.hy * k,
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
    // Rotating is done with the handle, which REFERENCE.md 8 shows under the pointing hand;
    // moving and placing carry the closed fist.
    return drag && drag.kind === 'rotate' ? 'point' : 'closed';
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
  localEl.style.width = sprite.box + 'px';
  localEl.style.height = sprite.box + 'px';
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

// In capture mode there is no pointer to follow, so the stand-in appears only when the frame
// has something to point at — a selection or a drag — and stays out of clean beam shots.
function updateParkedCursor() {
  if (!captureMode || !localEl || (domMode && !autoPark)) return;
  const optic = selectedOptic();
  if (!optic) {
    if (autoPark) {
      autoPark = false;
      domMode = false;
      document.documentElement.dataset.cursorMode = 'native';
      localEl.classList.add('is-hidden');
    }
    return;
  }
  const m = boardMetrics();
  autoPark = true;
  domMode = true;
  document.documentElement.dataset.cursorMode = 'dom';
  localEl.classList.remove('is-hidden');
  localPx.x = m.x + (optic.x + CAPTURE_PARK.x) * m.scale;
  localPx.y = m.y + (optic.y + CAPTURE_PARK.y) * m.scale;
  syncLocalSprite(applied || 'idle');
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
  img.style.width = REMOTE_BOX + 'px';
  img.style.height = REMOTE_BOX + 'px';
  img.style.filter = SHADOW;
  el.appendChild(img);
  const label = document.createElement('span');
  label.className = 'remote-name';
  label.textContent = String(name || 'GUEST').toUpperCase();
  el.appendChild(label);
  remoteLayer.appendChild(el);

  const rec = { el, img, label, colour, name, x: 0, y: 0, tx: 0, ty: 0, seeded: false, hx: 10, hy: 6 };
  buildSprite('idle', colour, REMOTE_BOX).then((sprite) => {
    rec.img.src = sprite.x2;
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
      buildSprite('idle', colour, REMOTE_BOX).then((s) => { rec.img.src = s.x2; }).catch(() => { void 0; });
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
  localEl.style.width = boxOf('idle') + 'px';
  localEl.style.height = boxOf('idle') + 'px';
  localEl.style.filter = SHADOW;
  localEl.dataset.hx = String(SPRITES.idle.hx * (boxOf('idle') / BASE));
  localEl.dataset.hy = String(SPRITES.idle.hy * (boxOf('idle') / BASE));
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
