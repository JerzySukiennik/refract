// Iterative-deepening search that finds a real solution for a level, plus the progressive hint engine.

import { traceScene } from './optics/trace.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const SNAP = 5 * DEG;
const BOARD = 1000;
const WALL = 40;

const COARSE = 50;
const FINE = 25;
const OPTIC_GAP = 86;
const WALL_PAD = 34;
const EMITTER_GAP = 74;
const MIN_RUN = 96;
const MIN_ONWARD = 130;
const RECEPTOR_THRESHOLD = 0.06;

const BEAM_WIDTH = 96;
const CANDIDATES_PER_NODE = 120;
const CHILDREN_PER_PARENT = 2;
const MAX_SOURCE_SEGMENTS = 7;

// The prism only produces a clean fan across a narrow band of incidence; outside it the
// short wavelengths total-internally-reflect and the fan falls apart. Offsets are relative
// to the incoming bearing, modulo the triangle's 120 degree symmetry.
const PRISM_OFFSETS = [45, 50, 55, 65, 70, 75];
const PRISM_DEVIATION = 47 * DEG;

// Three heuristic weightings, tried in turn. A single scoring function either chases the
// receptors too early or wanders along the walls forever; running a short search under each
// costs little and covers both kinds of board.
const PROFILES = [
  { prox: 0.10, colourReach: 0.10, whiteReach: 0.02 },
  { prox: 0.02, colourReach: 0.22, whiteReach: 0.06 },
  { prox: 0.24, colourReach: 0.04, whiteReach: 0.00 },
];

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const norm = (a) => ((a % TAU) + TAU) % TAU;
const snapAngle = (a) => norm(Math.round(norm(a) / SNAP) * SNAP);

function distToSegment(px, py, ax, ay, bx, by) {
  const ex = bx - ax;
  const ey = by - ay;
  const len2 = ex * ex + ey * ey;
  let u = 0;
  if (len2 > 1e-9) u = ((px - ax) * ex + (py - ay) * ey) / len2;
  if (u < 0) u = 0;
  else if (u > 1) u = 1;
  return Math.hypot(px - (ax + ex * u), py - (ay + ey * u));
}

function boardWalls(level) {
  const size = level.boardSize || BOARD;
  const t = level.wallThickness || WALL;
  const ring = [
    { x: 0, y: 0, w: size, h: t },
    { x: 0, y: size - t, w: size, h: t },
    { x: 0, y: t, w: t, h: size - 2 * t },
    { x: size - t, y: t, w: t, h: size - 2 * t },
  ];
  return ring.concat(level.walls || []);
}

function interior(level) {
  const size = level.boardSize || BOARD;
  const t = level.wallThickness || WALL;
  return { lo: t + WALL_PAD, hi: size - t - WALL_PAD };
}

function nearWall(walls, x, y, pad) {
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    const dx = Math.max(w.x - x, 0, x - (w.x + w.w));
    const dy = Math.max(w.y - y, 0, y - (w.y + w.h));
    if (dx * dx + dy * dy < pad * pad) return true;
  }
  return false;
}

function shootWalls(walls, ox, oy, dx, dy) {
  let best = 4000;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    let tMin = -Infinity;
    let tMax = Infinity;
    if (Math.abs(dx) < 1e-9) {
      if (ox < w.x || ox > w.x + w.w) continue;
    } else {
      let t0 = (w.x - ox) / dx;
      let t1 = (w.x + w.w - ox) / dx;
      if (t0 > t1) { const tt = t0; t0 = t1; t1 = tt; }
      if (t0 > tMin) tMin = t0;
      if (t1 < tMax) tMax = t1;
    }
    if (Math.abs(dy) < 1e-9) {
      if (oy < w.y || oy > w.y + w.h) continue;
    } else {
      let t0 = (w.y - oy) / dy;
      let t1 = (w.y + w.h - oy) / dy;
      if (t0 > t1) { const tt = t0; t0 = t1; t1 = tt; }
      if (t0 > tMin) tMin = t0;
      if (t1 < tMax) tMax = t1;
    }
    if (tMax < tMin) continue;
    const t = tMin > 1e-4 ? tMin : tMax;
    if (t > 1e-4 && t < best) best = t;
  }
  return best;
}

