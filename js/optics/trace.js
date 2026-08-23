// The REFRACT raytracer: white beam, mirror reflection, true two-surface prism dispersion.
//
// ---------------------------------------------------------------------------------------
// SEGMENT OWNERSHIP CONTRACT -- read this before calling traceScene.
//
// By DEFAULT a trace result owns its segments outright: every segment is a freshly built
// object and the result stays valid forever, no matter how many further traces run. That
// is the behaviour the wave-1 author chose deliberately, because callers genuinely hold
// two results at once and compare them -- `solver.js` keeps a whole beam frontier of past
// results alive while it traces new candidates, and `tools/test-optics.mjs` compares two
// consecutive traces segment by segment to prove the tracer is deterministic. Pooling by
// default would silently turn both of those into a comparison of a result against itself.
// So the default does not change, and a caller that says nothing keeps full ownership.
//
// A caller that provably does NOT retain the result may opt in with:
//
//     traceScene(level, optics, { ...opts, borrowSegments: 'my-lane' })
//
// and then:
//
//   * `result.segments` and the objects inside it are BORROWED from a module-owned pool.
//   * They are valid only until the NEXT borrowing trace ON THE SAME LANE, which
//     overwrites them in place. Traces on other lanes, and traces that borrow nothing,
//     leave them alone.
//   * Storing the result, its `segments` array, or any segment out of it beyond that point
//     is a bug. If you later decide you need to keep one, do not borrow: trace again with
//     no flag and get an owned result.
//   * `result.receptors`, `result.stats` and the result object itself are always fresh.
//     Only the segments are pooled, which is where all the volume is -- the heaviest real
//     level emits 442 segments per trace against 3 receptor records. Measured on FEEDING
//     THE SECOND: 262.4 KB allocated per owned trace, 16.0 KB per borrowed one.
//
// LANES EXIST BECAUSE THE ALTERNATIVE IS A REAL BUG. Two independent subsystems can both
// be inside a "throwaway" trace at once: the game holds the live trace it is drawing while
// the hint engine, on the same tick, runs confirmation traces of candidate arrangements.
// If both borrowed one shared pool the second would scribble over the beams being drawn.
// A lane name is just a string, so give each subsystem its own and they cannot collide.
// `borrowSegments: true` is accepted and means the lane literally named 'default'; only
// use it where you know nothing else borrows.
//
// The flag is read off the caller's own `opts` object, never off the merged options, so it
// cannot leak from one call into the next.
//
// traceScene is NOT re-entrant. It never was -- the scene lives in the module-level typed
// arrays below -- and the option object and segment pool are shared the same way.
// ---------------------------------------------------------------------------------------

import {
  EPS,
  SURFACE_OFFSET,
  raySegment,
  rayAABBInto,
  rayCircle,
  reflectInto,
  refractInto,
  fresnel,
} from './geometry.js';
import {
  sampleWavelengths,
  prismIOR,
  PRISM_DEFAULTS,
  RECEPTOR_BANDS,
} from './spectrum.js';

export const TRACE_DEFAULTS = {
  spectralSamples: 48,
  maxBounces: 64,
  maxSegments: 4000,
  receptorThreshold: 0.06,
  // REFERENCE.md 5.4: a real prism emits THREE things -- the primary fan, a weaker
  // secondary fan with REVERSED hue order, and a narrow neutral residual. The secondary
  // is the light that Fresnel-reflects off the inside of the exit face and leaves through
  // another one. At 1/spectralSamples per ray times a ~5 % internal reflectance that
  // branch lands near 1e-3, so a 1.5e-3 floor pruned the entire secondary fan out of
  // existence and left the prism reading as a rainbow dispenser. The floor now sits just
  // under the renderer's own 4e-4 visibility cutoff, so nothing survives that cannot be
  // seen and nothing visible is thrown away.
  minIntensity: 0.0004,
  mirrorLength: 110,
  prismSide: 75,
  receptorRadius: 22,
  wallThickness: 40,
  boardSize: 1000,
  borderWalls: true,
  fresnelReflections: true,
  glass: PRISM_DEFAULTS.glass,
  baseIOR: PRISM_DEFAULTS.baseIOR,
  spread: PRISM_DEFAULTS.spread,
  shapeBlend: PRISM_DEFAULTS.shapeBlend,
  acceptanceK: 2.0,
  beamHalfWidth: 8,
  mirrorReflectance: 0.9,
  includeFixed: true,
};

