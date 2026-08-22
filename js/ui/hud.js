// HUD chrome: level title, control chips, inventory dock, used/par readout and the hint strip.

import { state, on, emit, reset, addOptic, selectOptic } from '../state.js';
import { boardToPixel, pixelToBoard } from '../render/gl.js';
import { isValidPlacement } from '../input.js';
import { showModal } from './modals.js';

const TAU = Math.PI * 2;
const PLACE_SNAP = 25;
const TAP_SLOP = 8;

const GLYPHS = {
  mirror: '<svg class="glyph" viewBox="0 0 40 28" aria-hidden="true"><rect class="bar" x="6" y="11.6" width="28" height="4.8" rx="2.4"/></svg>',
  prism: '<svg class="glyph" viewBox="0 0 40 28" aria-hidden="true"><path class="stroke" d="M20 4.5 L33 23.5 L7 23.5 Z"/><path class="stroke" d="M20 4.5 L20 23.5" opacity="0.32"/></svg>',
};

const LABELS = { mirror: 'MIRROR', prism: 'PRISM' };
const DEFAULT_ANGLE = { mirror: Math.PI / 4, prism: 0 };

let root = null;
let canvasEl = null;
let el = {};
let tiles = new Map();
let lastCounts = new Map();
let lastLevelId = null;
let hintPinned = false;
let overrideText = '';
let overrideUntil = 0;
let overrideTone = '';
let lastHintText = '';
let started = false;
let metricsRaf = 0;

// Tap-then-tap placement: a tile is "armed", the next tap on the board drops the optic.
let armedType = null;
let tapStart = null;

let audioMod = null;
let audioRequested = false;

/* ---------- audio bridge (audio.js is owned by another module; stay tolerant) ---------- */

export function playSfx(name) {
  if (!state || state.sound === false) return;
  if (!audioRequested) {
    audioRequested = true;
    import('../audio.js').then((m) => { audioMod = m; }).catch(() => { audioMod = null; });
  }
  const m = audioMod;
  if (!m) return;
  const host = (typeof m.play === 'function' || typeof m.playSfx === 'function' || typeof m.sfx === 'function')
    ? m
    : (m.default || null);
  if (!host) return;
  const fn = host.play || host.playSfx || host.sfx;
  if (typeof fn !== 'function') return;
  try { fn.call(host, name); } catch (err) { void err; }
}

/* ---------- board metrics ---------- */

function fallbackMetrics(w, h) {
  const dock = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-zone')) || 96;
  const size = Math.max(120, Math.min(w * 0.79, (h - dock) * 0.9));
  return { x: (w - size) / 2, y: Math.max(8, (h - dock - size) / 2), size, scale: size / 1000 };
}

export function boardMetrics() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  let t = null;
  try { t = boardToPixel(w, h); } catch (err) { t = null; }
  if (!t || !isFinite(t.scale) || !isFinite(t.ox) || !isFinite(t.oy) || t.scale <= 0) {
    return fallbackMetrics(w, h);
  }
  return { x: t.ox, y: t.oy, size: t.scale * 1000, scale: t.scale };
}

export function syncBoardMetrics() {
  const m = boardMetrics();
  const s = document.documentElement.style;
  s.setProperty('--board-x', m.x.toFixed(2) + 'px');
  s.setProperty('--board-y', m.y.toFixed(2) + 'px');
  s.setProperty('--board-size', m.size.toFixed(2) + 'px');
  return m;
}

function queueMetrics() {
  if (metricsRaf) return;
  metricsRaf = requestAnimationFrame(() => { metricsRaf = 0; syncBoardMetrics(); });
}

/* ---------- angle conversion (contract: lives here only) ----------
   ARCHITECTURE.md section 11.2: plain CCW-from-+x degrees to one decimal.
   There is deliberately no clockwise-from-up conversion. */

export function formatAngle(radians) {
  const a = ((radians % TAU) + TAU) % TAU;
  return (a * 180 / Math.PI).toFixed(1) + '°';
}

/* ---------- inventory ---------- */

function inventoryOf(level) {
  const inv = (level && level.inventory) || {};
  const keys = Object.keys(inv).filter((k) => inv[k] > 0);
  return keys.length ? keys : ['mirror'];
}

function placedCount(type) {
  const optics = (state && state.optics) || [];
  let n = 0;
  for (let i = 0; i < optics.length; i++) {
    const o = optics[i];
    if (o && !o.fixed && o.type === type) n++;
  }
  return n;
}