function placedOptics(level, optics) {
  return (level.fixed || []).concat(optics);
}

function positionFree(level, optics, x, y, walls, bounds) {
  if (x < bounds.lo || x > bounds.hi || y < bounds.lo || y > bounds.hi) return false;
  if (nearWall(walls, x, y, WALL_PAD)) return false;
  const e = level.emitter;
  if (e && Math.hypot(x - e.x, y - e.y) < EMITTER_GAP) return false;
  const all = placedOptics(level, optics);
  for (let i = 0; i < all.length; i++) {
    if (Math.hypot(x - all[i].x, y - all[i].y) < OPTIC_GAP) return false;
  }
  const recs = level.receptors || [];
  for (let i = 0; i < recs.length; i++) {
    if (Math.hypot(x - recs[i].x, y - recs[i].y) < OPTIC_GAP) return false;
  }
  return true;
}

function sourceSegments(res) {
  const open = [];
  for (let i = 0; i < res.segments.length; i++) {
    const s = res.segments[i];
    if (s.terminal !== 'wall' && s.terminal !== 'escape' && s.terminal !== 'depth') continue;
    if (Math.hypot(s.bx - s.ax, s.by - s.ay) < MIN_RUN) continue;
    open.push(s);
  }
  open.sort((a, b) => (b.intensity - a.intensity) || (a.generation - b.generation));
  const picked = [];
  for (let i = 0; i < open.length && picked.length < MAX_SOURCE_SEGMENTS; i++) {
    const s = open[i];
    let dup = false;
    for (let j = 0; j < picked.length; j++) {
      const p = picked[j];
      if (Math.hypot(p.ax - s.ax, p.ay - s.ay) < 40 && Math.hypot(p.bx - s.bx, p.by - s.by) < 40) dup = true;
    }
    if (!dup) picked.push(s);
  }
  return picked;
}

function unsatisfied(level, res) {
  const out = [];
  res.receptors.forEach((r, i) => {
    if (!r.satisfied) out.push({ ...level.receptors[i], litIntensity: r.litIntensity });
  });
  return out;
}

// A fold is worth making if it aims at something that still needs light. Before any prism
// is in play the receptors are not targets at all — white light cannot satisfy a coloured
// receptor — so the only thing worth optimising is how far the beam still gets to travel.
function aimTargets(level, optics, res) {
  const all = placedOptics(level, optics);
  const prisms = [];
  for (let i = 0; i < all.length; i++) {
    if (all[i].type === 'prism') prisms.push({ x: all[i].x, y: all[i].y });
  }
  let colour = false;
  for (let i = 0; i < res.segments.length; i++) {
    if (res.segments[i].nm > 0) { colour = true; break; }
  }
  if (!colour) return prisms;
  return unsatisfied(level, res).map((r) => ({ x: r.x, y: r.y })).concat(prisms);
}

function scoreState(level, optics, res, w) {
  let sat = 0;
  let partial = 0;
  let prox = 0;
  let colour = 0;
  let colourReach = 0;
  let whiteReach = 0;
  for (let k = 0; k < res.segments.length; k++) {
    const s = res.segments[k];
    const len = Math.hypot(s.bx - s.ax, s.by - s.ay);
    if (s.nm > 0) {
      colour += s.intensity;
      if (len > colourReach) colourReach = len;
    } else if (len < 2000) {
      whiteReach += len;
    }
  }
  res.receptors.forEach((r, i) => {
    if (r.satisfied) { sat++; return; }
    partial += Math.min(1, r.litIntensity / RECEPTOR_THRESHOLD);
    const rec = level.receptors[i];
    let best = 1600;
    for (let k = 0; k < res.segments.length; k++) {
      const s = res.segments[k];
      if (s.intensity < 0.004) continue;
      const d = distToSegment(rec.x, rec.y, s.ax, s.ay, s.bx, s.by);
      if (d < best) best = d;
    }
    prox += best;
  });
  const hasColour = colour > 0;
  return sat * 1000
    + partial * 160
    - (hasColour ? prox * w.prox : 0)
    + Math.min(colour, 1) * 180
    + Math.min(colourReach, 1200) * w.colourReach
    + Math.min(whiteReach, 3500) * w.whiteReach
    - optics.length * 2;
}

