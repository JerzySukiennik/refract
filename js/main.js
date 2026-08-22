// Bootstrap: builds GL, renderers, UI and net, runs the fixed-timestep frame loop and exposes window.REFRACT.

import { initGL, resize, boardToPixel } from './render/gl.js';
import { createPipeline } from './render/pipeline.js';
import { createBeamRenderer } from './render/beams.js';
import { createBoardRenderer } from './render/board.js';
import { createInput } from './input.js';
import { LEVELS } from './levels.js';
import * as solver from './solver.js';
import * as audio from './audio.js';
import * as hud from './ui/hud.js';
import * as modals from './ui/modals.js';
import * as cursors from './ui/cursors.js';
import * as net from './net.js';
import {
  state,
  on,
  emit,
  setLevel,
  addOptic,
  removeOptic,
  selectOptic,
  setDragging,
  setCursor,
  setMode,
  setPlayer,
  setPlayers,
  clearOptics,
  runTrace,
  isTraceDirty,
  applyRemote,
  reset,
} from './state.js';

// Post-process parameters. The grouped form is authoritative; the pipeline's own defaults
// come from the measurements in docs/REFERENCE.md, so we only state deliberate departures.
const POST_PARAMS = {
  exposure: 1.0,
  bloom: { intensity: 0.62, threshold: 0.72, knee: 0.45, radius: 1.0, steps: 6 },
  grain: { amount: 0.018 },
  aberration: { amount: 0.0009 },
  vignette: { amount: 0.11 },
};


const FIXED_STEP = 1 / 120;
const MAX_FRAME = 0.25;
const BURST_RINGS = 3;
const BURST_STAGGER = 0.09;
const BURST_LIFE = 0.4;
const BURST_RADIUS = 180;
const RECEPTOR_FADE_DELAY = 0.25;

function pick(mod, ...names) {
  for (const n of names) {
    if (mod && typeof mod[n] === 'function') return mod[n].bind(mod);
  }
  return null;
}

function call(fn, ...args) {
  if (fn) return fn(...args);
  return undefined;
}

class Spring {
  constructor(value, omega) {
    this.value = value;
    this.target = value;
    this.vel = 0;
    this.omega = omega;
  }
  step(dt) {
    const w = this.omega;
    const d = this.value - this.target;
    const a = -w * w * d - 2 * w * this.vel;
    this.vel += a * dt;
    this.value += this.vel * dt;
  }
  atRest() {
    return Math.abs(this.value - this.target) < 0.001 && Math.abs(this.vel) < 0.01;
  }
}

const springs = new Set();

function makeSpring(value, omega) {
  const s = new Spring(value, omega);
  springs.add(s);
  return s;
}

function dropSpring(s) {
  springs.delete(s);
}

const opticAnim = new Map();
const receptorAnim = new Map();
let bursts = [];
let burstQueue = [];
let receptorFadeAt = -1;

function opticEntry(id) {
  let e = opticAnim.get(id);
  if (!e) {
    e = { pop: makeSpring(0.62, 30), sel: makeSpring(0, 26) };
    e.pop.target = 1;
    opticAnim.set(id, e);
  }
  return e;
}

function receptorEntry(id) {
  let s = receptorAnim.get(id);
  if (!s) {
    s = makeSpring(0, 22);
    receptorAnim.set(id, s);
  }
  return s;
}

function syncAnimTargets() {
  const seen = new Set();
  for (const o of state.optics) {
    seen.add(o.id);
    const e = opticEntry(o.id);
    e.sel.target = o.id === state.selectedId ? 1 : 0;
  }
  for (const [id, e] of opticAnim) {
    if (!seen.has(id)) {
      dropSpring(e.pop);
      dropSpring(e.sel);
      opticAnim.delete(id);
    }
  }
  const fading = receptorFadeAt >= 0 && state.time >= receptorFadeAt;
  const recs = (state.trace && state.trace.receptors) || [];
  for (const r of recs) {
    const s = receptorEntry(r.id);
    if (fading) {
      s.target = 0;
    } else {
      const grazing = Math.min(1, (r.litIntensity || 0) / 0.06);
      s.target = r.satisfied ? 1 : Math.min(0.55, grazing * 0.55);
    }
  }
}