const KIND_NONE = 0;
const KIND_WALL = 1;
const KIND_MIRROR = 2;
const KIND_PRISM = 3;
const KIND_RECEPTOR = 4;

const GRAZE = EPS;
const FAR = 4000;

// --- scene buffers -------------------------------------------------------------------

let wallX = new Float64Array(64);
let wallY = new Float64Array(64);
let wallW = new Float64Array(64);
let wallH = new Float64Array(64);
let wallCount = 0;

let mirAX = new Float64Array(32);
let mirAY = new Float64Array(32);
let mirBX = new Float64Array(32);
let mirBY = new Float64Array(32);
let mirNX = new Float64Array(32);
let mirNY = new Float64Array(32);
let mirCount = 0;

let priVX = new Float64Array(3 * 16);
let priVY = new Float64Array(3 * 16);
let priNX = new Float64Array(3 * 16);
let priNY = new Float64Array(3 * 16);
let priCount = 0;

let recX = new Float64Array(16);
let recY = new Float64Array(16);
let recR = new Float64Array(16);
let recIn = new Float64Array(16);
let recOut = new Float64Array(16);
let recNm = new Float64Array(16);
let recCount = 0;

// Receptor identity and the `receptor:<id>` terminal label are rebuilt only when the level
// actually changes them. They used to be reassembled by string concatenation on every
// segment that landed on a receptor, which is a fresh string in the innermost loop.
const recId = [];
const recTerminal = [];
const defaultRecId = [];

// The placed-optics list is deduplicated against the level's fixed optics numerically.
// It used to build a Set of `type|x|y|angle` strings, so a five-optic board allocated a
// Set plus six strings on every single trace.
const dedupeX = [];
const dedupeY = [];
const dedupeA = [];
let dedupeCount = 0;

// --- ray stack -----------------------------------------------------------------------

let cap = 512;
let sOX = new Float64Array(cap);
let sOY = new Float64Array(cap);
let sDX = new Float64Array(cap);
let sDY = new Float64Array(cap);
let sNM = new Float64Array(cap);
let sI = new Float64Array(cap);
let sGen = new Int32Array(cap);
let sIn = new Int32Array(cap);
let sPerp = new Int32Array(cap);
let sSide = new Int32Array(cap);
let sp = 0;

// --- per-cast scratch ----------------------------------------------------------------

const aabb = new Float64Array(3);
const vec2 = new Float64Array(2);

let hitT = 0;
let hitKind = KIND_NONE;
let hitIdx = 0;
let hitNX = 0;
let hitNY = 0;

let energyIn = 0;
let energyTerminated = 0;
let energyPruned = 0;
let rayCount = 0;

// --- options ---------------------------------------------------------------------------

// One shared merged-options object. `Object.assign` into an existing object allocates
// nothing, and every key the tracer reads is a key of TRACE_DEFAULTS, so the first assign
// fully resets it. `borrowSegments` is deliberately NOT read from here (see the contract
// at the top of the file) precisely because it is not a TRACE_DEFAULTS key and would
// therefore survive into the following call.
const mergedOpts = Object.assign({}, TRACE_DEFAULTS);

function resolveOpts(opts) {
  Object.assign(mergedOpts, TRACE_DEFAULTS);
  if (opts) Object.assign(mergedOpts, opts);
  return mergedOpts;
}

// --- segment pool ----------------------------------------------------------------------

// One lane per borrowing subsystem. `store` grows to that lane's high-water mark and is
// never truncated, so after the first few traces a borrowed trace allocates nothing at
// all. `out` is the array handed to the caller; it holds the same references and only its
// length moves, so it too settles immediately.
const lanes = new Map();

function lane(name) {
  let l = lanes.get(name);
  if (l === undefined) {
    l = { store: [], out: [] };
    lanes.set(name, l);
  }
  return l;
}

let segStore = null;
let segOut = null;
let segCount = 0;
let borrowing = false;

