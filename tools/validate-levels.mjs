// Dev-only: run the solver over every level and assert the board data is sane and the pars are honest.

import { LEVELS } from '../js/levels.js';
import { solve } from '../js/solver.js';
import { traceScene } from '../js/optics/trace.js';

// Kept local on purpose: the tracer owns these numbers, the validator only needs a
// conservative copy so a level that looks tight here is comfortable in the real game.
const BOARD = 1000;
const WALL = 40;
const RECEPTOR_RADIUS = 22;
const MIRROR_HALF = 55;
const PRISM_RADIUS = 75 / Math.sqrt(3);
const BEAM_HALF = 8;
const MIN_EMITTER_RUN = 120;
const VALID_COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'violet'];

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const budget = Number(flag('budget', 36000));
const only = flag('level', null);

function ringWalls(level) {
  const size = level.boardSize || BOARD;
  const t = level.wallThickness || WALL;
  return [
    { x: 0, y: 0, w: size, h: t },
    { x: 0, y: size - t, w: size, h: t },
    { x: 0, y: t, w: t, h: size - 2 * t },
    { x: size - t, y: t, w: t, h: size - 2 * t },
  ];
}

function allWalls(level) {
  return ringWalls(level).concat(level.walls || []);
}

function clearanceToWalls(level, x, y) {
  let best = Infinity;
  for (const w of allWalls(level)) {
    const dx = Math.max(w.x - x, 0, x - (w.x + w.w));
    const dy = Math.max(w.y - y, 0, y - (w.y + w.h));
    const d = Math.hypot(dx, dy);
    if (d < best) best = d;
  }
  return best;
}

function emitterRun(level) {
  const e = level.emitter;
  const dx = Math.cos(e.dir);
  const dy = Math.sin(e.dir);
  let best = Infinity;
  for (const w of allWalls(level)) {
    let tMin = -Infinity;
    let tMax = Infinity;
    if (Math.abs(dx) < 1e-9) {
      if (e.x < w.x || e.x > w.x + w.w) continue;
    } else {
      let t0 = (w.x - e.x) / dx;
      let t1 = (w.x + w.w - e.x) / dx;
      if (t0 > t1) { const tt = t0; t0 = t1; t1 = tt; }
      tMin = Math.max(tMin, t0);
      tMax = Math.min(tMax, t1);
    }
    if (Math.abs(dy) < 1e-9) {
      if (e.y < w.y || e.y > w.y + w.h) continue;
    } else {
      let t0 = (w.y - e.y) / dy;
      let t1 = (w.y + w.h - e.y) / dy;
      if (t0 > t1) { const tt = t0; t0 = t1; t1 = tt; }
      tMin = Math.max(tMin, t0);
      tMax = Math.min(tMax, t1);
    }
    if (tMax < tMin) continue;
    const t = tMin > 1e-4 ? tMin : tMax;
    if (t > 1e-4 && t < best) best = t;
  }
  return best;
}

