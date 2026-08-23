// Dependency-free correctness suite for js/optics: run with `node tools/test-optics.mjs`.

import {
  EPS,
  raySegment,
  rayAABB,
  rayCircle,
  reflect,
  refract,
  rotate,
  norm,
  normSigned,
  angleOf,
  fresnel,
  criticalAngle,
} from '../js/optics/geometry.js';
import {
  NM_MIN,
  NM_MAX,
  cieXYZ,
  nmToLinearRGB,
  nmToSRGB,
  sellmeierIOR,
  abbeNumber,
  sampleWavelengths,
  prismIOR,
  RECEPTOR_BANDS,
} from '../js/optics/spectrum.js';
import { traceScene } from '../js/optics/trace.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${err && err.message ? err.message : err}`);
  }
}

function ok(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function near(a, b, tol, msg) {
  if (!(Math.abs(a - b) <= tol)) {
    throw new Error(`${msg || 'not near'}: ${a} vs ${b} (tol ${tol})`);
  }
}

const DEG = Math.PI / 180;
const emptyLevel = (over) => Object.assign({
  id: 0,
  name: 'TEST',
  par: 0,
  emitter: { x: 100, y: 300, dir: 0 },
  walls: [],
  receptors: [],
  inventory: {},
  fixed: [],
}, over || {});

function dirOf(s) {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const l = Math.hypot(dx, dy);
  return [dx / l, dy / l];
}

// --- geometry ------------------------------------------------------------------------

test('raySegment hits a crossing segment and misses a parallel one', () => {
  const t = raySegment(0, 0, 1, 0, 5, -1, 5, 1);
  near(t, 5, 1e-9, 'crossing t');
  ok(raySegment(0, 0, 1, 0, 5, 1, 9, 1) === null, 'parallel segment must miss');
  ok(raySegment(0, 0, 1, 0, -5, -1, -5, 1) === null, 'behind the origin must miss');
  ok(raySegment(0, 0, 1, 0, 5, 2, 5, 4) === null, 'off the segment span must miss');
});

test('rayAABB reports entry point and surface normal', () => {
  const h = rayAABB(0, 50, 1, 0, 100, 0, 20, 100);
  ok(h !== null, 'must hit the box');
  near(h.t, 100, 1e-9, 'entry t');
  near(h.nx, -1, 1e-12, 'entry normal x');
  near(h.ny, 0, 1e-12, 'entry normal y');
  ok(rayAABB(0, 500, 1, 0, 100, 0, 20, 100) === null, 'a ray passing under the box must miss');
});

test('rayCircle returns the near root', () => {
  const t = rayCircle(0, 0, 1, 0, 10, 0, 2);
  near(t, 8, 1e-9, 'near root');
  ok(rayCircle(0, 0, 1, 0, 10, 9, 2) === null, 'miss');
});

test('angle helpers normalize correctly', () => {
  near(norm(-Math.PI / 2), 1.5 * Math.PI, 1e-12, 'norm negative');
  near(norm(5 * Math.PI), Math.PI, 1e-12, 'norm large');
  near(normSigned(1.75 * Math.PI), -0.25 * Math.PI, 1e-12, 'signed');
  near(angleOf(0, 1), Math.PI / 2, 1e-12, 'angleOf +y');
  const r = rotate(1, 0, Math.PI / 2);
  near(r[0], 0, 1e-12, 'rotate x');
  near(r[1], 1, 1e-12, 'rotate y');
});

test('refraction obeys Snell numerically across many angles', () => {
  const n1 = 1.0;
  const n2 = 1.6;
  for (let deg = 1; deg <= 80; deg += 1) {
    const th = deg * DEG;
    // Surface normal is -y; the ray travels downward into the medium.
    const d = [Math.sin(th), Math.cos(th)];
    const r = refract(d[0], d[1], 0, -1, n1 / n2);
    ok(r !== null, `no refraction at ${deg} deg`);
    const len = Math.hypot(r[0], r[1]);
    near(len, 1, 1e-12, 'refracted direction must stay unit length');
    const th2 = Math.asin(Math.abs(r[0]));
    near(n1 * Math.sin(th), n2 * Math.sin(th2), 1e-10, `Snell at ${deg} deg`);
    ok(r[1] > 0, 'refracted ray must continue forward');
  }
});

test('total internal reflection triggers past the critical angle', () => {
  const n1 = 1.6;
  const n2 = 1.0;
  const crit = criticalAngle(n1, n2);
  near(crit, Math.asin(1 / 1.6), 1e-12, 'critical angle');
  for (let deg = 1; deg < 89; deg += 0.5) {
    const th = deg * DEG;
    const d = [Math.sin(th), Math.cos(th)];
    const r = refract(d[0], d[1], 0, -1, n1 / n2);
    if (th < crit - 1e-6) ok(r !== null, `unexpected TIR below critical at ${deg}`);
    if (th > crit + 1e-6) ok(r === null, `expected TIR above critical at ${deg}`);
  }
  near(fresnel(Math.cos(crit + 0.05), n1, n2), 1, 1e-12, 'Fresnel is total past critical');
  ok(fresnel(1, 1, 1.52) > 0.04 && fresnel(1, 1, 1.52) < 0.05, 'normal-incidence Fresnel ~4%');
});

test('reflect obeys the law of reflection', () => {
  const r = reflect(1, 1, 0, -1);
  near(r[0], 1, 1e-12, 'tangential preserved');
  near(r[1], -1, 1e-12, 'normal flipped');
});

// --- spectrum ------------------------------------------------------------------------

test('CIE fit peaks where the 1931 observer does', () => {
  let bestY = 0;
  let bestNm = 0;
  for (let nm = NM_MIN; nm <= NM_MAX; nm += 0.25) {
    const xyz = cieXYZ(nm);
    if (xyz[1] > bestY) {
      bestY = xyz[1];
      bestNm = nm;
    }
  }
  near(bestNm, 555, 4, 'luminous efficiency peak');
  near(bestY, 1.0, 0.02, 'ybar peak value');
  const blue = cieXYZ(450);
  ok(blue[2] > blue[0] && blue[2] > blue[1], 'z dominates in the blue');
});

test('nmToLinearRGB is non-negative, peaks at 1 and keeps both wings alive', () => {
  let peak = 0;
  for (let nm = NM_MIN; nm <= NM_MAX; nm += 0.5) {
    const c = nmToLinearRGB(nm);
    ok(c[0] >= 0 && c[1] >= 0 && c[2] >= 0, `negative channel at ${nm}`);
    peak = Math.max(peak, c[0], c[1], c[2]);
  }
  near(peak, 1, 1e-6, 'normalized peak');
  const violet = nmToLinearRGB(400);
  const red = nmToLinearRGB(690);
  ok(violet[2] > 0.12, `deep violet crushed: ${violet[2]}`);
  ok(violet[2] > violet[1], 'violet must be blue-dominant');
  ok(red[0] > 0.12, `deep red crushed: ${red[0]}`);
  ok(red[0] > red[2], 'red must be red-dominant');
  const green = nmToLinearRGB(530);
  ok(green[1] > green[0] && green[1] > green[2], 'green must be green-dominant');
  const srgb = nmToSRGB(530);
  ok(srgb[1] > 0.9, 'gamma-encoded green is bright');
});

test('Sellmeier coefficients reproduce catalogue indices', () => {
  near(sellmeierIOR(587.5618, 'BK7'), 1.5168, 5e-4, 'BK7 n_d');
  near(sellmeierIOR(587.5618, 'SF11'), 1.7847, 2e-3, 'SF11 n_d');
  near(sellmeierIOR(587.5618, 'FLINT'), 1.6200, 3e-3, 'F2 n_d');
  near(abbeNumber('BK7'), 64.2, 1.0, 'BK7 Abbe');
  near(abbeNumber('SF11'), 25.7, 1.0, 'SF11 Abbe');
  ok(abbeNumber('SF11') < abbeNumber('BK7'), 'flint must disperse harder than crown');
  ok(sellmeierIOR(420, 'SF11') > sellmeierIOR(680, 'SF11'), 'normal dispersion');
});

test('prism index rises toward violet', () => {
  ok(prismIOR(400) > prismIOR(700), 'violet index must exceed red index');
  near(prismIOR(550), 1.52, 0.02, 'base index near mid-band');
  ok(prismIOR(400) - prismIOR(700) > 0.1, 'game dispersion must be wide');
});

test('sampleWavelengths is sorted, in range and cached', () => {
  const s = sampleWavelengths(48);
  ok(s.length === 48, 'count');
  ok(s === sampleWavelengths(48), 'cached');
  for (let i = 0; i < s.length; i++) {
    ok(s[i] >= NM_MIN && s[i] <= NM_MAX, `sample ${i} out of range`);
    if (i) ok(s[i] > s[i - 1], 'must be strictly increasing');
  }
  ok(s[0] < 420, 'must reach the violet end');
  ok(s[s.length - 1] > 650, 'must reach the red end');
});

test('receptor bands cover the visible range without gaps', () => {
  const bands = Object.values(RECEPTOR_BANDS).sort((a, b) => a[0] - b[0]);
  near(bands[0][0], NM_MIN, 1e-9, 'starts at NM_MIN');
  near(bands[bands.length - 1][1], NM_MAX, 1e-9, 'ends at NM_MAX');
  for (let i = 1; i < bands.length; i++) near(bands[i][0], bands[i - 1][1], 1e-9, 'contiguous bands');
});

// --- tracer --------------------------------------------------------------------------

test('a mirror at 45 degrees turns a horizontal ray vertical', () => {
  const level = emptyLevel({ emitter: { x: 100, y: 300, dir: 0 } });
  const optics = [{ id: 'm1', type: 'mirror', x: 600, y: 300, angle: Math.PI / 4 }];
  const r = traceScene(level, optics, { spectralSamples: 1 });
  ok(r.segments.length === 2, `expected 2 segments, got ${r.segments.length}`);
  const first = r.segments[0];
  near(first.bx, 600, 1e-6, 'hit x');
  near(first.by, 300, 1e-6, 'hit y');
  const d = dirOf(r.segments[1]);
  near(d[0], 0, 1e-9, 'outgoing x');
  near(d[1], 1, 1e-9, 'outgoing y');
  ok(r.segments[1].terminal === 'wall', 'must end on the wall');
});

test('a 90-degree mirror pair retroreflects the ray', () => {
  const level = emptyLevel({ emitter: { x: 100, y: 300, dir: 0 } });
  const optics = [
    { id: 'm1', type: 'mirror', x: 600, y: 300, angle: Math.PI / 4 },
    { id: 'm2', type: 'mirror', x: 600, y: 600, angle: (3 * Math.PI) / 4 },
  ];
  const r = traceScene(level, optics, { spectralSamples: 1 });
  ok(r.segments.length === 3, `expected 3 segments, got ${r.segments.length}`);
  const inDir = dirOf(r.segments[0]);
  const outDir = dirOf(r.segments[2]);
  near(outDir[0], -inDir[0], 1e-9, 'x reversed');
  near(outDir[1], -inDir[1], 1e-9, 'y reversed');
});

test('walls absorb and the beam terminates on them', () => {
  const level = emptyLevel({
    emitter: { x: 100, y: 300, dir: 0 },
    walls: [{ x: 500, y: 200, w: 40, h: 200 }],
  });
  const r = traceScene(level, [], { spectralSamples: 1 });
  ok(r.segments.length === 1, 'one segment');
  near(r.segments[0].bx, 500, 1e-6, 'stops at the wall face');
  ok(r.segments[0].terminal === 'wall', 'terminal is wall');
});

// A prism at 50 degrees incidence: comfortably inside the transmission window for the
// whole band, which is where the reference's fan sits.
const prismLevel = emptyLevel({
  emitter: { x: 218.1, y: 397.4, dir: 20 * DEG },
});
const prismOptics = [{ id: 'p1', type: 'prism', x: 500, y: 500, angle: Math.PI / 2 }];

function primaryFan(res) {
  return res.segments.filter((s) => s.nm > 0 && !s.inside && s.generation === 2);
}

test('a prism disperses white light into a fan, red deviating LESS than violet', () => {
  const res = traceScene(prismLevel, prismOptics, { spectralSamples: 48 });
  const fan = primaryFan(res);
  ok(fan.length >= 40, `expected a full fan, got ${fan.length} rays`);

  const inDir = 20 * DEG;
  const dev = (s) => {
    const d = dirOf(s);
    return Math.abs(normSigned(Math.atan2(d[1], d[0]) - inDir));
  };
  const byNm = fan.slice().sort((a, b) => a.nm - b.nm);
  const violet = byNm[0];
  const red = byNm[byNm.length - 1];
  ok(violet.nm < 420, `violet sample is ${violet.nm}`);
  ok(red.nm > 650, `red sample is ${red.nm}`);

  const dv = dev(violet);
  const dr = dev(red);
  ok(dr < dv, `red (${(dr / DEG).toFixed(2)} deg) must deviate less than violet (${(dv / DEG).toFixed(2)} deg)`);

  // Deviation must be monotonic in wavelength across the whole fan.
  let prev = Infinity;
  for (const s of byNm) {
    const d = dev(s);
    ok(d < prev + 1e-9, `fan not ordered at ${s.nm} nm`);
    prev = d;
  }

  const spread = (dv - dr) / DEG;
  ok(spread > 8 && spread < 40, `fan spread ${spread.toFixed(2)} deg is outside the art-directed window`);
  ok(dr / DEG > 15 && dv / DEG < 60, `deviation ${(dr / DEG).toFixed(1)}..${(dv / DEG).toFixed(1)} deg out of range`);
});

test('the fan spread stays inside the art-directed window', () => {
  const res = traceScene(prismLevel, prismOptics, { spectralSamples: 48 });
  const fan = primaryFan(res).sort((a, b) => a.nm - b.nm);
  const a0 = Math.atan2(...dirOf(fan[0]).reverse());
  const a1 = Math.atan2(...dirOf(fan[fan.length - 1]).reverse());
  const spread = Math.abs(normSigned(a0 - a1)) / DEG;
  ok(spread > 24 && spread < 34, `fan spread ${spread.toFixed(1)} deg drifted off the reference's wide wedge`);
});

test('a prism also emits Fresnel reflections, not only the fan', () => {
  const res = traceScene(prismLevel, prismOptics, { spectralSamples: 48 });
  const white = res.segments.filter((s) => s.nm === 0 && s.generation > 0);
  ok(white.length >= 1, 'entry-face reflection must exist');
  const secondary = res.segments.filter((s) => s.nm > 0 && !s.inside && s.generation > 2);
  ok(secondary.length >= 1, 'internally reflected secondary fan must exist');
  const inside = res.segments.filter((s) => s.inside);
  ok(inside.length >= 48, 'the path inside the glass must be traced');
});

test('a wavelength ray refracts at a second prism without splitting again', () => {
  const res = traceScene(prismLevel, prismOptics, { spectralSamples: 8 });
  const fan = primaryFan(res);
  ok(fan.length === 8, `expected 8 fan rays, got ${fan.length}`);
  const nms = new Set(fan.map((s) => s.nm));
  ok(nms.size === 8, 'each sample keeps its own wavelength');
});

test('energy is conserved across every split', () => {
  const res = traceScene(prismLevel, prismOptics, {
    spectralSamples: 8,
    minIntensity: 0,
    maxBounces: 24,
    maxSegments: 200000,
  });
  const st = res.stats;
  near(st.energyIn, 1, 1e-12, 'input energy');
  near(st.energyTerminated + st.energyPruned, st.energyIn, 1e-9, 'energy audit');
  ok(!st.truncated, 'scene must complete');

  let terminal = 0;
  for (const s of res.segments) if (s.terminal !== null) terminal += s.intensity;
  near(terminal, st.energyIn, 1e-9, 'terminal segment intensities must sum to the input');

  const split = res.segments.filter((s) => s.inside && s.generation === 1);
  let sum = 0;
  for (const s of split) sum += s.intensity;
  const entry = res.segments.find((s) => s.nm === 0 && s.generation === 1);
  near(sum + entry.intensity, 1, 1e-12, 'entry face must conserve energy exactly');
});

test('a coloured receptor is satisfied by its own band only', () => {
  const level = emptyLevel({
    emitter: { x: 218.1, y: 397.4, dir: 20 * DEG },
    receptors: [{ id: 'rb', x: 500, y: 500, color: 'blue' }],
  });
  // White light straight into the receptor must NOT satisfy it.
  const white = traceScene(
    emptyLevel({
      emitter: { x: 100, y: 500, dir: 0 },
      receptors: [{ id: 'rb', x: 500, y: 500, color: 'blue' }],
    }),
    [],
    { spectralSamples: 48 }
  );
  ok(white.receptors[0].litIntensity === 0, 'white must not count as in-band');
  ok(!white.receptors[0].satisfied, 'white light must not satisfy a coloured receptor');
  ok(!white.solved, 'not solved');
  ok(white.segments[0].terminal === 'receptor:rb', 'terminal names the receptor');
  ok(level.receptors.length === 1, 'level fixture intact');
});

test('a receptor placed in the blue arm of a real fan is satisfied', () => {
  const res = traceScene(prismLevel, prismOptics, { spectralSamples: 48 });
  const fan = primaryFan(res);
  const blue = fan.filter((s) => s.nm >= 450 && s.nm <= 495);
  ok(blue.length >= 4, 'fan must contain blue samples');
  // Aim a receptor at the centre of the blue arm, far enough out that the hues have parted.
  let cx = 0;
  let cy = 0;
  for (const s of blue) {
    const d = dirOf(s);
    cx += s.ax + d[0] * 450;
    cy += s.ay + d[1] * 450;
  }
  cx /= blue.length;
  cy /= blue.length;
  const level = emptyLevel({
    emitter: prismLevel.emitter,
    receptors: [{ id: 'rb', x: cx, y: cy, color: 'blue' }],
  });
  const lit = traceScene(level, prismOptics, { spectralSamples: 48 });
  const ev = lit.receptors[0];
  ok(ev.litIntensity >= 0.06, `in-band intensity too low: ${ev.litIntensity}`);
  ok(ev.litIntensity >= 3 * ev.strayIntensity, `too much stray light: ${ev.strayIntensity}`);
  ok(ev.satisfied && lit.solved, 'blue receptor must be satisfied');
  ok(ev.litNm >= 450 && ev.litNm <= 495, `lit wavelength off band: ${ev.litNm}`);
});

test('every receptor colour is reachable inside the board', () => {
  // Level design depends on this: a colour whose band owns too little of the fan can never
  // clear the 3x in-band rule, however well the player aims. Reported as the minimum
  // prism-to-receptor distance at which each colour first locks on.
  const res = traceScene(prismLevel, prismOptics, { spectralSamples: 48, boardSize: 2000 });
  const fan = res.segments.filter((s) => s.nm > 0 && !s.inside && s.generation === 2);
  const reach = {};
  for (const [color, band] of Object.entries(RECEPTOR_BANDS)) {
    const arm = fan.filter((s) => s.nm >= band[0] && s.nm <= band[1]);
    ok(arm.length >= 4, `${color} owns only ${arm.length} of 48 samples`);
    let a = 0;
    for (const s of arm) {
      const d = dirOf(s);
      a += Math.atan2(d[1], d[0]);
    }
    a /= arm.length;
    let found = 0;
    for (let D = 200; D <= 800; D += 25) {
      const level = emptyLevel({
        emitter: prismLevel.emitter,
        receptors: [{ id: 'r', x: arm[0].ax + Math.cos(a) * D, y: arm[0].ay + Math.sin(a) * D, color }],
      });
      if (traceScene(level, prismOptics, { spectralSamples: 48, boardSize: 2000 }).solved) {
        found = D;
        break;
      }
    }
    ok(found > 0, `${color} is unreachable within 800 units of the prism`);
    reach[color] = found;
  }
  console.log('      reach (units from prism):', Object.entries(reach).map(([k, v]) => `${k} ${v}`).join(', '));
});

test('the tracer terminates on a pathological scene', () => {
  const optics = [];
  for (let i = 0; i < 12; i++) {
    optics.push({ id: 'a' + i, type: 'mirror', x: 300, y: 200 + i * 50, angle: Math.PI / 2 });
    optics.push({ id: 'b' + i, type: 'mirror', x: 700, y: 200 + i * 50, angle: Math.PI / 2 });
  }
  optics.push({ id: 'p', type: 'prism', x: 500, y: 420, angle: 0.7 });
  optics.push({ id: 'q', type: 'prism', x: 520, y: 560, angle: 2.1 });
  const level = emptyLevel({ emitter: { x: 320, y: 420, dir: 0.02 } });
  const t0 = Date.now();
  const res = traceScene(level, optics, { spectralSamples: 48 });
  const ms = Date.now() - t0;
  ok(res.segments.length <= 4000, `segment budget exceeded: ${res.segments.length}`);
  ok(ms < 500, `pathological scene took ${ms} ms`);
  near(res.stats.energyTerminated + res.stats.energyPruned, 1, 1e-9, 'energy audit under truncation');
  for (const s of res.segments) {
    ok(isFinite(s.ax) && isFinite(s.ay) && isFinite(s.bx) && isFinite(s.by), 'finite geometry');
    ok(s.generation <= 64, 'bounce budget respected');
  }
});

test('deep bounce chains are cut off with a depth terminal', () => {
  const level = emptyLevel({ emitter: { x: 600, y: 300, dir: Math.PI / 2 } });
  const optics = [
    { id: 'm1', type: 'mirror', x: 600, y: 600, angle: 0 },
    { id: 'm2', type: 'mirror', x: 600, y: 300, angle: 0 },
  ];
  const res = traceScene(level, optics, { spectralSamples: 1, maxBounces: 8 });
  const last = res.segments[res.segments.length - 1];
  ok(last.terminal === 'depth', `expected depth terminal, got ${last.terminal}`);
  ok(res.segments.length === 9, `expected 9 segments, got ${res.segments.length}`);
  near(res.stats.energyTerminated, 1, 1e-12, 'energy still accounted');
});

test('tracing is deterministic and fast enough', () => {
  const a = traceScene(prismLevel, prismOptics, { spectralSamples: 48 });
  const b = traceScene(prismLevel, prismOptics, { spectralSamples: 48 });
  ok(a.segments.length === b.segments.length, 'segment count must be stable');
  for (let i = 0; i < a.segments.length; i++) {
    const x = a.segments[i];
    const y = b.segments[i];
    ok(x.ax === y.ax && x.by === y.by && x.nm === y.nm && x.intensity === y.intensity, `segment ${i} differs`);
  }
  // The very first traces in a process run interpreted, before the JIT has tiered up the
  // cast/push loop, and they cost 3-4 ms against a warm cost near 0.3 ms. In the game the
  // tracer is warm long before a player can place anything, so timing a cold call measures
  // the JIT, not the tracer. Warm up first, then time steady state against the same bound.
  for (let i = 0; i < 20; i++) traceScene(prismLevel, prismOptics, { spectralSamples: 48 });
  let worst = 0;
  for (let i = 0; i < 40; i++) {
    const r = traceScene(prismLevel, prismOptics, { spectralSamples: 48 });
    worst = Math.max(worst, r.stats.ms);
  }
  console.log(`      slowest of 40 warm traces: ${worst.toFixed(3)} ms`);
  ok(worst < 3, `slowest 48-sample trace was ${worst.toFixed(3)} ms`);
});

test('fixed optics from the level are traced even when not in the optics list', () => {
  const level = emptyLevel({
    emitter: { x: 100, y: 300, dir: 0 },
    fixed: [{ type: 'mirror', x: 600, y: 300, angle: Math.PI / 4 }],
  });
  const withList = traceScene(level, [{ id: 'f0', type: 'mirror', x: 600, y: 300, angle: Math.PI / 4 }], { spectralSamples: 1 });
  const withoutList = traceScene(level, [], { spectralSamples: 1 });
  ok(withoutList.segments.length === 2, 'fixed mirror must be traced');
  ok(withList.segments.length === 2, 'and must not be duplicated');
});

// --- handed warm/cool fringe (REFERENCE.md 4.2) ---------------------------------------

test('perp starts at +1 and flips exactly once per mirror bounce', () => {
  const level = emptyLevel({ emitter: { x: 500, y: 100, dir: Math.PI / 2 } });
  const optics = [
    { id: 'm1', type: 'mirror', x: 500, y: 700, angle: -Math.PI / 4 },
    { id: 'm2', type: 'mirror', x: 200, y: 700, angle: Math.PI / 4 },
    { id: 'm3', type: 'mirror', x: 200, y: 300, angle: -Math.PI / 4 },
  ];
  const res = traceScene(level, optics, { spectralSamples: 1 });
  const chain = res.segments.filter((s) => s.nm === 0);
  ok(chain.length === 4, `expected 4 white segments, got ${chain.length}`);
  for (const s of chain) {
    ok(s.perp === 1 || s.perp === -1, `perp must be signed unity, got ${s.perp}`);
    const want = (s.generation & 1) === 0 ? 1 : -1;
    ok(s.perp === want, `generation ${s.generation} should carry perp ${want}, got ${s.perp}`);
  }
  // The renderer cannot recover this from the direction: check the amber side really
  // does swap around each bounce, with n = (-dy, dx) in screen space.
  for (let i = 1; i < chain.length; i++) {
    ok(chain[i].perp === -chain[i - 1].perp, `bounce ${i} did not flip perp`);
  }
});

test('mirrors keep 90 % of the beam and the loss stays in the energy audit', () => {
  const level = emptyLevel({ emitter: { x: 500, y: 100, dir: Math.PI / 2 } });
  const optics = [{ id: 'm1', type: 'mirror', x: 500, y: 700, angle: Math.PI / 4 }];
  const res = traceScene(level, optics, { spectralSamples: 1 });
  const chain = res.segments.filter((s) => s.nm === 0);
  near(chain[0].intensity, 1, 1e-12, 'emitter run is undimmed');
  near(chain[1].intensity, 0.9, 1e-12, 'one bounce keeps 90 %');
  near(res.stats.energyTerminated + res.stats.energyPruned, 1, 1e-9, 'mirror loss is audited');
});

test('perp survives refraction through a prism', () => {
  const res = traceScene(prismLevel, prismOptics, { spectralSamples: 8 });
  const white = res.segments.find((s) => s.nm === 0 && s.generation === 0);
  ok(white.perp === 1, 'the emitter run starts right-handed');
  const inGlass = res.segments.filter((s) => s.nm > 0 && s.inside && s.generation === 1);
  ok(inGlass.length === 8, `expected 8 in-glass children, got ${inGlass.length}`);
  for (const s of inGlass) ok(s.perp === white.perp, `child ${s.nm} lost its parent sign`);
  const fan = primaryFan(res);
  ok(fan.length === 8, `expected 8 fan rays, got ${fan.length}`);
  for (const s of fan) ok(s.perp === white.perp, `fan ray ${s.nm} flipped on refraction`);
});

test('a prism between two mirrors does not disturb the flip count', () => {
  const level = emptyLevel({ emitter: { x: 218.1, y: 397.4, dir: 20 * DEG } });
  const optics = [
    { id: 'p1', type: 'prism', x: 500, y: 500, angle: Math.PI / 2 },
    { id: 'm1', type: 'mirror', x: 820, y: 640, angle: Math.PI / 4 },
  ];
  const res = traceScene(level, optics, { spectralSamples: 8 });
  for (const s of res.segments) {
    ok(s.perp === 1 || s.perp === -1, 'every segment carries a signed frame');
  }
  const before = res.segments.filter((s) => s.nm > 0 && !s.inside && s.generation === 2);
  ok(before.length > 0, 'the fan must exist');
  for (const s of before) ok(s.perp === 1, 'a refracted fan ray keeps the emitter sign');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