// `side` is a RENDER HINT and nothing else: the number of times this ray has been
// REFLECTED at a glass surface -- an entry-face Fresnel bounce, an exit-face internal
// reflection, or a total internal reflection. Mirror bounces do not count; only glass.
//
// It exists because a prism's byproducts and its spectrum are physically indistinguishable
// once they are segments: both are wavelength rays in open air. REFERENCE.md 5.4 measures
// the byproducts at 0.62x and 0.76x the primary fan's peak, and ours were measured at 1.3x
// and, in the total-internal-reflection window, at 5x -- the prism's leftovers outshining
// the spectrum the prism exists to produce. That window is real physics: an equilateral
// prism at n = 1.52 total-internally-reflects the short half of the band whenever the beam
// enters within about 30 degrees of the entry face's normal, and that half then leaves
// through another face as one bright neutral wedge carrying up to 62 % of the input.
//
// The tracer does NOT attenuate any of it. Energy conservation is asserted by
// tools/test-optics.mjs and the receptors read these same intensities, so weighting the
// byproducts here would change what the puzzle does. `side` only lets render/beams.js draw
// them subordinate, exactly as `intensityShape` already reshapes drawn white intensity
// without touching the traced value.
function newSegment() {
  return {
    ax: 0,
    ay: 0,
    bx: 0,
    by: 0,
    nm: 0,
    intensity: 0,
    generation: 0,
    terminal: null,
    inside: false,
    perp: 1,
    side: 0,
  };
}

function emitSeg(ax, ay, bx, by, nm, intensity, generation, terminal, inside, perp, side) {
  if (borrowing) {
    let s = segStore[segCount];
    if (s === undefined) {
      s = newSegment();
      segStore[segCount] = s;
    }
    s.ax = ax;
    s.ay = ay;
    s.bx = bx;
    s.by = by;
    s.nm = nm;
    s.intensity = intensity;
    s.generation = generation;
    s.terminal = terminal;
    s.inside = inside;
    s.perp = perp;
    s.side = side;
    segOut[segCount] = s;
  } else {
    // Same field order as newSegment(), so owned and borrowed segments share one hidden
    // class and every consumer stays monomorphic.
    segOut[segCount] = {
      ax,
      ay,
      bx,
      by,
      nm,
      intensity,
      generation,
      terminal,
      inside,
      perp,
      side,
    };
  }
  segCount++;
}

function growWalls(n) {
  if (n <= wallX.length) return;
  const s = Math.max(n, wallX.length * 2);
  const nx = new Float64Array(s);
  nx.set(wallX); wallX = nx;
  const ny = new Float64Array(s);
  ny.set(wallY); wallY = ny;
  const nw = new Float64Array(s);
  nw.set(wallW); wallW = nw;
  const nh = new Float64Array(s);
  nh.set(wallH); wallH = nh;
}

function growMirrors(n) {
  if (n <= mirAX.length) return;
  const s = Math.max(n, mirAX.length * 2);
  const a = new Float64Array(s); a.set(mirAX); mirAX = a;
  const b = new Float64Array(s); b.set(mirAY); mirAY = b;
  const c = new Float64Array(s); c.set(mirBX); mirBX = c;
  const d = new Float64Array(s); d.set(mirBY); mirBY = d;
  const e = new Float64Array(s); e.set(mirNX); mirNX = e;
  const f = new Float64Array(s); f.set(mirNY); mirNY = f;
}

function growPrisms(n) {
  if (3 * n <= priVX.length) return;
  const s = Math.max(3 * n, priVX.length * 2);
  const a = new Float64Array(s); a.set(priVX); priVX = a;
  const b = new Float64Array(s); b.set(priVY); priVY = b;
  const c = new Float64Array(s); c.set(priNX); priNX = c;
  const d = new Float64Array(s); d.set(priNY); priNY = d;
}

function growReceptors(n) {
  if (n <= recX.length) return;
  const s = Math.max(n, recX.length * 2);
  const a = new Float64Array(s); a.set(recX); recX = a;
  const b = new Float64Array(s); b.set(recY); recY = b;
  const c = new Float64Array(s); c.set(recR); recR = c;
  recIn = new Float64Array(s);
  recOut = new Float64Array(s);
  recNm = new Float64Array(s);
}

function growStack() {
  const s = cap * 2;
  const a = new Float64Array(s); a.set(sOX); sOX = a;
  const b = new Float64Array(s); b.set(sOY); sOY = b;
  const c = new Float64Array(s); c.set(sDX); sDX = c;
  const d = new Float64Array(s); d.set(sDY); sDY = d;
  const e = new Float64Array(s); e.set(sNM); sNM = e;
  const f = new Float64Array(s); f.set(sI); sI = f;
  const g = new Int32Array(s); g.set(sGen); sGen = g;
  const h = new Int32Array(s); h.set(sIn); sIn = h;
  const p = new Int32Array(s); p.set(sPerp); sPerp = p;
  const q = new Int32Array(s); q.set(sSide); sSide = q;
  cap = s;
}