function remaining(type) {
  const inv = (state.level && state.level.inventory) || {};
  return Math.max(0, (inv[type] || 0) - placedCount(type));
}

function usedCount() {
  if (state && Number.isFinite(state.used)) return state.used;
  const optics = (state && state.optics) || [];
  let n = 0;
  for (let i = 0; i < optics.length; i++) if (optics[i] && !optics[i].fixed) n++;
  return n;
}

/* ---------- dock ---------- */

function buildDock() {
  el.dock.innerHTML = '';
  tiles.clear();
  lastCounts.clear();

  for (const type of inventoryOf(state.level)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dock-tile';
    btn.dataset.optic = type;
    btn.setAttribute('aria-label', LABELS[type] || type.toUpperCase());
    btn.innerHTML =
      (GLYPHS[type] || GLYPHS.mirror) +
      '<span class="tile-label">' + (LABELS[type] || type.toUpperCase()) + '</span>' +
      '<span class="badge">0</span>';
    el.dock.appendChild(btn);
    tiles.set(type, { btn, badge: btn.querySelector('.badge') });
  }
}

function updateDock() {
  for (const [type, t] of tiles) {
    const n = remaining(type);
    const prev = lastCounts.get(type);
    if (prev !== n) {
      t.badge.textContent = String(n);
      if (prev !== undefined) {
        t.badge.classList.remove('pop');
        void t.badge.offsetWidth;
        t.badge.classList.add('pop');
      }
      lastCounts.set(type, n);
    }
    const empty = n <= 0;
    t.btn.classList.toggle('is-empty', empty);
    t.btn.setAttribute('aria-disabled', empty ? 'true' : 'false');
    t.btn.draggable = false;
    if (empty && armedType === type) armedType = null;
    const dragging = !empty && state.dragging && state.dragging.type === type;
    t.btn.classList.toggle('is-armed', armedType === type || !!dragging);
    t.btn.setAttribute('aria-pressed', armedType === type ? 'true' : 'false');
  }
}

/* ---------- tap-then-tap placement ---------- */

function snapPos(v) {
  return Math.round(v / PLACE_SNAP) * PLACE_SNAP;
}

function disarm(silent) {
  if (!armedType) return;
  armedType = null;
  if (!silent) setHintOverride('', 0);
  refreshHUD();
}

function arm(type) {
  if (remaining(type) <= 0) {
    playSfx('error');
    setHintOverride('NO ' + (LABELS[type] || type) + 'S LEFT', 1400, 'alert');
    return;
  }
  armedType = armedType === type ? null : type;
  playSfx(armedType ? 'ui_switch' : 'ui_click');
  overrideText = '';
  refreshHUD();
}

function boardPointFromEvent(ev) {
  if (!canvasEl) return null;
  const rect = canvasEl.getBoundingClientRect();
  try {
    return pixelToBoard(ev.clientX - rect.left, ev.clientY - rect.top);
  } catch (err) {
    return null;
  }
}

// Runs in the capture phase on window, so it sees a board tap before js/input.js does.
function onArmedPointerDown(ev) {
  if (!armedType) return;
  if (ev.target && ev.target.closest && ev.target.closest('#hud, #modal-root')) return;
  if (canvasEl && ev.target !== canvasEl) return;

  const p = boardPointFromEvent(ev);
  if (!p) return;
  const type = armedType;
  const x = snapPos(p.x);
  const y = snapPos(p.y);

  ev.preventDefault();
  ev.stopPropagation();

  if (!isValidPlacement(type, x, y, null)) {
    playSfx('error');
    setHintOverride('NO ROOM HERE · TAP OPEN FLOOR', 1500, 'alert');
    return;
  }

  const id = addOptic({ type, x, y, angle: DEFAULT_ANGLE[type] || 0 });
  if (!id) {
    playSfx('error');
    return;
  }
  selectOptic(id);
  armedType = null;
  overrideText = '';
  setHintOverride('DRAG THE HANDLE TO TURN IT', 1600);
  refreshHUD();
}

/* ---------- hint line ---------- */

