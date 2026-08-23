// HUD chrome: level title, control chips, inventory dock, used/par readout and the hint strip.

import { state, on, emit, reset, addOptic, selectOptic } from '../state.js';
import { boardToPixel, pixelToBoard, setBoardLayout, getBoardLayout } from '../render/gl.js';
import { isValidPlacement, TOUCH_GHOST_LIFT } from '../input.js';
import { showModal } from './modals.js';

const TAU = Math.PI * 2;
const PLACE_SNAP = 25;
const TAP_SLOP = 8;
// Apple HIG minimum. css/ui.css grows every control's HIT box to this without growing the
// drawn chip, so the reference's chrome restraint survives contact with a thumb.
const TOUCH_MIN = 44;
// Air between the chrome's touch box and the board's outer wall on a phone.
const CHROME_GAP = 8;

const coarseQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(pointer: coarse)')
  : null;

function isCoarse() {
  return !!(coarseQuery && coarseQuery.matches);
}

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

// Tap-then-tap placement: a tile is "armed", the next press on the board opens a ghost and
// the release drops the optic.
let armedType = null;
let tapStart = null;
let placing = null;

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

/* The renderer cannot see the chrome, so it used to guess at it with viewport fractions:
   on a 375 px phone that guess cost 79 px of horizontal margin and capped the board at
   295.8 px inside an 812 px frame, and on a short wide desktop frame it let the board's
   bottom wall grow 14.5 px through the hint strip. Here we hand it the real rects. */
function measureChrome() {
  if (!started || !el.strip) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const opts = {};

  const strip = el.strip.getBoundingClientRect();
  const narrow = w <= getBoardLayout().narrowMaxWidthPx;

  if (narrow) {
    const chips = el.chips.getBoundingClientRect();
    const one = el.chips.querySelector('.chip');
    const chipH = one ? one.getBoundingClientRect().height : chips.height;
    // The drawn chip is ~21 px tall; its touch box is 44, so it reaches this much further
    // down than its own border box does and the board has to start below THAT.
    const reach = isCoarse() ? Math.max(0, (TOUCH_MIN - chipH) / 2) : 0;
    opts.topReservePx = Math.max(0, chips.bottom + reach + CHROME_GAP);

    /* On a phone the strip is the board's CAPTION: css/ui.css anchors it to --board-y +
       --board-size, so measuring the board's band from the strip would be circular — the
       board would chase its own caption every resize. The dock is anchored to the viewport
       bottom and is the only fixed thing down there, so the band is measured from the dock
       and the caption's own height is added back. */
    const dock = el.dock.getBoundingClientRect();
    const stripH = strip.height > 0 ? strip.height : 14;
    const dockReach = dock.height > 0 ? Math.max(0, h - dock.top) : h * 0.12;
    opts.chromeBottomPx = dockReach;
    opts.bottomReservePx = dockReach + stripH + CHROME_GAP * 2;
  } else if (strip.height > 0) {
    opts.chromeBottomPx = Math.max(0, h - strip.top);
  }

  setBoardLayout(opts);
}

// One re-run per settle. On desktop the strip's own offset is derived from --tile-h, which
// is derived from --board-size, so the first pass can move the answer; the loop is heavily
// damped and converges in two, but it is bounded here so it can never spin.
function queueMetrics(pass = 0) {
  if (metricsRaf) return;
  metricsRaf = requestAnimationFrame(() => {
    metricsRaf = 0;
    const before = boardMetrics().size;
    measureChrome();
    const after = syncBoardMetrics().size;
    if (pass < 2 && Math.abs(after - before) > 0.5) queueMetrics(pass + 1);
  });
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
  clearGhost();
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
  clearGhost();
  armedType = armedType === type ? null : type;
  playSfx(armedType ? 'ui_switch' : 'ui_click');
  overrideText = '';
  refreshHUD();
}

function boardPointFromEventXY(clientX, clientY) {
  if (!canvasEl) return null;
  const rect = canvasEl.getBoundingClientRect();
  try {
    return pixelToBoard(clientX - rect.left, clientY - rect.top);
  } catch (err) {
    return null;
  }
}

/* Tap-to-place used to commit on pointerdown, so a thumb placed a piece it had never seen
   and learned where it landed only from the piece that appeared under it. Now the press
   opens a live ghost that the finger can slide, and the release commits it — the same
   contract the mouse's drag has always had. The ghost is drawn by js/render/board.js from
   state.ghost. */