function addWall(x, y, w, h) {
  growWalls(wallCount + 1);
  wallX[wallCount] = x;
  wallY[wallCount] = y;
  wallW[wallCount] = w;
  wallH[wallCount] = h;
  wallCount++;
}

function addMirror(x, y, angle, len) {
  growMirrors(mirCount + 1);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const h = len * 0.5;
  mirAX[mirCount] = x - c * h;
  mirAY[mirCount] = y - s * h;
  mirBX[mirCount] = x + c * h;
  mirBY[mirCount] = y + s * h;
  mirNX[mirCount] = -s;
  mirNY[mirCount] = c;
  mirCount++;
}

function addPrism(x, y, angle, side) {
  growPrisms(priCount + 1);
  const r = side / Math.sqrt(3);
  const base = priCount * 3;
  for (let i = 0; i < 3; i++) {
    const a = angle + (i * 2 * Math.PI) / 3;
    priVX[base + i] = x + Math.cos(a) * r;
    priVY[base + i] = y + Math.sin(a) * r;
  }
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const ex = priVX[base + j] - priVX[base + i];
    const ey = priVY[base + j] - priVY[base + i];
    const l = Math.hypot(ex, ey) || 1;
    let nx = ey / l;
    let ny = -ex / l;
    const mx = (priVX[base + i] + priVX[base + j]) * 0.5 - x;
    const my = (priVY[base + i] + priVY[base + j]) * 0.5 - y;
    if (nx * mx + ny * my < 0) {
      nx = -nx;
      ny = -ny;
    }
    priNX[base + i] = nx;
    priNY[base + i] = ny;
  }
  priCount++;
}

// Identity of a placed optic, to the same tolerance the old string key used: hundredths of
// a unit in position and a millionth of a radian in angle, compared as numbers instead of
// being spelled out as a string.
function markPlaced(o) {
  dedupeX[dedupeCount] = Math.round(o.x * 100);
  dedupeY[dedupeCount] = Math.round(o.y * 100);
  dedupeA[dedupeCount] = Math.round(o.angle * 1e6);
  dedupeCount++;
}

function alreadyPlaced(o) {
  const x = Math.round(o.x * 100);
  const y = Math.round(o.y * 100);
  const a = Math.round(o.angle * 1e6);
  for (let i = 0; i < dedupeCount; i++) {
    if (dedupeX[i] === x && dedupeY[i] === y && dedupeA[i] === a) return true;
  }
  return false;
}

function buildScene(level, optics, o) {
  wallCount = 0;
  mirCount = 0;
  priCount = 0;
  recCount = 0;
  dedupeCount = 0;

  const size = level.boardSize || o.boardSize;
  const t = level.wallThickness || o.wallThickness;
  if (o.borderWalls) {
    addWall(0, 0, size, t);
    addWall(0, size - t, size, t);
    addWall(0, t, t, size - 2 * t);
    addWall(size - t, t, t, size - 2 * t);
  }
  const walls = level.walls || null;
  if (walls) {
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      addWall(w.x, w.y, w.w, w.h);
    }
  }

  const list = optics || null;
  if (list) {
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p || (p.type !== 'mirror' && p.type !== 'prism')) continue;
      markPlaced(p);
      if (p.type === 'mirror') addMirror(p.x, p.y, p.angle, p.length || o.mirrorLength);
      else addPrism(p.x, p.y, p.angle, p.side || o.prismSide);
    }
  }
  if (o.includeFixed && level.fixed) {
    const fixed = level.fixed;
    for (let i = 0; i < fixed.length; i++) {
      const p = fixed[i];
      if (!p || (p.type !== 'mirror' && p.type !== 'prism')) continue;
      if (alreadyPlaced(p)) continue;
      if (p.type === 'mirror') addMirror(p.x, p.y, p.angle, p.length || o.mirrorLength);
      else addPrism(p.x, p.y, p.angle, p.side || o.prismSide);
    }
  }

  const receptors = level.receptors || null;
  const n = receptors ? receptors.length : 0;
  growReceptors(n + 1);
  for (let i = 0; i < n; i++) {
    const r = receptors[i];
    recX[i] = r.x;
    recY[i] = r.y;
    recR[i] = r.r || level.receptorRadius || o.receptorRadius;
    recIn[i] = 0;
    recOut[i] = 0;
    recNm[i] = 0;
    let id = r.id;
    if (id === undefined) {
      id = defaultRecId[i];
      if (id === undefined) {
        id = 'r' + i;
        defaultRecId[i] = id;
      }
    }
    if (recId[i] !== id) {
      recId[i] = id;
      recTerminal[i] = 'receptor:' + id;
    }
  }
  recCount = n;
}