function geometryProblems(level) {
  const bad = [];
  const size = level.boardSize || BOARD;
  const t = level.wallThickness || WALL;

  const e = level.emitter;
  if (e.x < t || e.x > size - t || e.y < t || e.y > size - t) {
    bad.push(`emitter (${e.x}, ${e.y}) is not inside the play area`);
  }
  if (clearanceToWalls(level, e.x, e.y) < 8) {
    bad.push(`emitter (${e.x}, ${e.y}) is buried in a wall`);
  }
  const run = emitterRun(level);
  if (!(run >= MIN_EMITTER_RUN)) {
    bad.push(`emitter beam dies after ${run.toFixed(0)} units; it never enters the board`);
  }

  level.receptors.forEach((r, i) => {
    if (!VALID_COLORS.includes(r.color)) bad.push(`receptor ${i} has unknown colour "${r.color}"`);
    const c = clearanceToWalls(level, r.x, r.y);
    if (c < RECEPTOR_RADIUS + BEAM_HALF) {
      bad.push(`receptor ${i} (${r.color}) at ${r.x}, ${r.y} is embedded in a wall (clearance ${c.toFixed(0)})`);
    }
    for (let j = i + 1; j < level.receptors.length; j++) {
      const o = level.receptors[j];
      const d = Math.hypot(r.x - o.x, r.y - o.y);
      if (d < 2 * (RECEPTOR_RADIUS + BEAM_HALF)) {
        bad.push(`receptors ${i} and ${j} overlap (${d.toFixed(0)} units apart)`);
      }
    }
  });

  (level.fixed || []).forEach((o, i) => {
    const reach = o.type === 'prism' ? PRISM_RADIUS : MIRROR_HALF;
    const c = clearanceToWalls(level, o.x, o.y);
    if (c < reach) {
      bad.push(`fixed ${o.type} ${i} at ${o.x}, ${o.y} intersects a wall (clearance ${c.toFixed(0)})`);
    }
    level.receptors.forEach((r, j) => {
      if (Math.hypot(o.x - r.x, o.y - r.y) < reach + RECEPTOR_RADIUS) {
        bad.push(`fixed ${o.type} ${i} overlaps receptor ${j}`);
      }
    });
  });

  const inv = level.inventory || {};
  const stock = (inv.mirror || 0) + (inv.prism || 0);
  if (level.par > stock) {
    bad.push(`par ${level.par} exceeds the inventory of ${stock}`);
  }
  if (!level.hint || level.hint.length < 8) bad.push('hint is missing or too short');
  if (!level.name || level.name !== level.name.toUpperCase()) bad.push('name must be uppercase');

  const gridOff = [];
  (level.fixed || []).forEach((o, i) => {
    if (o.x % 25 !== 0 || o.y % 25 !== 0) gridOff.push(`fixed ${i}`);
  });
  level.receptors.forEach((r, i) => {
    if (r.x % 25 !== 0 || r.y % 25 !== 0) gridOff.push(`receptor ${i}`);
  });
  if (gridOff.length) bad.push(`off the 25-unit grid: ${gridOff.join(', ')}`);

  return bad;
}

function withinInventory(level, optics) {
  const inv = level.inventory || {};
  let mirror = 0;
  let prism = 0;
  for (const o of optics) {
    if (o.type === 'mirror') mirror++;
    else prism++;
  }
  return mirror <= (inv.mirror || 0) && prism <= (inv.prism || 0);
}

const rows = [];
let failures = 0;

for (const level of LEVELS) {
  if (only && String(level.id) !== only) continue;

  const problems = geometryProblems(level);
  const t0 = Date.now();
  const result = solve(level, { maxOptics: level.par, timeBudgetMs: budget });
  const ms = Date.now() - t0;

  let best = null;
  if (result.solved) {
    best = result.optics.length;
    const verify = traceScene(level, result.optics, {});
    if (!verify.solved) problems.push('solver returned a solution the tracer does not accept');
    if (!withinInventory(level, result.optics)) problems.push('solver solution exceeds the inventory');
    if (best < level.par) problems.push(`par ${level.par} is too high; a ${best}-optic solution exists`);
    if (best > level.par) problems.push(`solver needed ${best} optics against par ${level.par}`);
  } else {
    problems.push(`no solution found within ${budget} ms and ${level.par} optics`);
  }

  if (problems.length) failures++;
  rows.push({
    id: level.id,
    name: level.name,
    par: level.par,
    best: best === null ? '-' : best,
    nodes: result.nodesExplored,
    ms,
    problems,
  });
}

const pad = (v, n) => String(v).padEnd(n);
const padL = (v, n) => String(v).padStart(n);

console.log('');
console.log(`${pad('ID', 4)}${pad('LEVEL', 24)}${padL('PAR', 4)}${padL('SOLVER', 8)}${padL('NODES', 9)}${padL('TIME', 9)}  STATUS`);
console.log('-'.repeat(80));
for (const r of rows) {
  const status = r.problems.length ? 'FAIL' : 'ok';
  console.log(`${pad(r.id, 4)}${pad(r.name, 24)}${padL(r.par, 4)}${padL(r.best, 8)}${padL(r.nodes, 9)}${padL(r.ms + 'ms', 9)}  ${status}`);
  for (const p of r.problems) console.log(`${' '.repeat(58)}  - ${p}`);
}
console.log('-'.repeat(80));
console.log(`${rows.length - failures}/${rows.length} levels clean`);
console.log('');

process.exit(failures ? 1 : 0);