function stepAnim(dt) {
  for (const s of springs) s.step(dt);
  for (let i = burstQueue.length - 1; i >= 0; i -= 1) {
    const q = burstQueue[i];
    if (state.time >= q.at) {
      bursts.push({ x: q.x, y: q.y, color: q.color, age: 0 });
      burstQueue.splice(i, 1);
    }
  }
  for (let i = bursts.length - 1; i >= 0; i -= 1) {
    const b = bursts[i];
    b.age += dt;
    if (b.age >= BURST_LIFE) bursts.splice(i, 1);
  }
}

function publishAnim() {
  const optics = {};
  for (const [id, e] of opticAnim) optics[id] = { pop: e.pop.value, sel: e.sel.value };
  const receptors = {};
  for (const [id, s] of receptorAnim) receptors[id] = s.value;
  state.anim.optics = optics;
  state.anim.receptors = receptors;
  state.anim.bursts = bursts.map((b) => {
    const t = b.age / BURST_LIFE;
    return { x: b.x, y: b.y, color: b.color, r: t * BURST_RADIUS, alpha: (1 - t) * 0.5 };
  });
}

function spawnBurst() {
  const level = state.level;
  const recs = (state.trace && state.trace.receptors) || [];
  burstQueue = [];
  for (const r of recs) {
    if (!r.satisfied) continue;
    const def = (level.receptors || []).find((d) => d.color === r.color) || { x: 500, y: 500 };
    for (let i = 0; i < BURST_RINGS; i += 1) {
      burstQueue.push({
        x: def.x,
        y: def.y,
        color: r.color,
        at: state.time + i * BURST_STAGGER,
      });
    }
  }
  receptorFadeAt = state.time + RECEPTOR_FADE_DELAY;
}

function makeViewProj(cssW, cssH) {
  const t = boardToPixel(cssW, cssH);
  const m = new Float32Array(16);
  m[0] = (2 * t.scale) / cssW;
  m[5] = (-2 * t.scale) / cssH;
  m[10] = 1;
  m[12] = (2 * t.ox) / cssW - 1;
  m[13] = 1 - (2 * t.oy) / cssH;
  m[15] = 1;
  return m;
}

