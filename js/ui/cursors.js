// Kenney cursor art for the local pointer plus interpolated, named cursors for remote players.

import { state, on } from '../state.js';
import { boardMetrics } from './hud.js';

const SRC = '../../assets/cursors/';

// name → { file, hotspot in 32 px space }
const SPRITES = {
  idle:     { file: 'pointer_b.png', hx: 9, hy: 7 },
  point:    { file: 'hand_point.png', hx: 10, hy: 2 },
  open:     { file: 'hand_open.png', hx: 16, hy: 16 },
  closed:   { file: 'hand_closed.png', hx: 16, hy: 16 },
  cross:    { file: 'cross_large.png', hx: 16, hy: 16 },
  disabled: { file: 'cursor_disabled.png', hx: 16, hy: 16 },
  busy:     { file: 'cursor_busy.png', hx: 16, hy: 16 },
};

const LOCAL_FILL = '#2131c7';
const OUTLINE = '#ffffff';
const DISABLED_FILL = '#c7314a';

const REMOTE_PALETTE = [
  '#4696e7', '#4cd6b4', '#e05a8c', '#edb950',
  '#8f7bff', '#6fbf7a', '#ff8a4c', '#5ad2ff',
];

const BASE = 32;
const REMOTE_SIZE = 30;

let started = false;
let layer = null;
let remoteLayer = null;
let localEl = null;
let localImg = null;
let override = null;
let applied = '';
let domMode = false;
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

async function buildSprite(name, fillHex) {
  const spec = SPRITES[name];
  const img = await loadImage(spec.file);
  return {
    x1: tint(img, BASE, fillHex, OUTLINE),
    x2: tint(img, BASE * 2, fillHex, OUTLINE),
    hx: spec.hx,
    hy: spec.hy,
  };
}

const supportsImageSet = (() => {
  try {
    return CSS.supports('cursor', 'image-set(url("data:image/png;base64,") 1x) 0 0, auto');
  } catch (err) { return false; }
})();

function cursorValue(sprite) {
  const art = supportsImageSet
    ? 'image-set(url("' + sprite.x1 + '") 1x, url("' + sprite.x2 + '") 2x)'
    : 'url("' + sprite.x1 + '")';
  return art + ' ' + sprite.hx + ' ' + sprite.hy;
}

async function installCursors() {
  const names = Object.keys(SPRITES);
  const built = await Promise.all(names.map((n) => buildSprite(n, n === 'disabled' ? DISABLED_FILL : LOCAL_FILL)));
  const s = document.documentElement.style;
  names.forEach((n, i) => {
    s.setProperty('--cur-' + n, cursorValue(built[i]));
    if (n === 'idle') tintedIdle = built[i];
  });
  if (localImg && tintedIdle) localImg.src = tintedIdle.x2;
  applyCursor();
}

/* ---------- local cursor state ---------- */

function derivedState() {
  if (!state) return 'idle';
  if (state.dragging) {
    const invalid = typeof state.dragging === 'object' && state.dragging.valid === false;
    return invalid ? 'disabled' : 'closed';
  }
  const hover = state.hoverKind;
  if (hover && SPRITES[hover]) return hover;
  if (hover === 'optic') return 'open';
  if (hover === 'handle' || hover === 'ui') return 'point';
  return 'idle';
}

function applyCursor() {
  const name = (override && SPRITES[override]) ? override : derivedState();
  if (name !== applied) {
    applied = name;
    document.documentElement.dataset.cursor = name;
  }
  if (domMode && localEl) syncLocalSprite(name);
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
    localEl.dataset.hx = built.hx;
    localEl.dataset.hy = built.hy;
    placeLocal();
  } catch (err) { void err; }
}

function placeLocal() {
  if (!localEl) return;
  const hx = parseFloat(localEl.dataset.hx || '9');
  const hy = parseFloat(localEl.dataset.hy || '7');
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
  if (px == null) {
    domMode = false;
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
  el.appendChild(img);
  const label = document.createElement('span');
  label.className = 'remote-name';
  label.textContent = String(name || 'GUEST').toUpperCase();
  el.appendChild(label);
  remoteLayer.appendChild(el);

  const rec = { el, img, label, colour, name, x: 0, y: 0, tx: 0, ty: 0, seeded: false, hx: 9, hy: 7 };
  buildSprite('idle', colour).then((sprite) => {
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
    if (id === state.me) continue;
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
      buildSprite('idle', colour).then((s) => { rec.img.src = s.x2; }).catch(() => { void 0; });
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

  if (remotes.size && !raf) { lastT = performance.now(); raf = requestAnimationFrame(tick); }
}

function tick(now) {
  raf = 0;
  const dt = Math.min(0.1, Math.max(0.001, (now - lastT) / 1000));
  lastT = now;
  const m = boardMetrics();

  for (const rec of remotes.values()) {
    const k = 1 - Math.exp(-dt * 16);
    rec.x += (rec.tx - rec.x) * k;
    rec.y += (rec.ty - rec.y) * k;
    const px = m.x + rec.x * m.scale;
    const py = m.y + rec.y * m.scale;
    const s = REMOTE_SIZE / BASE;
    rec.el.style.transform = 'translate3d(' + (px - rec.hx * s) + 'px,' + (py - rec.hy * s) + 'px,0)';
  }

  if (remotes.size) raf = requestAnimationFrame(tick);
}

/* ---------- wiring ---------- */

function onPointerMove(ev) {
  localPx.x = ev.clientX;
  localPx.y = ev.clientY;
  if (domMode) placeLocal();
}

function onStateChange() {
  applyCursor();
  updateRemoteCursors(state.players);
}

export function initCursors() {
  if (started) return api;
  layer = document.getElementById('cursor-layer');
  remoteLayer = document.getElementById('remote-layer') || layer;
  if (!layer) throw new Error('cursors: #cursor-layer missing from index.html');

  localEl = document.createElement('div');
  localEl.className = 'dom-cursor is-hidden';
  localEl.dataset.hx = '9';
  localEl.dataset.hy = '7';
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
  applyCursor();
  return api;
}

const api = {
  init: initCursors,
  set: setCursorState,
  get: cursorState,
  setLocalCursor,
  updateRemoteCursors,
};

export default api;