function ghostAt(type, clientX, clientY) {
  const p = boardPointFromEventXY(clientX, clientY);
  if (!p) return null;
  const x = snapPos(p.x);
  const y = snapPos(p.y);
  return {
    kind: 'place',
    id: null,
    type,
    x,
    y,
    angle: DEFAULT_ANGLE[type] || 0,
    valid: isValidPlacement(type, x, y, null),
  };
}

function clearGhost() {
  if (placing) {
    window.removeEventListener('pointermove', onPlacingMove, true);
    window.removeEventListener('pointerup', onPlacingUp, true);
    window.removeEventListener('pointercancel', onPlacingCancel, true);
  }
  placing = null;
  state.ghost = null;
}

// The first touch lands the ghost exactly where the finger is, so a plain tap is honest.
// Once the finger starts adjusting, the ghost lifts clear of it — an optic is about 40 px
// across at phone scale and a thumb covers all of it.
//
// The lift RAMPS with how far the finger has travelled instead of switching on at the 8 px
// tap threshold: a step would teleport the piece 44 px up the board the instant a tap became
// a drag, which is the piece jumping out from under the player rather than getting out of
// the way. Full lift is reached after 44 px of travel, and sliding back towards the start
// lowers it again.
const LIFT_RAMP_PX = 44;

function placingLift() {
  if (!placing || !placing.moved || !isCoarse()) return 0;
  const t = Math.min(1, Math.max(0, (placing.dist - TAP_SLOP) / (LIFT_RAMP_PX - TAP_SLOP)));
  return TOUCH_GHOST_LIFT * t;
}

function onPlacingMove(ev) {
  if (!placing || ev.pointerId !== placing.pointerId) return;
  placing.dist = Math.hypot(ev.clientX - placing.x0, ev.clientY - placing.y0);
  if (!placing.moved && placing.dist > TAP_SLOP) placing.moved = true;
  const g = ghostAt(placing.type, ev.clientX, ev.clientY - placingLift());
  if (g) state.ghost = g;
  ev.stopPropagation();
  if (ev.cancelable) ev.preventDefault();
}

function onPlacingUp(ev) {
  if (!placing || ev.pointerId !== placing.pointerId) return;
  const g = ghostAt(placing.type, ev.clientX, ev.clientY - placingLift()) || state.ghost;
  const type = placing.type;
  ev.stopPropagation();
  if (ev.cancelable) ev.preventDefault();
  clearGhost();

  if (!g || !g.valid) {
    playSfx('error');
    setHintOverride('NO ROOM HERE · ' + (isCoarse() ? 'TAP OPEN FLOOR' : 'CLICK OPEN FLOOR'), 1500, 'alert');
    refreshHUD();
    return;
  }

  const id = addOptic({ type, x: g.x, y: g.y, angle: g.angle });
  if (!id) {
    playSfx('error');
    refreshHUD();
    return;
  }
  selectOptic(id);
  armedType = null;
  overrideText = '';
  // A finger turns the piece from anywhere on the ring, not just the dot (js/input.js
  // handleAt), so the touch copy names the ring and the mouse copy names the handle.
  setHintOverride(isCoarse() ? 'DRAG THE RING TO TURN IT' : 'DRAG THE HANDLE TO ROTATE IT', 1600);
  refreshHUD();
}

function onPlacingCancel(ev) {
  if (!placing || ev.pointerId !== placing.pointerId) return;
  clearGhost();
  refreshHUD();
}

// Runs in the capture phase on window, so it sees a board tap before js/input.js does.
function onArmedPointerDown(ev) {
  if (!armedType || placing) return;
  if (ev.target && ev.target.closest && ev.target.closest('#hud, #modal-root')) return;
  if (canvasEl && ev.target !== canvasEl) return;

  const g = ghostAt(armedType, ev.clientX, ev.clientY);
  if (!g) return;

  ev.preventDefault();
  ev.stopPropagation();

  placing = { pointerId: ev.pointerId, type: armedType, x0: ev.clientX, y0: ev.clientY, moved: false, dist: 0 };
  state.ghost = g;
  window.addEventListener('pointermove', onPlacingMove, true);
  window.addEventListener('pointerup', onPlacingUp, true);
  window.addEventListener('pointercancel', onPlacingCancel, true);
}

/* ---------- hint line ---------- */