function boot() {
  const canvas = document.getElementById('board');
  const gl = initGL(canvas);

  let pipeline = createPipeline(gl);
  let beams = createBeamRenderer(gl);
  let board = createBoardRenderer(gl);
  let contextLost = false;

  pipeline.setParams(POST_PARAMS);

  const audioInit = pick(audio, 'initAudio', 'init', 'createAudio', 'setup');
  const audioPlay = pick(audio, 'play', 'playSound', 'trigger');
  const audioEnable = pick(audio, 'setEnabled', 'setMuted', 'enable');
  const audioResume = pick(audio, 'resume', 'unlock');
  call(audioInit);
  call(audioEnable, state.sound);

  call(pick(hud, 'initHud', 'init', 'createHud', 'mount'));
  call(pick(modals, 'initModals', 'init', 'createModals', 'mount'));
  call(pick(cursors, 'initCursors', 'init', 'createCursors', 'mount'), canvas);
  let suppressAutoModal = false;
  const showModal = pick(modals, 'show', 'showModal', 'open');
  const hideModal = pick(modals, 'hide', 'hideModal', 'close');
  const setHudCursorPos = pick(cursors, 'setPosition', 'setCursorPosition', 'moveCursor');
  const setRemoteCursors = pick(cursors, 'setPlayers', 'setRemote', 'updatePlayers');

  const dockEl = document.getElementById('dock') || document;
  const input = createInput(canvas, { dock: dockEl });

  let room = null;

  function broadcast(op) {
    if (room && state.mode === 'multi') room.broadcast(op);
  }

  on('optic:add', (o) => {
    opticEntry(o.id);
    call(audioPlay, 'place');
    broadcast({ type: 'add', optic: { ...o } });
  });
  on('optic:remove', (o) => {
    call(audioPlay, 'pick');
    broadcast({ type: 'remove', id: o.id });
  });
  on('optic:move', (o) => broadcast({ type: 'update', optic: { ...o } }));
  on('optic:rotate', (o) => broadcast({ type: 'update', optic: { ...o } }));
  on('select', (id) => {
    if (id) call(audioPlay, 'ui_click');
  });
  on('invalid', () => call(audioPlay, 'error'));
  on('sound', (v) => {
    call(audioEnable, v);
    call(audioPlay, 'ui_switch');
  });
  on('level', () => {
    call(audioPlay, 'beam_on');
    opticAnim.clear();
    receptorAnim.clear();
    bursts = [];
    burstQueue = [];
    receptorFadeAt = -1;
    for (const s of Array.from(springs)) dropSpring(s);
  });
  on('solved', () => {
    call(audioPlay, 'receptor');
    spawnBurst();
    // The capture harness composes solved boards deliberately and needs to photograph the
    // lit board itself; it asks for the panel explicitly via REFRACT.showModal('solved').
    if (!suppressAutoModal) setTimeout(() => call(showModal, 'solved'), 750);
  });
  on('unsolved', () => {
    receptorFadeAt = -1;
    bursts = [];
    burstQueue = [];
  });
  on('cursor', (c) => {
    if (room && state.mode === 'multi') room.setCursor(c.x, c.y);
  });
  on('multiplayer:request', async (req) => {
    await startMultiplayer(req && req.roomId, req && req.name);
  });
  on('level:request', (index) => setLevel(index));
  on('net:op', (op) => applyRemote(op));
  on('net:players', (players) => {
    setPlayers(players);
    call(setRemoteCursors, players);
  });

  async function startMultiplayer(roomId, name) {
    if (room) {
      room.leave();
      room = null;
    }
    const id = roomId || 'lobby';
    const who = name || state.me.name || 'PLAYER';
    room = await net.joinRoom(id, who);
    setMode('multi', id);
    setPlayer(state.me.id || `p${Math.floor(Math.random() * 1e6)}`, who, state.me.color);
    return room;
  }

  const gestureUnlock = () => {
    call(audioResume);
    window.removeEventListener('pointerdown', gestureUnlock);
    window.removeEventListener('keydown', gestureUnlock);
  };
  window.addEventListener('pointerdown', gestureUnlock);
  window.addEventListener('keydown', gestureUnlock);

  document.addEventListener('visibilitychange', () => {
    state.paused = document.hidden;
    if (!document.hidden) last = performance.now() / 1000;
  });

  canvas.addEventListener('webglcontextlost', (ev) => {
    ev.preventDefault();
    contextLost = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    pipeline = createPipeline(gl);
    beams = createBeamRenderer(gl);
    board = createBoardRenderer(gl);
    pipeline.setParams(POST_PARAMS);
    contextLost = false;
    runTrace(true);
    beams.upload(state.trace.segments);
  });

  let acc = 0;
  let last = performance.now() / 1000;
  let fpsAvg = 60;
  const frameWaiters = [];

  function frame(nowMs) {
    requestAnimationFrame(frame);
    const now = nowMs / 1000;
    let dt = now - last;
    last = now;
    if (dt > MAX_FRAME) dt = MAX_FRAME;
    if (dt > 0) fpsAvg = fpsAvg * 0.9 + (1 / dt) * 0.1;
    if (state.paused || contextLost) return;

    state.time += dt;
    if (isTraceDirty()) {
      runTrace();
      beams.upload(state.trace.segments);
    }

    syncAnimTargets();
    acc += dt;
    let steps = 0;
    while (acc >= FIXED_STEP && steps < 64) {
      stepAnim(FIXED_STEP);
      acc -= FIXED_STEP;
      steps += 1;
    }
    publishAnim();

    const size = resize(gl, canvas);
    const cssW = size.w / size.dpr;
    const cssH = size.h / size.dpr;
    const viewProj = makeViewProj(cssW, cssH);

    pipeline.begin(size.w, size.h);
    board.draw(gl, state.level, state.optics, state, state.time);
    beams.draw(gl, viewProj, state.time);
    pipeline.end();

    const pending = frameWaiters.splice(0, frameWaiters.length);
    for (const w of pending) {
      w.n -= 1;
      if (w.n > 0) frameWaiters.push(w);
      else w.resolve();
    }
  }

  function frames(n) {
    return new Promise((resolve) => {
      frameWaiters.push({ n: Math.max(1, n | 0), resolve });
    });
  }

  async function settle() {
    for (let i = 0; i < 300; i += 1) {
      let rest = true;
      for (const s of springs) {
        if (!s.atRest()) {
          rest = false;
          break;
        }
      }
      if (rest && bursts.length === 0 && burstQueue.length === 0 && !isTraceDirty()) break;
      await frames(1);
    }
    await frames(2);
  }

  function solutionFor(level) {
    const fn = pick(solver, 'solveLevel', 'solve', 'findSolution');
    if (!fn) return [];
    const result = fn(level);
    if (!result) return [];
    if (Array.isArray(result)) return result;
    return result.optics || result.solution || [];
  }

  function levelIndexWhere(predicate) {
    const i = LEVELS.findIndex(predicate);
    return i < 0 ? 0 : i;
  }

  // Same, but reports a miss so callers can fall back to a looser predicate.
  function findLevelIndex(predicate) {
    const i = LEVELS.findIndex(predicate);
    return i < 0 ? null : i;
  }

  function placeAll(list) {
    const ids = [];
    for (const o of list) {
      const id = addOptic({ type: o.type, x: o.x, y: o.y, angle: o.angle, force: true });
      if (id) ids.push(id);
    }
    return ids;
  }

  async function script(name) {
    call(hideModal);
    suppressAutoModal = true;
    call(pick(modals, 'setAutoOpen'), false);
    if (name === 'protractor') {
      setLevel(levelIndexWhere((l) => (l.inventory && l.inventory.mirror) > 0));
      clearOptics();
      const id = addOptic({ type: 'mirror', x: 500, y: 500, angle: Math.PI / 4, force: true });
      selectOptic(id);
      setDrag(true);
      await settle();
      return;
    }
    if (name === 'multiplayer') {
      setPlayers({
        r1: { name: 'NAREK', color: '#F2A03D', cursor: { x: 320, y: 400 } },
        r2: { name: 'ALEKS', color: '#3DD68C', cursor: { x: 640, y: 250 } },
        r3: { name: 'MAJA', color: '#E0507A', cursor: { x: 480, y: 720 } },
      });
      call(setRemoteCursors, state.players);
      await settle();
      return;
    }
    // 'dispersion' wants the richest prism board we have, with its FULL solution placed so
    // a real fan is actually in flight. Placing solution.length - 1 optics silently yielded
    // an empty board on a par-1 level, which cost a whole round of blind judging.
    const hasPrism = (l) => (l.inventory && l.inventory.prism > 0)
      || (l.fixed || []).some((o) => o.type === 'prism')
      || (l.solution || []).some((o) => o.type === 'prism');
    const index = name === 'dispersion'
      ? (findLevelIndex((l) => hasPrism(l) && l.par >= 3)
        ?? findLevelIndex((l) => hasPrism(l) && l.par >= 2)
        ?? levelIndexWhere(hasPrism))
      : levelIndexWhere((l) => (l.inventory && l.inventory.mirror) >= 3);
    setLevel(name === 'solved' ? levelIndexWhere((l) => l.par >= 3) : index);
    clearOptics();
    const solution = solutionFor(state.level);
    if (name === 'solved' || name === 'dispersion') {
      placeAll(solution);
      selectOptic(null);
    } else {
      const ids = placeAll(solution);
      selectOptic(ids[ids.length - 1] || null);
      setDrag(true);
    }
    await settle();
  }

  function setDrag(on_) {
    if (!on_) {
      setDragging(null);
      return;
    }
    const optic = state.optics.find((o) => o.id === state.selectedId);
    if (!optic) return;
    setDragging({
      kind: 'rotate',
      id: optic.id,
      type: optic.type,
      x: optic.x,
      y: optic.y,
      angle: optic.angle,
      valid: true,
    });
  }

  let resolveReady;
  const ready = new Promise((res) => {
    resolveReady = res;
  });

  window.REFRACT = {
    ready,
    setLevel(index) {
      setLevel(index);
    },
    clearOptics() {
      clearOptics();
    },
    place(o) {
      return addOptic({ type: o.type, x: o.x, y: o.y, angle: o.angle || 0, force: true });
    },
    select(id) {
      selectOptic(id);
    },
    setDrag,
    setCursor(x, y) {
      setCursor(x, y);
    },
    setHudCursor(px, py) {
      call(setHudCursorPos, px, py);
    },
    solvedNow() {
      return state.solved;
    },
    showModal(name) {
      if (!name) {
        suppressAutoModal = false;
        call(pick(modals, 'setAutoOpen'), true);
      }
      if (name) call(showModal, name);
      else call(hideModal);
    },
    state,
    frames,
    settle,
    script,
    get fps() {
      return fpsAvg;
    },
    removeOptic,
    reset,
    startMultiplayer,
    emit,
    input,
  };

  setLevel(state.progress.lastLevel || 0);
  runTrace(true);
  beams.upload(state.trace.segments);
  requestAnimationFrame(frame);
  frames(2).then(() => resolveReady());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