function remainingInventory(level, optics) {
  const inv = level.inventory || {};
  let mirror = inv.mirror || 0;
  let prism = inv.prism || 0;
  for (let i = 0; i < optics.length; i++) {
    if (optics[i].type === 'mirror') mirror--;
    else prism--;
  }
  return { mirror, prism };
}

function candidates(level, optics, res, grid, walls, bounds) {
  const inv = remainingInventory(level, optics);
  const targets = aimTargets(level, optics, res);
  const sources = sourceSegments(res);
  const seen = new Set();
  const out = [];

  for (let si = 0; si < sources.length; si++) {
    const s = sources[si];
    const len = Math.hypot(s.bx - s.ax, s.by - s.ay);
    const ux = (s.bx - s.ax) / len;
    const uy = (s.by - s.ay) / len;
    const inBearing = Math.atan2(uy, ux);
    const steps = Math.max(1, Math.floor((len - MIN_RUN) / grid));
    for (let k = 0; k <= steps; k++) {
      const t = MIN_RUN + k * grid;
      if (t > len - 8) break;
      const px = Math.round((s.ax + ux * t) / grid) * grid;
      const py = Math.round((s.ay + uy * t) / grid) * grid;
      const key = px + ':' + py;
      if (seen.has(key)) continue;
      seen.add(key);
      if (distToSegment(px, py, s.ax, s.ay, s.bx, s.by) > grid) continue;
      if (!positionFree(level, optics, px, py, walls, bounds)) continue;

      if (inv.mirror > 0) {
        for (let deg = 0; deg < 180; deg += 5) {
          const a = deg * DEG;
          if (Math.abs(Math.sin(a - inBearing)) < 0.12) continue;
          const outB = norm(2 * a - inBearing);
          const odx = Math.cos(outB);
          const ody = Math.sin(outB);
          const reach = shootWalls(walls, px, py, odx, ody);
          if (reach < MIN_ONWARD) continue;
          let near = 1600;
          for (let r = 0; r < targets.length; r++) {
            const d = distToSegment(targets[r].x, targets[r].y, px, py, px + odx * reach, py + ody * reach);
            if (d < near) near = d;
          }
          out.push({ type: 'mirror', x: px, y: py, angle: a, cheap: reach * 0.35 - near * 0.5 });
        }
      }

      if (inv.prism > 0) {
        for (let oi = 0; oi < PRISM_OFFSETS.length; oi++) {
          for (let wrap = 0; wrap < 3; wrap++) {
            const off = PRISM_OFFSETS[oi] * DEG + wrap * 120 * DEG;
            const a = snapAngle(inBearing + off);
            const sign = PRISM_OFFSETS[oi] < 60 ? 1 : -1;
            const outB = inBearing + sign * PRISM_DEVIATION;
            const odx = Math.cos(outB);
            const ody = Math.sin(outB);
            const reach = shootWalls(walls, px, py, odx, ody);
            let near = 1600;
            for (let r = 0; r < targets.length; r++) {
              const d = distToSegment(targets[r].x, targets[r].y, px, py, px + odx * reach, py + ody * reach);
              if (d < near) near = d;
            }
            out.push({ type: 'prism', x: px, y: py, angle: a, cheap: reach * 0.35 - near * 0.4 + 90 });
          }
        }
      }
    }
  }

  out.sort((a, b) => b.cheap - a.cheap);
  return out;
}

function signature(optics) {
  return optics
    .map((o) => `${o.type[0]}${Math.round(o.x)},${Math.round(o.y)},${Math.round(norm(o.angle) / SNAP)}`)
    .sort()
    .join('|');
}

