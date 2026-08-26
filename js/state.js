// Central store for REFRACT: level state, optic mutators, undo/redo command stack, trace scheduling and persistence.

import { LEVELS } from './levels.js';
import { traceScene } from './optics/trace.js';
import { norm } from './optics/geometry.js';

const STORAGE_KEY = 'refract.progress.v1';
const STORAGE_VERSION = 1;

// The drag path retraces at 60 Hz. Borrowing segments from the tracer's pool cuts this
// from ~263 KB to ~17 KB per trace and drops GC events by about two thirds. Safe here
// because every consumer (main.js beams.upload, board.js light gathering) re-reads
// state.trace.segments each frame and never holds a previous trace to compare against.
// The lane name must stay distinct from solver.js's 'solver-verdict', or a hint search
// would scribble over the beams being drawn.
const TRACE_OPTS = {
  spectralSamples: 48,
  maxBounces: 64,
  maxSegments: 4000,
  receptorThreshold: 0.06,
  borrowSegments: 'render',
};

const EMPTY_TRACE = { segments: [], receptors: [], solved: false, stats: {} };

export const state = {
  levelIndex: 0,
  level: null,
  optics: [],
  selectedId: null,
  dragging: null,
  trace: EMPTY_TRACE,
  solved: false,
  used: 0,
  sound: true,
  players: {},
  me: { id: null, name: '', color: '#2131C7' },
  roomId: null,
  mode: 'solo',
  cursor: { x: 500, y: 500, style: 'arrow' },
  paused: false,
  time: 0,
  progress: { completed: {}, lastLevel: 0 },
  anim: { optics: {}, receptors: {}, bursts: [], receptorFade: 1 },
};

const listeners = new Map();

export function on(evt, fn) {
  let set = listeners.get(evt);
  if (!set) {
    set = new Set();
    listeners.set(evt, set);
  }
  set.add(fn);
  return () => off(evt, fn);
}

export function off(evt, fn) {
  const set = listeners.get(evt);
  if (set) set.delete(fn);
}

export function emit(evt, payload) {
  const set = listeners.get(evt);
  if (set) for (const fn of Array.from(set)) fn(payload, evt);
  const any = listeners.get('*');
  if (any) for (const fn of Array.from(any)) fn(payload, evt);
}

function changed(evt, payload) {
  if (evt) emit(evt, payload);
  emit('change', state);
}

let traceDirty = true;
let opticCounter = 0;
let undoStack = [];
let redoStack = [];
let persistTimer = 0;

export function markTraceDirty() {
  traceDirty = true;
}

export function isTraceDirty() {
  return traceDirty;
}

function nextId() {
  opticCounter += 1;
  return state.me.id ? `${state.me.id}o${opticCounter}` : `o${opticCounter}`;
}

function recount() {
  let used = 0;
  for (const o of state.optics) if (!o.fixed) used += 1;
  state.used = used;
}

function findOptic(id) {
  for (const o of state.optics) if (o.id === id) return o;
  return null;
}

export function getOptic(id) {
  return findOptic(id);
}

export function remaining(type) {
  const level = state.level;
  if (!level) return 0;
  const total = (level.inventory && level.inventory[type]) || 0;
  let placed = 0;
  for (const o of state.optics) if (!o.fixed && o.type === type) placed += 1;
  return total - placed;
}

export function inventory() {
  const level = state.level;
  const out = {};
  if (!level || !level.inventory) return out;
  for (const type of Object.keys(level.inventory)) out[type] = remaining(type);
  return out;
}

function record(cmd) {
  const top = undoStack[undoStack.length - 1];
  if (
    top &&
    state.dragging &&
    top.k === cmd.k &&
    (cmd.k === 'move' || cmd.k === 'rotate') &&
    top.id === cmd.id
  ) {
    top.to = cmd.to;
    redoStack.length = 0;
    return;
  }
  undoStack.push(cmd);
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
}

function applyCmd(cmd, dir) {
  if (cmd.k === 'add') {
    if (dir > 0) state.optics.push({ ...cmd.optic });
    else removeById(cmd.optic.id);
  } else if (cmd.k === 'remove') {
    if (dir > 0) removeById(cmd.optic.id);
    else state.optics.splice(Math.min(cmd.index, state.optics.length), 0, { ...cmd.optic });
  } else if (cmd.k === 'move') {
    const o = findOptic(cmd.id);
    if (o) {
      const p = dir > 0 ? cmd.to : cmd.from;
      o.x = p[0];
      o.y = p[1];
    }
  } else if (cmd.k === 'rotate') {
    const o = findOptic(cmd.id);
    if (o) o.angle = dir > 0 ? cmd.to : cmd.from;
  } else if (cmd.k === 'reset') {
    if (dir > 0) state.optics = state.optics.filter((o) => o.fixed);
    else for (const o of cmd.optics) state.optics.push({ ...o });
  }
}

