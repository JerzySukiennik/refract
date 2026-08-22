// The REFRACT raytracer: white beam, mirror reflection, true two-surface prism dispersion.

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
  minIntensity: 0.0015,
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

function opticKey(o) {
  return o.type + '|' + Math.round(o.x * 100) + '|' + Math.round(o.y * 100) + '|' + Math.round(o.angle * 1e6);
}

function buildScene(level, optics, o) {
  wallCount = 0;
  mirCount = 0;
  priCount = 0;
  recCount = 0;

  const size = level.boardSize || o.boardSize;
  const t = level.wallThickness || o.wallThickness;
  if (o.borderWalls) {
    addWall(0, 0, size, t);
    addWall(0, size - t, size, t);
    addWall(0, t, t, size - 2 * t);
    addWall(size - t, t, t, size - 2 * t);
  }
  const walls = level.walls || [];
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    addWall(w.x, w.y, w.w, w.h);
  }

  const seen = new Set();
  const list = optics || [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p || (p.type !== 'mirror' && p.type !== 'prism')) continue;
    seen.add(opticKey(p));
    if (p.type === 'mirror') addMirror(p.x, p.y, p.angle, p.length || o.mirrorLength);
    else addPrism(p.x, p.y, p.angle, p.side || o.prismSide);
  }
  if (o.includeFixed && level.fixed) {
    for (let i = 0; i < level.fixed.length; i++) {
      const p = level.fixed[i];
      if (!p || (p.type !== 'mirror' && p.type !== 'prism')) continue;
      if (seen.has(opticKey(p))) continue;
      if (p.type === 'mirror') addMirror(p.x, p.y, p.angle, p.length || o.mirrorLength);
      else addPrism(p.x, p.y, p.angle, p.side || o.prismSide);
    }
  }

  const receptors = level.receptors || [];
  growReceptors(receptors.length + 1);
  for (let i = 0; i < receptors.length; i++) {
    const r = receptors[i];
    recX[i] = r.x;
    recY[i] = r.y;
    recR[i] = r.r || level.receptorRadius || o.receptorRadius;
    recIn[i] = 0;
    recOut[i] = 0;
    recNm[i] = 0;
  }
  recCount = receptors.length;
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

function push(ox, oy, dx, dy, nm, intensity, gen, inside, minIntensity) {
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
  sp++;
  rayCount++;
}

/**
 * Trace a level.
 * @param level  level data (walls, emitter, receptors)
 * @param optics placed optics, runtime shape
 * @param opts   see TRACE_DEFAULTS
 * @returns {{segments: Array, receptors: Array, solved: boolean, stats: Object}}
 */