function searchFrom(level, prefix, options) {
  const opts = options || {};
  const inv = level.inventory || {};
  const cap = Math.min(
    opts.maxOptics === undefined ? 6 : opts.maxOptics,
    (inv.mirror || 0) + (inv.prism || 0),
  );
  const budget = opts.timeBudgetMs === undefined ? 6000 : opts.timeBudgetMs;
  const traceOpts = opts.traceOpts || {};
  const weights = opts.weights || PROFILES[0];
  const walls = boardWalls(level);
  const bounds = interior(level);
  const started = now();
  let nodes = 0;
  let timedOut = false;

  const rootRes = traceScene(level, prefix, traceOpts);
  nodes++;
  if (rootRes.solved) return { solved: true, optics: prefix.slice(), nodesExplored: nodes, timedOut: false };

  let frontier = [{ optics: prefix.slice(), res: rootRes, score: scoreState(level, prefix, rootRes, weights) }];
  const grids = [COARSE, FINE];

  for (let depth = prefix.length + 1; depth <= cap; depth++) {
    let produced = [];
    const seen = new Set();
    for (let gi = 0; gi < grids.length && produced.length === 0; gi++) {
      for (let f = 0; f < frontier.length; f++) {
        if (now() - started > budget) { timedOut = true; break; }
        const st = frontier[f];
        const cands = candidates(level, st.optics, st.res, grids[gi], walls, bounds);
        const take = Math.min(cands.length, CANDIDATES_PER_NODE);
        for (let c = 0; c < take; c++) {
          if (now() - started > budget) { timedOut = true; break; }
          const cand = cands[c];
          const next = st.optics.concat([{ type: cand.type, x: cand.x, y: cand.y, angle: cand.angle }]);
          const sig = signature(next);
          if (seen.has(sig)) continue;
          seen.add(sig);
          const res = traceScene(level, next, traceOpts);
          nodes++;
          if (res.solved) return { solved: true, optics: next, nodesExplored: nodes, timedOut: false };
          produced.push({ optics: next, res, score: scoreState(level, next, res, weights), parent: f });
        }
      }
      if (gi === 0 && produced.length > 0) break;
    }
    if (produced.length === 0) break;
    produced.sort((a, b) => b.score - a.score);

    // Keep the beam diverse: a handful of the best children from every parent first, so one
    // strong-looking opening cannot crowd out every other line, then fill on raw score.
    const perParent = new Map();
    const chosen = [];
    const width = frontier.length === 1 ? Math.max(BEAM_WIDTH, produced.length) : BEAM_WIDTH;
    for (let i = 0; i < produced.length && chosen.length < width; i++) {
      const p = produced[i].parent;
      const n = perParent.get(p) || 0;
      if (n >= CHILDREN_PER_PARENT) continue;
      perParent.set(p, n + 1);
      chosen.push(produced[i]);
    }
    for (let i = 0; i < produced.length && chosen.length < width; i++) {
      if (chosen.indexOf(produced[i]) === -1) chosen.push(produced[i]);
    }
    frontier = chosen;
    if (now() - started > budget) { timedOut = true; break; }
  }

  return { solved: false, optics: [], nodesExplored: nodes, timedOut };
}

// A level carries its author's own solution (ARCHITECTURE.md section 12), and that is a
// better answer than anything the search can find: it is exact, instant and known good.
// The search only has to run when the caller asks for something the level does not already
// carry - which is precisely the validator's hunt for a solution SHORTER than par.
function embeddedSolution(level, cap, traceOpts) {
  const sol = level && level.solution;
  if (!Array.isArray(sol) || !sol.length || sol.length > cap) return null;
  const optics = sol.map((o) => ({ type: o.type, x: o.x, y: o.y, angle: o.angle }));
  return traceScene(level, optics, traceOpts || {}).solved ? optics : null;
}

export function solve(level, options) {
  const opts = options || {};
  const inv = level.inventory || {};
  const cap = Math.min(
    opts.maxOptics === undefined ? 6 : opts.maxOptics,
    (inv.mirror || 0) + (inv.prism || 0),
  );
  if (opts.useEmbedded !== false) {
    const known = embeddedSolution(level, cap, opts.traceOpts);
    if (known) return { solved: true, optics: known, nodesExplored: 1, timedOut: false };
  }
  const total = opts.timeBudgetMs === undefined ? 12000 : opts.timeBudgetMs;
  let nodes = 0;
  let timedOut = false;
  for (let p = 0; p < PROFILES.length; p++) {
    const r = searchFrom(level, [], {
      ...opts,
      weights: PROFILES[p],
      timeBudgetMs: total / PROFILES.length,
    });
    nodes += r.nodesExplored;
    if (r.timedOut) timedOut = true;
    if (r.solved) return { solved: true, optics: r.optics, nodesExplored: nodes, timedOut: false };
  }
  // Not solved. `timedOut` says whether the search ran out of budget or genuinely exhausted
  // the discretised space it can see, which is the difference between "no shorter solution
  // was found" and "no shorter solution exists inside the search's own grid".
  return { solved: false, optics: [], nodesExplored: nodes, timedOut };
}

