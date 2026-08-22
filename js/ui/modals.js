// Overlay panels: SOLVED, level grid, name entry and the multiplayer roster, in one focus-trapped container.

import { state, on, emit, setLevel, markCompleted, bestFor, setPlayerName } from '../state.js';
import { LEVELS } from '../levels.js';
import { playSfx } from './hud.js';

const SOLVE_DELAY = 750;
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';

let rootEl = null;
let current = null;
let started = false;
let lastFocus = null;
let closeTimer = 0;
let solveTimer = 0;
let wasSolved = false;

const handlers = {
  onNextLevel: null,
  onFreePlay: null,
  onSelectLevel: null,
  onJoin: null,
  onLeaveRoom: null,
};

export function setModalHandlers(next) {
  Object.assign(handlers, next || {});
}

/* ---------- progress ---------- */

/* js/state.js owns the persisted progress under 'refract.progress.v1', keyed by the level's
   own `id`. Writing a second, differently shaped record to that same key used to clobber it,
   so everything here reads and writes through state's API instead. */

function bestByIndex(index) {
  const lvl = LEVELS[index];
  if (!lvl) return null;
  return bestFor(lvl.id);
}

// A level is open if it is the first, or the level before it has been cleared.
function unlockedThrough() {
  let n = 0;
  for (let i = 1; i < LEVELS.length; i++) {
    if (bestByIndex(i - 1) === null) break;
    n = i;
  }
  return n;
}

function clearedCount() {
  let n = 0;
  for (let i = 0; i < LEVELS.length; i++) if (bestByIndex(i) !== null) n++;
  return n;
}

export function recordSolve(levelIndex, used) {
  const lvl = LEVELS[levelIndex];
  if (lvl) markCompleted(lvl.id, used);
  return { best: bestByIndex(levelIndex), unlocked: unlockedThrough() };
}

export function storedName() {
  return (state.me && state.me.name) || '';
}

function storeName(name) {
  setPlayerName(name);
}

/* ---------- helpers ---------- */