function contextualHint() {
  const lvl = state.level || {};
  const drag = state.dragging;

  if (overrideText && performance.now() < overrideUntil) return { text: overrideText, tone: overrideTone };
  if (armedType) {
    return { text: 'TAP THE BOARD TO PLACE THE ' + (LABELS[armedType] || armedType) + ' · TAP THE TILE TO CANCEL', tone: 'pinned' };
  }
  if (state.solved) return { text: 'SOLVED · NEXT LEVEL OR KEEP PLAYING', tone: 'pinned' };
  if (drag) {
    const invalid = typeof drag === 'object' && drag.valid === false;
    if (invalid) return { text: 'NO ROOM HERE · RELEASE OVER OPEN FLOOR', tone: 'alert' };
    return { text: 'RELEASE TO PLACE · ESC TO CANCEL', tone: '' };
  }
  // An explicit press of HINT outranks the selection hint — the player asked for it.
  if (hintPinned && lvl.hint) return { text: String(lvl.hint).toUpperCase(), tone: 'pinned' };
  if (state.selectedId) {
    return { text: 'DRAG THE HANDLE TO ROTATE · SHIFT FOR FREE ANGLE · DEL TO REMOVE', tone: '' };
  }

  const anyLeft = [...tiles.keys()].some((t) => remaining(t) > 0);
  if (!anyLeft && usedCount() > 0) {
    return { text: 'NOTHING LEFT TO PLACE · MOVE A PIECE OR RESET', tone: '' };
  }
  if (usedCount() === 0 && lvl.hint) return { text: String(lvl.hint).toUpperCase(), tone: '' };
  return { text: 'DRAG A PIECE ONTO THE BOARD · DRAG IT AGAIN TO TURN IT', tone: '' };
}

function updateHint() {
  const { text, tone } = contextualHint();
  if (text !== lastHintText) {
    el.hint.textContent = text;
    el.hint.classList.remove('is-swapping');
    void el.hint.offsetWidth;
    el.hint.classList.add('is-swapping');
    lastHintText = text;
  }
  el.hint.classList.toggle('is-pinned', tone === 'pinned');
  el.hint.classList.toggle('is-alert', tone === 'alert');
}

export function setHintOverride(text, ms = 2200, tone = '') {
  overrideText = text ? String(text).toUpperCase() : '';
  overrideTone = tone;
  overrideUntil = performance.now() + ms;
  updateHint();
  if (overrideText) window.setTimeout(() => { if (started) updateHint(); }, ms + 20);
}

/* ---------- title / readout ---------- */

function updateTitle() {
  const lvl = state.level || {};
  const index = Number.isFinite(state.levelIndex) ? state.levelIndex : 0;
  const num = Number.isFinite(lvl.id) ? lvl.id : index + 1;
  el.tag.textContent = 'LEVEL ' + String(num).padStart(2, '0');
  // The level's own name, never the game's title.
  el.name.textContent = String(lvl.name || '').toUpperCase();

  const key = String(num) + '/' + (lvl.name || '');
  if (lastLevelId !== null && key !== lastLevelId) {
    el.title.classList.remove('is-swapping');
    void el.title.offsetWidth;
    el.title.classList.add('is-swapping');
  }
  lastLevelId = key;
}

function updateReadout() {
  const used = usedCount();
  const lvl = state.level || {};
  const par = Number.isFinite(lvl.par) ? lvl.par : 0;
  el.used.textContent = 'USED ' + used;
  el.par.textContent = 'PAR ' + par;
  el.readout.classList.toggle('is-over', par > 0 && used > par);
  el.readout.classList.toggle('is-under', state.solved && par > 0 && used < par);
}

function updateSound() {
  const on_ = state.sound !== false;
  el.sound.setAttribute('aria-pressed', on_ ? 'true' : 'false');
  el.sound.title = on_ ? 'Sound on' : 'Sound off';
}

/* ---------- chips ---------- */

function onChipClick(ev) {
  const btn = ev.target.closest('.chip');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'reset') {
    playSfx('ui_click');
    hintPinned = false;
    armedType = null;
    try { reset(); } catch (err) { void err; }
    setHintOverride('BOARD CLEARED', 1400);
  } else if (action === 'hint') {
    playSfx('ui_switch');
    hintPinned = !hintPinned;
    btn.setAttribute('aria-pressed', hintPinned ? 'true' : 'false');
    overrideText = '';
    if (!hintPinned) setHintOverride('', 0);
    refreshHUD();
  } else if (action === 'levels') {
    playSfx('ui_click');
    armedType = null;
    showModal('levels');
  } else if (action === 'sound') {
    state.sound = state.sound === false;
    updateSound();
    if (state.sound) playSfx('ui_switch');
    try { emit('sound', state.sound); } catch (err) { void err; }
    try { emit('change', state); } catch (err) { void err; }
  } else if (action === 'room') {
    playSfx('ui_click');
    armedType = null;
    showModal(state.roomId ? 'multiplayer' : 'name');
  }
}

function onChipHover(ev) {
  const btn = ev.target.closest('.chip, .dock-tile');
  if (!btn || btn.classList.contains('is-empty')) return;
  playSfx('ui_hover');
}