/* The strip under the board carries the hint OR the USED/PAR readout, never both — the
   reference gives them one 9 px row and shows exactly one at a time (ref_001 shows the hint
   on a fresh board and no readout at all). `ambient` marks the one line that says nothing
   the player does not already know; that is the state where the readout takes the strip. */
function contextualHint() {
  const lvl = state.level || {};
  const drag = state.dragging;

  if (overrideText && performance.now() < overrideUntil) return { text: overrideText, tone: overrideTone };
  if (armedType) {
    const verb = isCoarse() ? 'TOUCH' : 'CLICK';
    if (placing) return { text: 'SLIDE TO AIM · RELEASE TO PLACE', tone: 'pinned' };
    return { text: verb + ' THE BOARD TO PLACE THE ' + (LABELS[armedType] || armedType) + ' · ' + verb + ' THE TILE TO CANCEL', tone: 'pinned' };
  }
  /* Solved: the strip hands itself to USED / PAR. It used to read
     'SOLVED · NEXT LEVEL OR KEEP PLAYING', which is word for word what the solve panel
     directly above it already says, so the frame carried the same sentence twice; and once
     the panel is dismissed for free play that line keeps repeating an instruction the
     player has already acted on. The score is the one thing neither the panel nor the
     board is showing at that point. */
  if (state.solved) return { text: '', tone: '', ambient: true };
  if (drag) {
    const invalid = typeof drag === 'object' && drag.valid === false;
    if (invalid) return { text: 'NO ROOM HERE · RELEASE OVER OPEN FLOOR', tone: 'alert' };
    // ESC is not a key a thumb has.
    return { text: isCoarse() ? 'RELEASE TO PLACE' : 'RELEASE TO PLACE · ESC TO CANCEL', tone: '' };
  }
  // An explicit press of HINT outranks the selection hint — the player asked for it.
  if (hintPinned && lvl.hint) return { text: String(lvl.hint).toUpperCase(), tone: 'pinned' };
  if (state.selectedId) {
    // On a phone there is no SHIFT and no DEL, and the piece is turned with a thumb on the
    // handle, so the desktop line named three things a finger cannot do.
    if (isCoarse()) return { text: 'DRAG THE RING TO TURN · HOLD THE PIECE TO REMOVE IT', tone: '' };
    return { text: 'DRAG THE HANDLE TO ROTATE · SHIFT FOR FREE ANGLE · DEL TO REMOVE', tone: '' };
  }

  const anyLeft = [...tiles.keys()].some((t) => remaining(t) > 0);
  if (!anyLeft && usedCount() > 0) {
    return { text: 'NOTHING LEFT TO PLACE · MOVE A PIECE OR RESET', tone: '' };
  }
  if (usedCount() === 0 && lvl.hint) return { text: String(lvl.hint).toUpperCase(), tone: '' };
  if (isCoarse()) {
    return { text: 'TAP A PIECE, THEN TOUCH THE BOARD TO PLACE IT', tone: '', ambient: true };
  }
  return { text: 'DRAG A PIECE ONTO THE BOARD · DRAG IT AGAIN TO TURN IT', tone: '', ambient: true };
}

function updateHint() {
  const { text, tone, ambient } = contextualHint();
  // Mid-solve, with nothing selected and nothing to say: the strip belongs to USED / PAR.
  el.hint.classList.toggle('is-hidden', !!ambient);
  el.readout.classList.toggle('is-hidden', !ambient);
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
  // Five glyphs either way, so the chip keeps its width while the state stays readable.
  // The text lives on the inner .gw span; writing the button's own textContent would delete
  // the span and drop the label back to the unwidened letterforms.
  el.soundLabel.textContent = on_ ? 'SOUND' : 'MUTED';
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

function onViewportChange() {
  queueMetrics();
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
    strip: document.getElementById('board-strip'),
    hint: document.getElementById('hint-line'),
    readout: document.getElementById('readout'),
    used: root.querySelector('.readout-used'),
    par: root.querySelector('.readout-par'),
    dock: document.getElementById('dock'),
    sound: root.querySelector('[data-action="sound"]'),
  };
  el.soundLabel = el.sound.querySelector('.gw') || el.sound;

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
  window.addEventListener('resize', onViewportChange, { passive: true });
  window.addEventListener('orientationchange', onViewportChange, { passive: true });
  if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
    document.fonts.ready.then(() => { if (started) queueMetrics(); }).catch(() => {});
  }

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