function removeById(id) {
  const i = state.optics.findIndex((o) => o.id === id);
  if (i >= 0) state.optics.splice(i, 1);
  if (state.selectedId === id) state.selectedId = null;
}

export function setLevel(index) {
  const clamped = Math.max(0, Math.min(LEVELS.length - 1, index | 0));
  const level = LEVELS[clamped];
  state.levelIndex = clamped;
  state.level = level;
  state.optics = (level.fixed || []).map((f, i) => ({
    id: `f${i}`,
    type: f.type,
    x: f.x,
    y: f.y,
    angle: norm(f.angle || 0),
    fixed: true,
    owner: null,
  }));
  state.selectedId = null;
  state.dragging = null;
  state.solved = false;
  state.trace = EMPTY_TRACE;
  state.anim = { optics: {}, receptors: {}, bursts: [], receptorFade: 1 };
  undoStack = [];
  redoStack = [];
  opticCounter = 0;
  recount();
  markTraceDirty();
  state.progress.lastLevel = clamped;
  persist();
  changed('level', level);
}

export function addOptic(partial) {
  if (!state.level) return null;
  const type = partial.type;
  if (!partial.force && !partial.fixed && remaining(type) <= 0) {
    emit('invalid', { reason: 'inventory', type });
    return null;
  }
  const optic = {
    id: partial.id || nextId(),
    type,
    x: partial.x,
    y: partial.y,
    angle: norm(partial.angle || 0),
    fixed: !!partial.fixed,
    owner: partial.owner !== undefined ? partial.owner : state.me.id,
  };
  state.optics.push(optic);
  if (!optic.fixed && !partial.silent) record({ k: 'add', optic: { ...optic } });
  recount();
  markTraceDirty();
  changed('optic:add', optic);
  return optic.id;
}

export function removeOptic(id) {
  const index = state.optics.findIndex((o) => o.id === id);
  if (index < 0) return false;
  const optic = state.optics[index];
  if (optic.fixed) {
    emit('invalid', { reason: 'fixed', id });
    return false;
  }
  record({ k: 'remove', optic: { ...optic }, index });
  state.optics.splice(index, 1);
  if (state.selectedId === id) state.selectedId = null;
  recount();
  markTraceDirty();
  changed('optic:remove', optic);
  return true;
}

export function moveOptic(id, x, y) {
  const optic = findOptic(id);
  if (!optic || optic.fixed) return false;
  if (optic.x === x && optic.y === y) return false;
  record({ k: 'move', id, from: [optic.x, optic.y], to: [x, y] });
  optic.x = x;
  optic.y = y;
  markTraceDirty();
  changed('optic:move', optic);
  return true;
}

export function rotateOptic(id, a) {
  const optic = findOptic(id);
  if (!optic || optic.fixed) return false;
  const angle = norm(a);
  if (optic.angle === angle) return false;
  record({ k: 'rotate', id, from: optic.angle, to: angle });
  optic.angle = angle;
  markTraceDirty();
  changed('optic:rotate', optic);
  return true;
}

export function selectOptic(id) {
  if (state.selectedId === id) return false;
  state.selectedId = id;
  changed('select', id);
  return true;
}

export function setDragging(drag) {
  state.dragging = drag;
  changed('dragging', drag);
}

export function undo() {
  const cmd = undoStack.pop();
  if (!cmd) return false;
  applyCmd(cmd, -1);
  redoStack.push(cmd);
  recount();
  markTraceDirty();
  changed('undo', cmd);
  return true;
}

export function redo() {
  const cmd = redoStack.pop();
  if (!cmd) return false;
  applyCmd(cmd, 1);
  undoStack.push(cmd);
  recount();
  markTraceDirty();
  changed('redo', cmd);
  return true;
}

export function reset() {
  const snapshot = state.optics.filter((o) => !o.fixed).map((o) => ({ ...o }));
  if (snapshot.length) undoStack.push({ k: 'reset', optics: snapshot });
  redoStack.length = 0;
  state.optics = state.optics.filter((o) => o.fixed);
  state.selectedId = null;
  state.dragging = null;
  recount();
  markTraceDirty();
  changed('reset', null);
  return true;
}