export function traceScene(level, optics, opts) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const o = opts ? Object.assign({}, TRACE_DEFAULTS, opts) : TRACE_DEFAULTS;

  buildScene(level, optics, o);

  const samples = sampleWavelengths(o.spectralSamples);
  const nSamples = samples.length;
  const minI = o.minIntensity;
  const maxSeg = o.maxSegments;
  const maxGen = o.maxBounces;
  const useFresnel = o.fresnelReflections;
  const acceptK = o.acceptanceK;
  const halfW = o.beamHalfWidth;
  const iors = sampleIORs(samples, o);
  const whiteIOR = prismIOR(550, o.baseIOR, o.spread, o.glass, o.shapeBlend);

  const segments = [];
  energyIn = 0;
  energyTerminated = 0;
  energyPruned = 0;
  rayCount = 0;
  sp = 0;

  const emitters = level.emitters || (level.emitter ? [level.emitter] : []);
  for (let i = 0; i < emitters.length; i++) {
    const e = emitters[i];
    const amp = e.intensity === undefined ? 1 : e.intensity;
    energyIn += amp;
    push(e.x, e.y, Math.cos(e.dir), Math.sin(e.dir), 0, amp, 0, -1, 0);
  }

  let truncated = false;

  while (sp > 0) {
    if (segments.length >= maxSeg) {
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

    cast(ox, oy, dx, dy, inside);

    if (hitKind === KIND_NONE) {
      segments.push(seg(ox, oy, ox + dx * FAR, oy + dy * FAR, nm, intensity, gen, 'escape', inside >= 0));
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
      segments.push(seg(ox, oy, hx, hy, nm, intensity, gen, 'wall', inside >= 0));
      energyTerminated += intensity;
      continue;
    }

    if (hitKind === KIND_RECEPTOR) {
      const id = receptorId(level, hitIdx);
      segments.push(seg(ox, oy, hx, hy, nm, intensity, gen, 'receptor:' + id, false));
      energyTerminated += intensity;
      collect(hitIdx, level, nm, intensity, (recX[hitIdx] - ox) * dy - (recY[hitIdx] - oy) * dx, acceptK, halfW);
      continue;
    }

    const canContinue = gen + 1 <= maxGen;

    if (hitKind === KIND_MIRROR) {
      if (!canContinue) {
        segments.push(seg(ox, oy, hx, hy, nm, intensity, gen, 'depth', false));
        energyTerminated += intensity;
        continue;
      }
      let nx = hitNX;
      let ny = hitNY;
      if (dx * nx + dy * ny > 0) {
        nx = -nx;
        ny = -ny;
      }
      segments.push(seg(ox, oy, hx, hy, nm, intensity, gen, null, false));
      reflectInto(vec2, dx, dy, nx, ny);
      push(hx + nx * SURFACE_OFFSET, hy + ny * SURFACE_OFFSET, vec2[0], vec2[1], nm, intensity, gen + 1, -1, minI);
      continue;
    }

    // KIND_PRISM
    if (!canContinue) {
      segments.push(seg(ox, oy, hx, hy, nm, intensity, gen, 'depth', inside >= 0));
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
      segments.push(seg(ox, oy, hx, hy, nm, intensity, gen, null, false));

      if (R > 0) {
        reflectInto(vec2, dx, dy, fx, fy);
        push(hx + fx * SURFACE_OFFSET, hy + fy * SURFACE_OFFSET, vec2[0], vec2[1], nm, intensity * R, gen + 1, -1, minI);
      }

      const T = intensity * (1 - R);
      if (T > 0) {
        if (nm === 0 && nSamples > 1) {
          const share = T / nSamples;
          for (let k = 0; k < nSamples; k++) {
            const w = samples[k];
            const nk = iors[k];
            if (refractInto(vec2, dx, dy, fx, fy, 1 / nk)) {
              push(hx - fx * SURFACE_OFFSET, hy - fy * SURFACE_OFFSET, vec2[0], vec2[1], w, share, gen + 1, hitIdx, minI);
            } else {
              reflectInto(vec2, dx, dy, fx, fy);
              push(hx + fx * SURFACE_OFFSET, hy + fy * SURFACE_OFFSET, vec2[0], vec2[1], w, share, gen + 1, -1, minI);
            }
          }
        } else {
          const nk = nGlass;
          if (refractInto(vec2, dx, dy, fx, fy, 1 / nk)) {
            push(hx - fx * SURFACE_OFFSET, hy - fy * SURFACE_OFFSET, vec2[0], vec2[1], nm, T, gen + 1, hitIdx, minI);
          } else {
            reflectInto(vec2, dx, dy, fx, fy);
            push(hx + fx * SURFACE_OFFSET, hy + fy * SURFACE_OFFSET, vec2[0], vec2[1], nm, T, gen + 1, -1, minI);
          }
        }
      }
      continue;
    }

    // Leaving the glass (or total internal reflection).
    segments.push(seg(ox, oy, hx, hy, nm, intensity, gen, null, true));
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
        push(hx + fx * SURFACE_OFFSET, hy + fy * SURFACE_OFFSET, vec2[0], vec2[1], nm, T, gen + 1, -1, minI);
      }
      if (R > 0) {
        reflectInto(vec2, dx, dy, fx, fy);
        push(hx - fx * SURFACE_OFFSET, hy - fy * SURFACE_OFFSET, vec2[0], vec2[1], nm, intensity * R, gen + 1, hitIdx, minI);
      }
    } else {
      reflectInto(vec2, dx, dy, fx, fy);
      push(hx - fx * SURFACE_OFFSET, hy - fy * SURFACE_OFFSET, vec2[0], vec2[1], nm, intensity, gen + 1, hitIdx, minI);
    }
  }

  while (sp > 0) {
    sp--;
    energyPruned += sI[sp];
  }

  const receptorEvals = [];
  let solved = recCount > 0;
  for (let i = 0; i < recCount; i++) {
    const src = level.receptors[i];
    const lit = recIn[i];
    const stray = recOut[i];
    const ok = lit >= o.receptorThreshold && lit >= 3 * stray;
    if (!ok) solved = false;
    receptorEvals.push({
      id: receptorId(level, i),
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
      segments: segments.length,
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
// per trace instead of once per prism face.
let iorCacheKey = '';
let iorCache = new Float64Array(0);

function sampleIORs(samples, o) {
  const key = samples.length + '|' + o.baseIOR + '|' + o.spread + '|' + o.glass + '|' + o.shapeBlend;
  if (key === iorCacheKey) return iorCache;
  if (iorCache.length !== samples.length) iorCache = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    iorCache[i] = prismIOR(samples[i], o.baseIOR, o.spread, o.glass, o.shapeBlend);
  }
  iorCacheKey = key;
  return iorCache;
}

function receptorId(level, i) {
  const r = level.receptors[i];
  return r.id === undefined ? 'r' + i : r.id;
}

function seg(ax, ay, bx, by, nm, intensity, generation, terminal, inside) {
  return { ax, ay, bx, by, nm, intensity, generation, terminal, inside };
}
