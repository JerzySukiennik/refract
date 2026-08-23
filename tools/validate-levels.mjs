// Dev-only: prove every level's embedded solution really solves it, then hunt for shortcuts.
//
// Order of checks, per ARCHITECTURE.md section 12:
//   a  the embedded `solution` solves the level, traced exactly
//   b  the solution fits the inventory, is player-reachable, and par === solution.length
//   c  a search for anything SHORTER than par; finding one is a design defect
//   d  a search that runs out of budget is NOT a failure, only "par unconfirmed"
//   e  geometry sanity
//   f  the capture path: the lookup `main.js` uses to build a scripted board returns the
//      same non-empty, actually-solving placement on every one of 100 consecutive calls
// The exit code is non-zero for a, b, c, e and f only.

import { LEVELS } from '../js/levels.js';
import { solve, solveLevel, solutionFor } from '../js/solver.js';
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
const PLACE_SNAP = 25;          // js/input.js snaps placement to this
const ANGLE_SNAP = 5;           // ...and rotation to this many degrees
const OPTIC_GAP = 86;
const VALID_COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'violet'];

// Measured by the optics builder: the shortest prism-to-receptor run at which each colour
// can actually be satisfied. Informational only — the exact trace in check (a) is the real
// authority, and a receptor fed through a mirror travels further than the straight line.
const MIN_PRISM_RUN = {
  violet: 275, blue: 250, cyan: 400, green: 375, yellow: 725, orange: 625, red: 550,
};

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
// Per-level budget for the hunt for a solution SHORTER than par. It has to be large enough
// that the deepest board exhausts its own search space rather than running out the clock:
// "no shortcut found" and "no shortcut exists in the searched space" are different claims,
// and only the second one confirms a par. The worst case today is 23 THE LONG WAY DOWN, the
// only par-5 level, which exhausts at ~32 s; 45 s leaves headroom without dragging the run out.
const budget = Number(flag('budget', 45000));
const only = flag('level', null);
const quiet = args.includes('--quiet');
// (f) How many times each level's capture-path lookup is repeated. `solver.solve` used to
// fall through to a wall-clock-budgeted heuristic search whenever its read of the embedded
// solution was rejected, and that search returns an empty placement on 18 of the 24 boards
// — which is how `script('folding')` and `script('solved')` intermittently captured empty
// boards. This check exists so that regression cannot come back unnoticed.
const reps = Number(flag('reps', 100));

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

function onGrid(v) {
  return Math.abs(v / PLACE_SNAP - Math.round(v / PLACE_SNAP)) < 1e-6;
}

function onAngleGrid(a) {
  const deg = (a * 180) / Math.PI;
  return Math.abs(deg / ANGLE_SNAP - Math.round(deg / ANGLE_SNAP)) < 1e-6;
}

// (e) Geometry sanity: nothing buried in a wall, no border walls hand-written into the
// level, every optic on the grid a player can actually reach, receptors far enough apart.
function geometryProblems(level) {
  const bad = [];
  const size = level.boardSize || BOARD;
  const t = level.wallThickness || WALL;

  (level.walls || []).forEach((w, i) => {
    if (w.x < t || w.y < t || w.x + w.w > size - t || w.y + w.h > size - t) {
      bad.push(`wall ${i} (${w.x}, ${w.y}, ${w.w}x${w.h}) overlaps the border ring; walls are interior only`);
    }
    if (w.w <= 0 || w.h <= 0) bad.push(`wall ${i} has a non-positive size`);
  });

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

  const placed = (level.fixed || []).concat(level.solution || []);
  placed.forEach((o, i) => {
    const label = i < (level.fixed || []).length ? `fixed ${o.type} ${i}` : `solution ${o.type} ${i - (level.fixed || []).length}`;
    const reach = o.type === 'prism' ? PRISM_RADIUS : MIRROR_HALF;
    const c = clearanceToWalls(level, o.x, o.y);
    if (c < reach) {
      bad.push(`${label} at ${o.x}, ${o.y} intersects a wall (clearance ${c.toFixed(0)})`);
    }
    if (!onGrid(o.x) || !onGrid(o.y)) {
      bad.push(`${label} at ${o.x}, ${o.y} is off the ${PLACE_SNAP}-unit placement grid`);
    }
    if (!onAngleGrid(o.angle)) {
      bad.push(`${label} angle ${(o.angle * 180 / Math.PI).toFixed(1)} is off the ${ANGLE_SNAP} degree rotation grid`);
    }
    level.receptors.forEach((r, j) => {
      if (Math.hypot(o.x - r.x, o.y - r.y) < reach + RECEPTOR_RADIUS) {
        bad.push(`${label} overlaps receptor ${j}`);
      }
    });
    for (let j = i + 1; j < placed.length; j++) {
      if (Math.hypot(o.x - placed[j].x, o.y - placed[j].y) < OPTIC_GAP) {
        bad.push(`${label} sits closer than ${OPTIC_GAP} units to another optic`);
      }
    }
  });

  const inv = level.inventory || {};
  const stock = (inv.mirror || 0) + (inv.prism || 0);
  if (level.par > stock) {
    bad.push(`par ${level.par} exceeds the inventory of ${stock}`);
  }
  if (!level.hint || level.hint.length < 8) bad.push('hint is missing or too short');
  if (!level.name || level.name !== level.name.toUpperCase()) bad.push('name must be uppercase');

  const gridOff = [];
  level.receptors.forEach((r, i) => {
    if (!onGrid(r.x) || !onGrid(r.y)) gridOff.push(`receptor ${i}`);
  });
  if (gridOff.length) bad.push(`off the ${PLACE_SNAP}-unit grid: ${gridOff.join(', ')}`);

  return bad;
}