// Nearest surface along the ray. Results land in the module-level hit* fields.
function cast(ox, oy, dx, dy, inside) {
  hitT = Infinity;
  hitKind = KIND_NONE;

  if (inside >= 0) {
    const base = inside * 3;
    for (let e = 0; e < 3; e++) {
      const j = (e + 1) % 3;
      const t = raySegment(ox, oy, dx, dy, priVX[base + e], priVY[base + e], priVX[base + j], priVY[base + j]);
      if (t !== null && t < hitT) {
        hitT = t;
        hitKind = KIND_PRISM;
        hitIdx = inside;
        hitNX = priNX[base + e];
        hitNY = priNY[base + e];
      }
    }
    return;
  }

  for (let i = 0; i < wallCount; i++) {
    if (rayAABBInto(aabb, ox, oy, dx, dy, wallX[i], wallY[i], wallW[i], wallH[i]) && aabb[0] < hitT) {
      hitT = aabb[0];
      hitKind = KIND_WALL;
      hitIdx = i;
      hitNX = aabb[1];
      hitNY = aabb[2];
    }
  }

  for (let i = 0; i < mirCount; i++) {
    const nd = dx * mirNX[i] + dy * mirNY[i];
    if (nd > -GRAZE && nd < GRAZE) continue;
    const t = raySegment(ox, oy, dx, dy, mirAX[i], mirAY[i], mirBX[i], mirBY[i]);
    if (t !== null && t < hitT) {
      hitT = t;
      hitKind = KIND_MIRROR;
      hitIdx = i;
      hitNX = mirNX[i];
      hitNY = mirNY[i];
    }
  }

  for (let p = 0; p < priCount; p++) {
    const base = p * 3;
    for (let e = 0; e < 3; e++) {
      const j = (e + 1) % 3;
      const t = raySegment(ox, oy, dx, dy, priVX[base + e], priVY[base + e], priVX[base + j], priVY[base + j]);
      if (t !== null && t < hitT) {
        hitT = t;
        hitKind = KIND_PRISM;
        hitIdx = p;
        hitNX = priNX[base + e];
        hitNY = priNY[base + e];
      }
    }
  }

  for (let i = 0; i < recCount; i++) {
    const t = rayCircle(ox, oy, dx, dy, recX[i], recY[i], recR[i]);
    if (t !== null && t < hitT) {
      hitT = t;
      hitKind = KIND_RECEPTOR;
      hitIdx = i;
      hitNX = 0;
      hitNY = 0;
    }
  }
}

function push(ox, oy, dx, dy, nm, intensity, gen, inside, perp, side, minIntensity) {
  if (!(intensity > 0)) return;
  if (intensity < minIntensity) {
    energyPruned += intensity;
    return;
  }
  if (sp === cap) growStack();
  sOX[sp] = ox;
  sOY[sp] = oy;
  sDX[sp] = dx;
  sDY[sp] = dy;
  sNM[sp] = nm;
  sI[sp] = intensity;
  sGen[sp] = gen;
  sIn[sp] = inside;
  sPerp[sp] = perp;
  sSide[sp] = side;
  sp++;
  rayCount++;
}

/**
 * Trace a level.
 *
 * @param level  level data (walls, emitter, receptors)
 * @param optics placed optics, runtime shape
 * @param opts   see TRACE_DEFAULTS, plus the optional `borrowSegments` flag documented in
 *               the SEGMENT OWNERSHIP CONTRACT at the top of this file: a lane name, or
 *               `true` for the lane called 'default'. Omit it and the result owns its
 *               segments for good.
 * @returns {{segments: Array, receptors: Array, solved: boolean, stats: Object}}
 */