export function clearOptics() {
  state.optics = state.optics.filter((o) => o.fixed);
  state.selectedId = null;
  state.dragging = null;
  undoStack = [];
  redoStack = [];
  recount();
  markTraceDirty();
  changed('reset', null);
}

export function canUndo() {
  return undoStack.length > 0;
}

export function canRedo() {
  return redoStack.length > 0;
}

export function runTrace(force) {
  if (!state.level) return state.trace;
  if (!traceDirty && !force) return state.trace;
  traceDirty = false;
  const result = traceScene(state.level, state.optics, TRACE_OPTS);
  state.trace = result;
  const wasSolved = state.solved;
  state.solved = !!result.solved;
  emit('trace', result);
  if (state.solved && !wasSolved) {
    markCompleted(state.level.id, state.used);
    emit('solved', { level: state.level, used: state.used, par: state.level.par });
  } else if (!state.solved && wasSolved) {
    emit('unsolved', null);
  }
  emit('change', state);
  return result;
}

export function setCursor(x, y, style) {
  state.cursor.x = x;
  state.cursor.y = y;
  if (style) state.cursor.style = style;
  emit('cursor', state.cursor);
}

export function setMode(mode, roomId) {
  state.mode = mode;
  state.roomId = roomId || null;
  changed('mode', mode);
}

export function setPlayer(id, name, color) {
  state.me.id = id;
  if (name) state.me.name = name;
  if (color) state.me.color = color;
  state.progress.name = state.me.name;
  persist();
  changed('me', state.me);
}

export function setPlayers(players) {
  state.players = players || {};
  changed('players', state.players);
}

export function setSound(enabled) {
  state.sound = !!enabled;
  state.progress.sound = state.sound;
  persist();
  changed('sound', state.sound);
}

export function applyRemote(op) {
  if (!op || !op.type) return;
  if (op.type === 'add') {
    if (findOptic(op.optic.id)) return;
    state.optics.push({ ...op.optic });
  } else if (op.type === 'remove') {
    removeById(op.id);
  } else if (op.type === 'update') {
    const o = findOptic(op.optic.id);
    if (o) {
      o.x = op.optic.x;
      o.y = op.optic.y;
      o.angle = op.optic.angle;
    } else {
      state.optics.push({ ...op.optic });
    }
  } else if (op.type === 'level') {
    if (op.index !== state.levelIndex) setLevel(op.index);
    return;
  }
  recount();
  markTraceDirty();
  changed('remote', op);
}

export function markCompleted(levelId, used) {
  const completed = state.progress.completed;
  const prev = completed[levelId];
  if (prev === undefined || used < prev) completed[levelId] = used;
  persist();
}

export function bestFor(levelId) {
  const v = state.progress.completed[levelId];
  return v === undefined ? null : v;
}

export function isCompleted(levelId) {
  return state.progress.completed[levelId] !== undefined;
}

export function setPlayerName(name) {
  state.me.name = name;
  state.progress.name = name;
  persist();
  changed('me', state.me);
}

// Writing straight through on every change would hit localStorage on every frame of a drag,
// so writes are coalesced -- but a coalesced write that never happens is lost progress. See
// flushPersist below, which is wired to pagehide: closing the tab within 250 ms of finishing
// a level used to throw that level away.
function writeNow() {
  persistTimer = 0;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: STORAGE_VERSION,
        completed: state.progress.completed,
        lastLevel: state.progress.lastLevel,
        sound: state.sound,
        name: state.me.name,
      })
    );
  } catch (err) {
    void err;
  }
}

export function flushPersist() {
  if (!persistTimer) return;
  clearTimeout(persistTimer);
  writeNow();
}

function persist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = 0;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          v: STORAGE_VERSION,
          completed: state.progress.completed,
          lastLevel: state.progress.lastLevel,
          sound: state.sound,
          name: state.me.name,
        })
      );
    } catch (err) {
      void err;
    }
  }, 250);
}

export function loadProgress() {
  let data = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) data = JSON.parse(raw);
  } catch (err) {
    data = null;
  }
  if (!data || data.v !== STORAGE_VERSION) return state.progress;
  state.progress.completed = data.completed || {};
  state.progress.lastLevel = data.lastLevel || 0;
  state.progress.name = data.name || '';
  state.me.name = data.name || '';
  if (typeof data.sound === 'boolean') state.sound = data.sound;
  return state.progress;
}

loadProgress();