function esc(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function usedCount() {
  if (Number.isFinite(state.used)) return state.used;
  const optics = state.optics || [];
  let n = 0;
  for (let i = 0; i < optics.length; i++) if (optics[i] && !optics[i].fixed) n++;
  return n;
}

function randomRoom() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const bytes = new Uint8Array(4);
  if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
  else for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256);
  for (let i = 0; i < 4; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

/* ---------- panel builders ---------- */

function solvedPanel() {
  const index = Number.isFinite(state.levelIndex) ? state.levelIndex : 0;
  const used = usedCount();
  const par = Number.isFinite(state.level && state.level.par) ? state.level.par : used;
  const hasNext = index + 1 < LEVELS.length;

  let verdict;
  if (used < par) verdict = '<span class="good">' + (par - used) + ' UNDER PAR</span>';
  else if (used === par) verdict = '<span class="good">ON PAR</span>';
  else verdict = '<span class="accent">' + (used - par) + ' OVER PAR</span>';

  return {
    className: 'panel panel-solved',
    label: 'Level solved',
    html:
      '<h2 class="panel-word">SOLVED</h2>' +
      '<p class="panel-sub">' + used + ' PIECE' + (used === 1 ? '' : 'S') + ' USED &middot; PAR ' + par +
      '<br>' + verdict + '</p>' +
      '<div class="panel-actions">' +
        (hasNext
          ? '<button type="button" class="btn btn-primary" data-act="next">NEXT LEVEL</button>'
          : '<button type="button" class="btn btn-primary" data-act="levels">ALL LEVELS</button>') +
        '<button type="button" class="btn" data-act="free">FREE PLAY</button>' +
      '</div>',
  };
}

function levelsPanel() {
  const currentIndex = Number.isFinite(state.levelIndex) ? state.levelIndex : 0;
  const unlocked = Math.max(unlockedThrough(), currentIndex);

  const cells = LEVELS.map((lvl, i) => {
    const best = bestByIndex(i);
    const done = Number.isFinite(best);
    const locked = i > unlocked;
    const par = Number.isFinite(lvl.par) ? lvl.par : 0;
    const beat = done && par > 0 && best < par;
    const classes = ['level-cell'];
    if (locked) classes.push('is-locked'); else classes.push('is-open');
    if (done) classes.push('is-done');
    if (beat) classes.push('is-best');
    if (i === currentIndex) classes.push('is-current');
    const score = locked ? 'LOCKED' : (done ? 'BEST ' + best + ' / PAR ' + par : 'PAR ' + par);
    const num = Number.isFinite(lvl.id) ? lvl.id : i + 1;
    return '<button type="button" class="' + classes.join(' ') + '" data-act="pick" data-index="' + i + '"' +
      (locked ? ' disabled' : '') + '>' +
      '<span class="cell-no">' + String(num).padStart(2, '0') + '</span>' +
      '<span class="cell-name">' + esc(String(lvl.name || '').toUpperCase()) + '</span>' +
      '<span class="cell-score">' + score + '</span>' +
      '</button>';
  }).join('');

  const cleared = clearedCount();

  return {
    className: 'panel',
    label: 'Level select',
    html:
      '<p class="panel-head">LEVELS &middot; ' + cleared + ' / ' + LEVELS.length + ' CLEARED</p>' +
      '<div class="level-grid">' + cells + '</div>' +
      '<div class="panel-actions"><button type="button" class="btn" data-act="close">CLOSE</button></div>',
  };
}

function namePanel() {
  const name = storedName();
  const room = state.roomId || randomRoom();
  return {
    className: 'panel',
    label: 'Join a room',
    html:
      '<p class="panel-head">PLAY TOGETHER</p>' +
      '<form data-act="joinform" autocomplete="off">' +
        '<label class="field"><span>YOUR NAME</span>' +
        '<input name="name" maxlength="12" required placeholder="PICK A NAME" value="' + esc(name) + '"></label>' +
        '<label class="field"><span>ROOM CODE</span>' +
        '<input name="room" maxlength="6" required placeholder="ABCD" value="' + esc(room) + '"></label>' +
        '<div class="panel-actions">' +
          '<button type="submit" class="btn btn-primary">JOIN ROOM</button>' +
          '<button type="button" class="btn" data-act="close">CANCEL</button>' +
        '</div>' +
      '</form>' +
      '<p class="panel-note">SHARE THE CODE &middot; EVERYONE MOVES THE SAME PIECES</p>',
  };
}

function rosterHTML() {
  const players = state.players || {};
  const ids = Object.keys(players);
  if (!ids.length) return '<li><span>WAITING FOR PLAYERS</span></li>';
  return ids.map((id) => {
    const p = players[id] || {};
    const colour = p.color || '#8a888c';
    const isSelf = !!(state.me && id === state.me.id);
    return '<li><i class="swatch" style="background:' + esc(colour) + ';color:' + esc(colour) + '"></i>' +
      '<span>' + esc(String(p.name || 'GUEST').toUpperCase()) + '</span>' +
      (isSelf ? '<span class="self">YOU</span>' : '') + '</li>';
  }).join('');
}

function multiplayerPanel() {
  const rows = rosterHTML();

  return {
    className: 'panel',
    label: 'Room',
    html:
      '<p class="panel-head">ROOM</p>' +
      '<p class="room-code">' + esc(String(state.roomId || '----').toUpperCase()) + '</p>' +
      '<ul class="roster">' + rows + '</ul>' +
      '<div class="panel-actions">' +
        '<button type="button" class="btn btn-primary" data-act="close">BACK TO THE BOARD</button>' +
        '<button type="button" class="btn" data-act="leave">LEAVE</button>' +
      '</div>',
  };
}

const BUILDERS = {
  solved: solvedPanel,
  levels: levelsPanel,
  name: namePanel,
  multiplayer: multiplayerPanel,
};

/* ---------- container ---------- */

function trapFocus(ev) {
  if (ev.key !== 'Tab' || !current) return;
  const nodes = [...rootEl.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
  if (!nodes.length) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
  else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
}

function onKeydown(ev) {
  if (!current) return;
  if (ev.key === 'Escape') {
    ev.preventDefault();
    ev.stopPropagation();
    hideModal();
    return;
  }
  trapFocus(ev);
}

function onClick(ev) {
  const scrim = ev.target.closest('.scrim');
  if (scrim) { hideModal(); return; }
  const btn = ev.target.closest('[data-act]');
  if (!btn || btn.tagName === 'FORM') return;
  const act = btn.dataset.act;

  if (act === 'close') { playSfx('ui_click'); hideModal(); }
  else if (act === 'free') { playSfx('ui_click'); hideModal(); }
  else if (act === 'next') { playSfx('ui_switch'); goNext(); }
  else if (act === 'levels') { playSfx('ui_click'); showModal('levels'); }
  else if (act === 'pick') {
    playSfx('ui_switch');
    const i = parseInt(btn.dataset.index, 10);
    if (Number.isFinite(i)) pickLevel(i);
  } else if (act === 'leave') {
    playSfx('ui_click');
    if (handlers.onLeaveRoom) {
      handlers.onLeaveRoom();
    } else {
      emit('multiplayer:leave', null);
      document.dispatchEvent(new CustomEvent('refract:leave'));
    }
    hideModal();
  }
}

function onSubmit(ev) {
  const form = ev.target.closest('[data-act="joinform"]');
  if (!form) return;
  ev.preventDefault();
  const name = String(form.name.value || '').trim().toUpperCase().slice(0, 12);
  const room = String(form.room.value || '').trim().toUpperCase().slice(0, 6);
  if (!name || !room) return;
  storeName(name);
  playSfx('ui_switch');
  if (handlers.onJoin) {
    handlers.onJoin({ name, roomId: room });
  } else {
    // js/main.js listens for this on the state bus and calls startMultiplayer().
    emit('multiplayer:request', { roomId: room, name });
    document.dispatchEvent(new CustomEvent('refract:join', { detail: { name, roomId: room } }));
  }
  hideModal();
}

function goNext() {
  const index = Number.isFinite(state.levelIndex) ? state.levelIndex : 0;
  const next = Math.min(index + 1, LEVELS.length - 1);
  hideModal();
  if (handlers.onNextLevel) handlers.onNextLevel(next);
  else setLevel(next);
}

function pickLevel(i) {
  hideModal();
  if (handlers.onSelectLevel) handlers.onSelectLevel(i);
  else setLevel(i);
}

function render(name) {
  const build = BUILDERS[name];
  if (!build) return false;
  const spec = build();
  rootEl.innerHTML =
    '<div class="scrim"></div>' +
    '<section class="' + spec.className + '" role="dialog" aria-modal="true" aria-label="' + esc(spec.label) + '">' +
    spec.html + '</section>';
  return true;
}

export function showModal(name) {
  if (!started) initModals();
  if (name == null || name === false) return hideModal();
  if (!BUILDERS[name]) return;

  window.clearTimeout(closeTimer);
  if (!current) lastFocus = document.activeElement;

  if (!render(name)) return;
  current = name;
  rootEl.classList.remove('is-closing');
  rootEl.classList.add('is-open');

  const focusTarget = rootEl.querySelector('input') || rootEl.querySelector('.btn-primary') || rootEl.querySelector(FOCUSABLE);
  if (focusTarget) focusTarget.focus({ preventScroll: true });
}

export function hideModal() {
  if (!current) return;
  current = null;
  rootEl.classList.add('is-closing');
  window.clearTimeout(closeTimer);
  closeTimer = window.setTimeout(() => {
    rootEl.classList.remove('is-open', 'is-closing');
    rootEl.innerHTML = '';
  }, 170);
  if (lastFocus && document.contains(lastFocus)) { try { lastFocus.focus({ preventScroll: true }); } catch (err) { void err; } }
  lastFocus = null;
}

export function openModal() { return current; }

// The capture harness composes solved boards on purpose and must photograph the lit board,
// not the panel that covers it. It asks for the panel explicitly instead.
let autoOpen = true;
export function setAutoOpen(on) {
  autoOpen = !!on;
  if (!autoOpen) window.clearTimeout(solveTimer);
}

function onStateChange() {
  const solved = !!state.solved;
  if (solved && !wasSolved) {
    wasSolved = true;
    recordSolve(Number.isFinite(state.levelIndex) ? state.levelIndex : 0, usedCount());
    window.clearTimeout(solveTimer);
    solveTimer = window.setTimeout(() => {
      if (autoOpen && state.solved && current !== 'solved') showModal('solved');
    }, SOLVE_DELAY);
  } else if (!solved && wasSolved) {
    wasSolved = false;
    window.clearTimeout(solveTimer);
    if (current === 'solved') hideModal();
  }
  if (current === 'multiplayer') {
    const roster = rootEl.querySelector('.roster');
    if (roster) roster.innerHTML = rosterHTML();
    const code = rootEl.querySelector('.room-code');
    if (code) code.textContent = String(state.roomId || '----').toUpperCase();
  }
}

export function initModals() {
  if (started) return api;
  rootEl = document.getElementById('modal-root');
  if (!rootEl) throw new Error('modals: #modal-root missing from index.html');

  rootEl.addEventListener('click', onClick);
  rootEl.addEventListener('submit', onSubmit);
  document.addEventListener('keydown', onKeydown, true);

  started = true;
  wasSolved = !!state.solved;
  on('change', onStateChange);
  return api;
}

const api = {
  init: initModals,
  show: showModal,
  hide: hideModal,
  open: openModal,
  setHandlers: setModalHandlers,
  recordSolve,
  storedName,
};

export default api;