function inventoryProblems(level, optics) {
  const inv = level.inventory || {};
  let mirror = 0;
  let prism = 0;
  for (const o of optics) {
    if (o.type === 'mirror') mirror++;
    else if (o.type === 'prism') prism++;
    else return [`unknown optic type "${o.type}"`];
  }
  const bad = [];
  if (mirror > (inv.mirror || 0)) bad.push(`solution uses ${mirror} mirrors, inventory holds ${inv.mirror || 0}`);
  if (prism > (inv.prism || 0)) bad.push(`solution uses ${prism} prisms, inventory holds ${inv.prism || 0}`);
  return bad;
}

function placementSignature(optics) {
  return optics
    .map((o) => `${o.type}@${o.x},${o.y}/${(o.angle * 180 / Math.PI).toFixed(3)}`)
    .join(' + ');
}

// (f) The capture path, exercised exactly as the game exercises it.
//
// `main.js` resolves its scripted-scene lookup with `pick(solver, 'solveLevel', 'solve',
// 'findSolution')` and treats an empty return as "place nothing", which is what an empty
// screenshot is. So this asserts on `solveLevel` itself, `reps` times in a row, and
// interleaves a trace of a DIFFERENT level between calls: the tracer keeps its scene in
// module-level typed arrays, so a lookup that depended on leftover state would show up
// here as a placement that changes between identical calls.
function lookupProblems(level, otherLevel) {
  const bad = [];
  let signature = null;
  for (let i = 0; i < reps; i++) {
    if (otherLevel) traceScene(otherLevel, solutionFor(otherLevel), {});
    const optics = solveLevel(level);
    if (!Array.isArray(optics) || optics.length === 0) {
      bad.push(`capture lookup returned an empty placement on call ${i + 1} of ${reps}`);
      break;
    }
    const sig = placementSignature(optics);
    if (signature === null) signature = sig;
    else if (sig !== signature) {
      bad.push(`capture lookup is not deterministic: call ${i + 1} returned ${sig}, call 1 returned ${signature}`);
      break;
    }
    const res = traceScene(level, optics, {});
    if (!res.solved) {
      const missed = res.receptors.filter((r) => !r.satisfied).map((r) => r.color).join(', ');
      bad.push(`capture lookup returned a placement that does not solve the board on call ${i + 1} (unsatisfied: ${missed})`);
      break;
    }
  }
  return bad;
}

// Informational: how far each receptor sits from the nearest prism in the solution.
function prismRunNotes(level) {
  const prisms = (level.fixed || []).concat(level.solution || []).filter((o) => o.type === 'prism');
  if (!prisms.length) return [];
  const notes = [];
  for (const r of level.receptors) {
    let best = Infinity;
    for (const p of prisms) best = Math.min(best, Math.hypot(p.x - r.x, p.y - r.y));
    const need = MIN_PRISM_RUN[r.color];
    if (need && best < need) {
      notes.push(`${r.color} receptor sits ${best.toFixed(0)} u from the nearest prism, under the ${need} u guideline`);
    }
  }
  return notes;
}

const rows = [];
let failures = 0;