/* Capture phase on the dock: this runs before js/input.js's own dock listener, so we can
   stop a drag from starting when the tile is empty or when the pointer is a finger. */
function onDockPointerDownCapture(ev) {
  const tile = ev.target.closest ? ev.target.closest('.dock-tile') : null;
  if (!tile) return;
  const type = tile.dataset.optic;
  if (!type) return;

  if (tile.classList.contains('is-empty')) {
    ev.preventDefault();
    ev.stopPropagation();
    playSfx('error');
    setHintOverride('NO ' + (LABELS[type] || type) + 'S LEFT', 1400, 'alert');
    return;
  }

  const coarse = ev.pointerType === 'touch' || ev.pointerType === 'pen';
  if (coarse) {
    // Fingers get tap-then-tap: never start a drag whose ghost sits under the thumb.
    ev.preventDefault();
    ev.stopPropagation();
    tapStart = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, type };
    return;
  }

  // Mouse: let js/input.js run its drag. Arming by mouse happens on a keyboard-style click.
  document.dispatchEvent(new CustomEvent('refract:dockpointerdown', {
    detail: { type, pointerId: ev.pointerId, clientX: ev.clientX, clientY: ev.clientY, originalEvent: ev },
  }));
}

function onDockPointerUpCapture(ev) {
  if (!tapStart || ev.pointerId !== tapStart.id) return;
  const moved = Math.hypot(ev.clientX - tapStart.x, ev.clientY - tapStart.y);
  const type = tapStart.type;
  tapStart = null;
  ev.preventDefault();
  ev.stopPropagation();
  if (moved <= TAP_SLOP) arm(type);
}

function onDockPointerCancel(ev) {
  if (tapStart && ev.pointerId === tapStart.id) tapStart = null;
}

// Keyboard activation (Enter/Space on a focused tile) reports detail 0.
function onDockClick(ev) {
  const tile = ev.target.closest ? ev.target.closest('.dock-tile') : null;
  if (!tile || ev.detail !== 0) return;
  const type = tile.dataset.optic;
  if (type) arm(type);
}

function onKeyDown(ev) {
  if (ev.key === 'Escape' && armedType) disarm(false);
}

/* ---------- public ---------- */

export function refreshHUD() {
  if (!started) return;
  const lvlKey = String((state.level && state.level.id) || state.levelIndex || 0) +
    ':' + Object.keys((state.level && state.level.inventory) || {}).join(',');
  if (el.dock.dataset.key !== lvlKey) {
    el.dock.dataset.key = lvlKey;
    armedType = null;
    buildDock();
  }
  updateTitle();
  updateDock();
  updateReadout();
  updateSound();
  updateHint();
  queueMetrics();
}

export function initHUD() {
  if (started) return api;
  root = document.getElementById('hud');
  if (!root) throw new Error('hud: #hud missing from index.html');
  canvasEl = document.getElementById('board');

  el = {
    title: root.querySelector('.title-block'),
    tag: document.getElementById('level-tag'),
    name: document.getElementById('level-name'),
    chips: document.getElementById('chip-row'),
    hint: document.getElementById('hint-line'),
    readout: document.getElementById('readout'),
    used: root.querySelector('.readout-used'),
    par: root.querySelector('.readout-par'),
    dock: document.getElementById('dock'),
    sound: root.querySelector('[data-action="sound"]'),
  };

  el.chips.addEventListener('click', onChipClick);
  el.chips.addEventListener('pointerenter', onChipHover, true);
  el.dock.addEventListener('pointerenter', onChipHover, true);
  el.dock.addEventListener('pointerdown', onDockPointerDownCapture, true);
  el.dock.addEventListener('pointerup', onDockPointerUpCapture, true);
  el.dock.addEventListener('pointercancel', onDockPointerCancel, true);
  el.dock.addEventListener('click', onDockClick);
  el.dock.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('pointerdown', onArmedPointerDown, true);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', queueMetrics, { passive: true });
  window.addEventListener('orientationchange', queueMetrics, { passive: true });

  started = true;
  syncBoardMetrics();
  on('change', refreshHUD);
  refreshHUD();
  return api;
}

// main.js resolves the entry point by name, trying initHud / init / createHud / mount.
export const init = initHUD;
export const initHud = initHUD;

const api = {
  init: initHUD,
  refresh: refreshHUD,
  setHint: setHintOverride,
  metrics: boardMetrics,
  sync: syncBoardMetrics,
  formatAngle,
};

export default api;
