// HUD chrome: level title, control chips, inventory dock, used/par readout and the hint strip.

import { state, on, emit, reset } from '../state.js';
import { boardToPixel } from '../render/gl.js';
import { showModal } from './modals.js';

const TAU = Math.PI * 2;

const GLYPHS = {
  mirror: '<svg class="glyph" viewBox="0 0 40 28" aria-hidden="true"><rect class="bar" x="6" y="11.6" width="28" height="4.8" rx="2.4"/></svg>',
  prism: '<svg class="glyph" viewBox="0 0 40 28" aria-hidden="true"><path class="stroke" d="M20 4.5 L33 23.5 L7 23.5 Z"/><path class="stroke" d="M20 4.5 L20 23.5" opacity="0.32"/></svg>',
};

const LABELS = { mirror: 'MIRROR', prism: 'PRISM' };

let root = null;
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

/* ---------- angle conversion (contract: lives here only) ---------- */

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
    const armed = !empty && state.dragging && state.dragging.type === type;
    t.btn.classList.toggle('is-armed', !!armed);
  }
}

/* ---------- hint line ---------- */

function contextualHint() {
  const lvl = state.level || {};
  const drag = state.dragging;

  if (overrideText && performance.now() < overrideUntil) return { text: overrideText, tone: overrideTone };
  if (state.solved) return { text: 'SOLVED · NEXT LEVEL OR KEEP PLAYING', tone: 'pinned' };
  if (drag) {
    const invalid = typeof drag === 'object' && drag.valid === false;
    if (invalid) return { text: 'NO ROOM HERE · RELEASE OVER OPEN FLOOR', tone: 'alert' };
    return { text: 'RELEASE TO PLACE · ESC TO CANCEL', tone: '' };
  }
  if (state.selectedId) {
    return { text: 'DRAG THE HANDLE TO ROTATE · SHIFT FOR FREE ANGLE · DEL TO REMOVE', tone: '' };
  }
  if (hintPinned && lvl.hint) return { text: String(lvl.hint).toUpperCase(), tone: 'pinned' };

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
  el.name.textContent = String(lvl.name || 'REFRACT').toUpperCase();

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
  const par = Number.isFinite(state.level && state.level.par) ? state.level.par : 0;
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
    showModal('levels');
  } else if (action === 'sound') {
    state.sound = state.sound === false;
    updateSound();
    if (state.sound) playSfx('ui_switch');
    try { emit('change', { source: 'hud' }); } catch (err) { void err; }
  } else if (action === 'room') {
    playSfx('ui_click');
    showModal(state.roomId ? 'multiplayer' : 'name');
  }
}

function onChipHover(ev) {
  const btn = ev.target.closest('.chip, .dock-tile');
  if (!btn || btn.classList.contains('is-empty')) return;
  playSfx('ui_hover');
}

function onDockPointerDown(ev) {
  const tile = ev.target.closest('.dock-tile');
  if (!tile) return;
  const type = tile.dataset.optic;
  if (tile.classList.contains('is-empty')) {
    playSfx('error');
    setHintOverride('NO ' + (LABELS[type] || type) + 'S LEFT', 1400, 'alert');
    return;
  }
  document.dispatchEvent(new CustomEvent('refract:dockpointerdown', {
    detail: { type, pointerId: ev.pointerId, clientX: ev.clientX, clientY: ev.clientY, originalEvent: ev },
  }));
}

/* ---------- public ---------- */

export function refreshHUD() {
  if (!started) return;
  const lvlKey = String((state.level && state.level.id) || state.levelIndex || 0) +
    ':' + Object.keys((state.level && state.level.inventory) || {}).join(',');
  if (el.dock.dataset.key !== lvlKey) {
    el.dock.dataset.key = lvlKey;
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
  el.dock.addEventListener('pointerdown', onDockPointerDown);
  el.dock.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('resize', queueMetrics, { passive: true });
  window.addEventListener('orientationchange', queueMetrics, { passive: true });

  started = true;
  syncBoardMetrics();
  on('change', refreshHUD);
  refreshHUD();
  return api;
}

const api = {
  init: initHUD,
  refresh: refreshHUD,
  setHint: setHintOverride,
  metrics: boardMetrics,
  sync: syncBoardMetrics,
  formatAngle,
};

export default api;