const hintCounters = new Map();

function regionName(level, x, y) {
  const size = level.boardSize || BOARD;
  const col = x < size / 3 ? 'left' : (x < (2 * size) / 3 ? 'middle' : 'right');
  const row = y < size / 3 ? 'top' : (y < (2 * size) / 3 ? 'centre' : 'bottom');
  if (row === 'centre' && col === 'middle') return 'the middle of the board';
  if (row === 'centre') return `the ${col} edge`;
  if (col === 'middle') return `the ${row} of the board`;
  return `the ${row}-${col} corner`;
}

export function hint(level, placedOptics) {
  const placed = placedOptics || [];
  const key = `${level.id}#${signature(placed)}`;
  const stage = (hintCounters.get(key) || 0);
  hintCounters.set(key, stage + 1);

  const current = traceScene(level, placed, {});
  if (current.solved) {
    return { text: 'Every receptor is lit. This board is done.', ghost: null };
  }

  let found = { solved: false, optics: [] };
  for (let p = 0; p < PROFILES.length && !found.solved; p++) {
    found = searchFrom(level, placed, { timeBudgetMs: 1200, weights: PROFILES[p] });
  }

  // The short search is allowed to fail on a board it cannot discretise well. When it does,
  // fall back on the author's own solution, but only while the player is still on that line —
  // if they have placed something that is not part of it, telling them to add the next piece
  // of a different plan would be worse than telling them to take a piece back.
  let next = found.solved ? found.optics[placed.length] : null;
  if (!next) {
    const sol = Array.isArray(level.solution) ? level.solution : [];
    const used = new Array(sol.length).fill(false);
    let onLine = true;
    for (let i = 0; i < placed.length; i++) {
      let hit = -1;
      for (let j = 0; j < sol.length; j++) {
        if (used[j] || sol[j].type !== placed[i].type) continue;
        if (Math.hypot(sol[j].x - placed[i].x, sol[j].y - placed[i].y) > 30) continue;
        if (Math.abs(norm(sol[j].angle - placed[i].angle + Math.PI) - Math.PI) > 6 * DEG) continue;
        hit = j;
        break;
      }
      if (hit < 0) { onLine = false; break; }
      used[hit] = true;
    }
    if (onLine) {
      for (let j = 0; j < sol.length; j++) {
        if (!used[j]) { next = sol[j]; break; }
      }
    }
  }

  if (!next) {
    const stuck = placed.length > 0
      ? 'Nothing you can still place will finish this arrangement — take a piece back and try another line.'
      : 'Start by finding where the beam wants to go, not where the receptors are.';
    return { text: stuck, ghost: null };
  }

  const missing = unsatisfied(level, current);
  const colours = missing.map((r) => r.color).join(', ');

  if (stage === 0) {
    if (next.type === 'prism') {
      return {
        text: placed.length === 0
          ? 'White light satisfies nothing. A prism has to come first.'
          : `The next piece is a prism — ${colours} still need to be pulled out of the white.`,
        ghost: null,
      };
    }
    return {
      text: placed.length === 0
        ? 'Follow the beam out of the emitter and find the first place worth turning it.'
        : 'The next piece is a mirror. Fold the beam somewhere it still has room to run.',
      ghost: null,
    };
  }

  if (stage === 1) {
    return {
      text: `Put the ${next.type} in ${regionName(level, next.x, next.y)}, on the light that is currently going to waste.`,
      ghost: null,
    };
  }

  const deg = (norm(next.angle) / DEG).toFixed(0);
  return {
    text: `${next.type === 'prism' ? 'Prism' : 'Mirror'} at ${Math.round(next.x)}, ${Math.round(next.y)}, turned to ${deg}°.`,
    ghost: { type: next.type, x: next.x, y: next.y, angle: next.angle },
  };
}