export function traceScene(level, optics, opts) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const o = resolveOpts(opts);

  const borrow = opts ? opts.borrowSegments : undefined;
  borrowing = borrow === true || typeof borrow === 'string';
  if (borrowing) {
    const l = lane(borrow === true ? 'default' : borrow);
    segStore = l.store;
    segOut = l.out;
  } else {
    segStore = null;
    segOut = [];
  }
  segCount = 0;

  buildScene(level, optics, o);

  const samples = sampleWavelengths(o.spectralSamples);
  const nSamples = samples.length;
  const minI = o.minIntensity;
  const maxSeg = o.maxSegments;
  const maxGen = o.maxBounces;
  const useFresnel = o.fresnelReflections;
  const acceptK = o.acceptanceK;
  const halfW = o.beamHalfWidth;
  const mirrorR = o.mirrorReflectance;
  const iors = sampleIORs(samples, o);
  const whiteIOR = prismIOR(550, o.baseIOR, o.spread, o.glass, o.shapeBlend);

  energyIn = 0;
  energyTerminated = 0;
  energyPruned = 0;
  rayCount = 0;
  sp = 0;

  // The transverse frame starts right-handed: +1 means the warm shoulder lies on the
  // +n side of the ray, with n = (-dy, dx). REFERENCE.md 4.2.
  const emitters = level.emitters;
  if (emitters) {
    for (let i = 0; i < emitters.length; i++) {
      const e = emitters[i];
      const amp = e.intensity === undefined ? 1 : e.intensity;
      energyIn += amp;
      push(e.x, e.y, Math.cos(e.dir), Math.sin(e.dir), 0, amp, 0, -1, 1, 0, 0);
    }
  } else if (level.emitter) {
    const e = level.emitter;
    const amp = e.intensity === undefined ? 1 : e.intensity;
    energyIn += amp;
    push(e.x, e.y, Math.cos(e.dir), Math.sin(e.dir), 0, amp, 0, -1, 1, 0, 0);
  }

  let truncated = false;

  while (sp > 0) {
    if (segCount >= maxSeg) {
      truncated = true;
      break;
    }
    sp--;
    const ox = sOX[sp];
    const oy = sOY[sp];
    const dx = sDX[sp];
    const dy = sDY[sp];
    const nm = sNM[sp];
    const intensity = sI[sp];
    const gen = sGen[sp];
    const inside = sIn[sp];
    const perp = sPerp[sp];
    const side = sSide[sp];

    cast(ox, oy, dx, dy, inside);

    if (hitKind === KIND_NONE) {
      if (inside >= 0) {
        // A ray flagged as inside the glass with no face ahead of it has left through the
        // exact vertex where two faces meet -- the one geometric singularity a triangle
        // has, and reachable in play because rotation snaps to 5 degrees and a prism at
        // 0, 60 or 120 degrees sends a horizontal beam straight into its apex. Left alone
        // it flew the whole board still marked as glass, so every sample drew as a thin
        // hairline instead of a fan. Re-cast it as a ray in open air from the same point.
        push(ox, oy, dx, dy, nm, intensity, gen + 1, -1, perp, side, minI);
        continue;
      }
      emitSeg(ox, oy, ox + dx * FAR, oy + dy * FAR, nm, intensity, gen, 'escape', false, perp, side);
      if (recCount > 0 && inside < 0) measure(level, ox, oy, dx, dy, FAR, nm, intensity, acceptK, halfW);
      energyTerminated += intensity;
      continue;
    }

    const hx = ox + dx * hitT;
    const hy = oy + dy * hitT;
    if (recCount > 0 && inside < 0 && hitKind !== KIND_RECEPTOR) {
      measure(level, ox, oy, dx, dy, hitT, nm, intensity, acceptK, halfW);
    }

    if (hitKind === KIND_WALL) {
      emitSeg(ox, oy, hx, hy, nm, intensity, gen, 'wall', inside >= 0, perp, side);
      energyTerminated += intensity;
      continue;
    }

    if (hitKind === KIND_RECEPTOR) {
      emitSeg(ox, oy, hx, hy, nm, intensity, gen, recTerminal[hitIdx], false, perp, side);
      energyTerminated += intensity;
      collect(hitIdx, level, nm, intensity, (recX[hitIdx] - ox) * dy - (recY[hitIdx] - oy) * dx, acceptK, halfW);
      continue;
    }

    const canContinue = gen + 1 <= maxGen;

    if (hitKind === KIND_MIRROR) {
      if (!canContinue) {
        emitSeg(ox, oy, hx, hy, nm, intensity, gen, 'depth', false, perp, side);
        energyTerminated += intensity;
        continue;
      }
      let nx = hitNX;
      let ny = hitNY;
      if (dx * nx + dy * ny > 0) {
        nx = -nx;
        ny = -ny;
      }
      emitSeg(ox, oy, hx, hy, nm, intensity, gen, null, false, perp, side);
      reflectInto(vec2, dx, dy, nx, ny);
      // A reflection mirrors the ray's transverse frame, so the warm and cool shoulders
      // trade sides. The 10 % the mirror does not return is absorbed here.
      const kept = intensity * mirrorR;
      energyTerminated += intensity - kept;
      push(hx + nx * SURFACE_OFFSET, hy + ny * SURFACE_OFFSET, vec2[0], vec2[1], nm, kept, gen + 1, -1, -perp, side, minI);
      continue;
    }

    // KIND_PRISM
    if (!canContinue) {
      emitSeg(ox, oy, hx, hy, nm, intensity, gen, 'depth', inside >= 0, perp, side);
      energyTerminated += intensity;
      continue;
    }

    const nOutX = hitNX;
    const nOutY = hitNY;

    if (inside < 0) {
      // Entering the glass.
      let fx = nOutX;
      let fy = nOutY;
      if (dx * fx + dy * fy > 0) {
        fx = -fx;
        fy = -fy;
      }
      const cosI = -(dx * fx + dy * fy);
      const nGlass = nm ? prismIOR(nm, o.baseIOR, o.spread, o.glass, o.shapeBlend) : whiteIOR;
      const R = useFresnel ? fresnel(cosI, 1, nGlass) : 0;
      emitSeg(ox, oy, hx, hy, nm, intensity, gen, null, false, perp, side);

      if (R > 0) {
        reflectInto(vec2, dx, dy, fx, fy);
        push(hx + fx * SURFACE_OFFSET, hy + fy * SURFACE_OFFSET, vec2[0], vec2[1], nm, intensity * R, gen + 1, -1, -perp, side + 1, minI);
      }

      const T = intensity * (1 - R);
      if (T > 0) {
        if (nm === 0 && nSamples > 1) {
          const share = T / nSamples;
          for (let k = 0; k < nSamples; k++) {
            const w = samples[k];
            const nk = iors[k];
            if (refractInto(vec2, dx, dy, fx, fy, 1 / nk)) {
              push(hx - fx * SURFACE_OFFSET, hy - fy * SURFACE_OFFSET, vec2[0], vec2[1], w, share, gen + 1, hitIdx, perp, side, minI);
            } else {
              reflectInto(vec2, dx, dy, fx, fy);
              push(hx + fx * SURFACE_OFFSET, hy + fy * SURFACE_OFFSET, vec2[0], vec2[1], w, share, gen + 1, -1, -perp, side + 1, minI);
            }
          }
        } else {
          const nk = nGlass;
          if (refractInto(vec2, dx, dy, fx, fy, 1 / nk)) {
            push(hx - fx * SURFACE_OFFSET, hy - fy * SURFACE_OFFSET, vec2[0], vec2[1], nm, T, gen + 1, hitIdx, perp, side, minI);
          } else {
            reflectInto(vec2, dx, dy, fx, fy);
            push(hx + fx * SURFACE_OFFSET, hy + fy * SURFACE_OFFSET, vec2[0], vec2[1], nm, T, gen + 1, -1, -perp, side + 1, minI);
          }
        }
      }
      continue;
    }

    // Leaving the glass (or total internal reflection).
    emitSeg(ox, oy, hx, hy, nm, intensity, gen, null, true, perp, side);
    const nGlass = nm ? prismIOR(nm, o.baseIOR, o.spread, o.glass, o.shapeBlend) : whiteIOR;
    let fx = nOutX;
    let fy = nOutY;
    if (dx * fx + dy * fy < 0) {
      fx = -fx;
      fy = -fy;
    }
    const cosI = dx * fx + dy * fy;
    if (refractInto(vec2, dx, dy, fx, fy, nGlass)) {
      const R = useFresnel ? fresnel(cosI, nGlass, 1) : 0;
      const T = intensity * (1 - R);
      if (T > 0) {
        push(hx + fx * SURFACE_OFFSET, hy + fy * SURFACE_OFFSET, vec2[0], vec2[1], nm, T, gen + 1, -1, perp, side, minI);
      }
      if (R > 0) {
        reflectInto(vec2, dx, dy, fx, fy);
        push(hx - fx * SURFACE_OFFSET, hy - fy * SURFACE_OFFSET, vec2[0], vec2[1], nm, intensity * R, gen + 1, hitIdx, -perp, side + 1, minI);
      }
    } else {
      reflectInto(vec2, dx, dy, fx, fy);
      push(hx - fx * SURFACE_OFFSET, hy - fy * SURFACE_OFFSET, vec2[0], vec2[1], nm, intensity, gen + 1, hitIdx, -perp, side + 1, minI);
    }
  }

  while (sp > 0) {
    sp--;
    energyPruned += sI[sp];
  }

  const segments = segOut;
  if (segments.length !== segCount) segments.length = segCount;
  segOut = null;
  segStore = null;

  const receptorEvals = [];
  let solved = recCount > 0;
  for (let i = 0; i < recCount; i++) {
    const src = level.receptors[i];
    const lit = recIn[i];
    const stray = recOut[i];
    const ok = lit >= o.receptorThreshold && lit >= 3 * stray;
    if (!ok) solved = false;
    receptorEvals.push({
      id: recId[i],
      color: src.color,
      litNm: lit > 0 ? recNm[i] / lit : 0,
      litIntensity: lit,
      strayIntensity: stray,
      satisfied: ok,
    });
  }

  const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  return {
    segments,
    receptors: receptorEvals,
    solved,
    stats: {
      segments: segCount,
      rays: rayCount,
      truncated,
      spectralSamples: nSamples,
      energyIn,
      energyTerminated,
      energyPruned,
      ms: t1 - t0,
    },
  };
}