for (const level of LEVELS) {
  if (only && String(level.id) !== only) continue;

  const problems = [];
  const notes = [];

  // (e) geometry first, because a broken board makes every other message noise.
  problems.push(...geometryProblems(level));

  // (a) the embedded solution is the authority.
  const solution = level.solution;
  let solutionOk = false;
  if (!Array.isArray(solution)) {
    problems.push('level has no `solution` array; ARCHITECTURE.md section 12 requires one');
  } else {
    const res = traceScene(level, solution, {});
    solutionOk = res.solved;
    if (!res.solved) {
      const missed = res.receptors
        .filter((r) => !r.satisfied)
        .map((r) => `${r.color} (lit ${r.litIntensity.toFixed(4)}, stray ${r.strayIntensity.toFixed(4)})`);
      problems.push(`the embedded solution does not solve the level; unsatisfied: ${missed.join(', ')}`);
    }

    // (b) it has to be a solution a player could actually build.
    problems.push(...inventoryProblems(level, solution));
    if (level.par !== solution.length) {
      problems.push(`par ${level.par} does not match the ${solution.length}-optic solution`);
    }
  }

  // (f) the capture path.
  const other = LEVELS[(LEVELS.indexOf(level) + 7) % LEVELS.length];
  const lookupBad = lookupProblems(level, other === level ? null : other);
  problems.push(...lookupBad);

  notes.push(...prismRunNotes(level));

  // (c) + (d) hunt for something shorter than par.
  let shorter = null;
  let searchState = 'confirmed';
  let ms = 0;
  let nodes = 0;
  if (level.par > 1) {
    const t0 = Date.now();
    const found = solve(level, { maxOptics: level.par - 1, timeBudgetMs: budget });
    ms = Date.now() - t0;
    nodes = found.nodesExplored;
    if (found.solved) {
      const verify = traceScene(level, found.optics, {});
      if (verify.solved) {
        shorter = found.optics;
        searchState = 'shortcut';
        problems.push(
          `par ${level.par} is too high; a ${found.optics.length}-optic solution exists: `
          + found.optics.map((o) => `${o.type}@${Math.round(o.x)},${Math.round(o.y)}/${Math.round(o.angle * 180 / Math.PI)}`).join(' + '),
        );
      } else {
        notes.push('solver reported a shortcut the tracer rejects; ignored');
      }
    } else if (found.timedOut) {
      searchState = 'unconfirmed';
      notes.push(`par unconfirmed: the shortcut search ran out of its ${budget} ms budget`);
    }
  }

  if (problems.length) failures++;
  rows.push({
    id: level.id,
    name: level.name,
    par: level.par,
    sol: solution ? solution.length : '-',
    ok: solutionOk,
    lookupOk: lookupBad.length === 0,
    searchState,
    nodes,
    ms,
    problems,
    notes,
  });
}

const pad = (v, n) => String(v).padEnd(n);
const padL = (v, n) => String(v).padStart(n);
const STATE_LABEL = { confirmed: 'par confirmed', unconfirmed: 'par unconfirmed', shortcut: 'SHORTCUT' };

console.log('');
console.log(`${pad('ID', 4)}${pad('LEVEL', 22)}${padL('PAR', 4)}${padL('SOL', 5)}${padL('SOLVES', 8)}${padL('LOOKUP', 9)}${padL('NODES', 9)}${padL('TIME', 8)}  PAR CHECK`);
console.log('-'.repeat(93));
for (const r of rows) {
  console.log(
    `${pad(r.id, 4)}${pad(r.name, 22)}${padL(r.par, 4)}${padL(r.sol, 5)}${padL(r.ok ? 'yes' : 'NO', 8)}`
    + `${padL(r.lookupOk ? `${reps}/${reps}` : 'FAILED', 9)}${padL(r.nodes, 9)}${padL(r.ms + 'ms', 8)}  ${STATE_LABEL[r.searchState]}`,
  );
  if (!quiet) for (const n of r.notes) console.log(`${' '.repeat(10)}note - ${n}`);
  for (const p of r.problems) console.log(`${' '.repeat(10)}FAIL - ${p}`);
}
console.log('-'.repeat(93));
const lookupClean = rows.filter((r) => r.lookupOk).length;
console.log(`capture-path lookup: ${lookupClean}/${rows.length} levels returned the same solving placement on all ${reps} calls`);
const unconfirmed = rows.filter((r) => r.searchState === 'unconfirmed').length;
console.log(`${rows.length - failures}/${rows.length} levels clean` + (unconfirmed ? `, ${unconfirmed} with par unconfirmed` : ''));
console.log('');

process.exit(failures ? 1 : 0);