// A receptor reads a beam of finite width, not a mathematical line, so its acceptance
// extends half a beam beyond the ring and falls off smoothly with the impact parameter.
// That is what lets a distant receptor stay bright while the fan's colours pull apart:
// each wavelength ribbon keeps its width, only their separation grows with distance.
function collect(i, level, nm, intensity, impact, acceptK, halfW) {
  const a = recR[i] + halfW;
  const q = impact / a;
  const accepted = intensity * Math.exp(-acceptK * q * q);
  const band = RECEPTOR_BANDS[level.receptors[i].color];
  if (nm && band && nm >= band[0] && nm <= band[1]) {
    recIn[i] += accepted;
    recNm[i] += accepted * nm;
  } else {
    recOut[i] += accepted;
  }
}

// Light that passes beside a receptor without being absorbed by it still lands in its mouth.
function measure(level, ox, oy, dx, dy, tEnd, nm, intensity, acceptK, halfW) {
  for (let i = 0; i < recCount; i++) {
    const px = recX[i] - ox;
    const py = recY[i] - oy;
    const along = px * dx + py * dy;
    if (along < 0 || along > tEnd) continue;
    const impact = px * dy - py * dx;
    const a = recR[i] + halfW;
    if (impact > a || impact < -a) continue;
    if (impact <= recR[i] && impact >= -recR[i]) continue;
    collect(i, level, nm, intensity, impact, acceptK, halfW);
  }
}

// Per-sample indices only change when the glass parameters do, so they are computed once
// per trace instead of once per prism face. The cache key is compared field by field --
// spelling it out as a string built a fresh string on every trace just to throw it away.
let iorKeyLen = -1;
let iorKeyBase = NaN;
let iorKeySpread = NaN;
let iorKeyGlass = null;
let iorKeyBlend = NaN;
let iorCache = new Float64Array(0);

function sampleIORs(samples, o) {
  const n = samples.length;
  if (
    n === iorKeyLen
    && o.baseIOR === iorKeyBase
    && o.spread === iorKeySpread
    && o.glass === iorKeyGlass
    && o.shapeBlend === iorKeyBlend
  ) {
    return iorCache;
  }
  if (iorCache.length !== n) iorCache = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    iorCache[i] = prismIOR(samples[i], o.baseIOR, o.spread, o.glass, o.shapeBlend);
  }
  iorKeyLen = n;
  iorKeyBase = o.baseIOR;
  iorKeySpread = o.spread;
  iorKeyGlass = o.glass;
  iorKeyBlend = o.shapeBlend;
  return iorCache;
}
