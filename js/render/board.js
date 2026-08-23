// Board renderer: brick walls lit by the beam, emitter housing, receptors, optic sprites, ghost and protractor.

import * as glmod from './gl.js';
import * as textures from './textures.js';
import * as spectrum from '../optics/spectrum.js';

const BOARD = 1000;
const WALL_T = 40;

const BRICK_LEN = 37.0;
const COURSE_H = 12.9;
const JOINT_W = 1.8;

const MIRROR_LEN = 110;
const MIRROR_T = 14;
const PRISM_SIDE = 75;
const PRISM_R = PRISM_SIDE / Math.sqrt(3.0);

const RING_R = 67;
const HANDLE_R = 8.35;
// REFERENCE.md 6.3: the disc carries a ~1.5 px dark outline. That outline is what makes the
// hairline ring read as passing *behind* the handle instead of through it, so it is drawn as
// a real occluder rather than as a multiply on an additive pass.
const HANDLE_COLLAR = 2.6;
const READOUT_CAP = 6.0;
const READOUT_GAP = 8.0;

const RECEPTOR_R = 29;
const RECEPTOR_STROKE = 7.9;
// The pool has to reach far enough to BE the floor light — nothing else shades the floor.
const RECEPTOR_HALO = RECEPTOR_R + 132;
const POLE_H = 77.5;
const POLE_W = 5.3;
// Measured off ref_001.jpg by thresholding the blue pennant (rows 534-549, x 458-490): the
// cloth is about 32 x 15 css px. The size was never the real defect — the SHAPE was. The
// reference pennant is deep at the hoist and tapers to a near point at the fly; ours was a
// constant-thickness ribbon that only narrowed to 54 %, which reads as a poster chip.
const FLAG_W = 57.0;
const FLAG_H = 27.0;

// REFERENCE.md 4.4: a machined grey housing box with a slit at its mouth that is brighter
// than the beam it feeds. The reference's block is 30 u long, but our beam's start cap is
// round and reaches back past the emitter origin, so a 30 u block would sit entirely inside
// the cap and never be seen — hence the housing is grown backwards until it buries itself
// in the wall behind it, which is also how the reference's reads: a fixture, not a highlight.
const EMITTER_W = 52;
const EMITTER_MIN_LEN = 78;
const EMITTER_MAX_LEN = 150;
const EMITTER_BURY = 14;
const SLIT_SPAN = 29;

const MAX_LIGHTS = 16;
const PLACE_MS = 150;

const TWO_PI = Math.PI * 2;
const SQRT1_2 = Math.SQRT1_2;

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// Inverse of the Narkowicz ACES fit, so measured display colours can be authored as scene radiance.
function inverseTonemap(y) {
  const v = Math.min(Math.max(y, 0), 0.9995);
  const a = 2.51 - 2.43 * v;
  const b = 0.03 - 0.59 * v;
  const c = -0.14 * v;
  const disc = b * b - 4 * a * c;
  if (disc <= 0 || Math.abs(a) < 1e-6) return Math.max(0, -c / Math.max(b, 1e-6));
  return Math.max(0, (-b + Math.sqrt(disc)) / (2 * a));
}

function hexRGB(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function scene(hex, gain) {
  const g = gain === undefined ? 1 : gain;
  const c = hexRGB(hex);
  return new Float32Array([
    inverseTonemap(srgbToLinear(c[0])) * g,
    inverseTonemap(srgbToLinear(c[1])) * g,
    inverseTonemap(srgbToLinear(c[2])) * g,
  ]);
}

// Measured off ref_001.jpg: the reference brick face averages (126, 88, 81) sRGB with a
// spread of about 32 levels between neighbouring bricks, and its mortar sits only ~10
// levels off the face. Ours used to render at (146, 106, 98) with mortar 48 levels hot,
// which is what made the wall read as one flat salmon fill with a pale grid pasted on.
const BRICK_LIGHT = scene('#87635B');
const BRICK_MID = scene('#7A4F49');
const BRICK_DARK = scene('#673D36');
const BRICK_RIM = scene('#785854');
const MORTAR = scene('#A47E76');

const HOUSING = scene('#5C5A64');
const HOUSING_EDGE = scene('#B6B4BE');
const SLIT = scene('#E0DEE1', 3.0);

const MIRROR_BODY = scene('#8F9AA6', 0.85);
const MIRROR_BACK = scene('#2A2E36');
const MIRROR_SPEC = scene('#FFFFFF', 0.17);
const MIRROR_GLOW = scene('#C4CEDA', 0.30);
const GLASS_EDGE = scene('#B9C4CE', 1.15);

const PROTRACTOR = scene('#8A7A78');
const READOUT = scene('#9A9298');

// A matte disc, not a lamp. scene('#F8F8F8') would be ~2.5 scene units, which is 3.5x over
// the bloom prefilter threshold (0.72) and blows a 16 px halo that erases the ring and the
// mirror's end cap underneath. At 0.95 the disc still lands at 245/255 after bloom — REFERENCE.md 6.3
// measures 248 — while its bloom contribution drops by roughly six times.
const HANDLE_FILL = new Float32Array([0.95, 0.93, 0.90]);

// Rejected placement. The ghost keeps its real silhouette, but the body stays a dark,
// desaturated slate and only its contour and aura go red: a saturated red *body* sits in
// the same colour family as the red receptor's #F96060, so a refusal could be read as a
// coloured optic. A dead grey rod with a red outline cannot be read as anything but "no".
const REJECT_BODY = scene('#4A3E40');
const REJECT_BACK = scene('#181113');
const REJECT_SPEC = scene('#FFB0A8', 0.05);
const REJECT_GLOW = scene('#E85A52', 0.16);
const REJECT_EDGE = scene('#E8665E', 0.55);

// Flags are cloth hanging beside a lamp, not a second lamp. Measured on ref_001.jpg, rows
// 540-546: the reference pennants render at sRGB (21,57,120) blue, (73,126,73) green and
// (102,59,22) orange — luminance 53, 104, 68 — against ours at 111 (cyan) and 130 (green),
// so our cloth competed with its own ring. The shader's fold and rim terms multiply the
// authored colour up by about 1.25x, so each unlit entry is authored at the measured
// reference colour divided by 1.25, and the old unlit colour becomes the LIT one.
const RECEPTORS = {
  blue: { ring: [scene('#26549C'), scene('#43AAF9', 1.15)], flag: [scene('#112E60'), scene('#2E5CAE')] },
  green: { ring: [scene('#6EAF74'), scene('#B1F5B5', 1.15)], flag: [scene('#3A653A'), scene('#5C9A60')] },
  orange: { ring: [scene('#9C682C'), scene('#EDB950', 1.15)], flag: [scene('#522F12'), scene('#A8683A')] },
  red: { ring: [scene('#9C3030'), scene('#F96060', 1.15)], flag: [scene('#602020'), scene('#B23636')] },
  yellow: { ring: [scene('#9C9330'), scene('#F5E85C', 1.15)], flag: [scene('#605A20'), scene('#9E9438')] },
  cyan: { ring: [scene('#2A9098'), scene('#5CE8F5', 1.15)], flag: [scene('#20585E'), scene('#2FA0AB')] },
  violet: { ring: [scene('#6A3A9C'), scene('#B47CF9', 1.15)], flag: [scene('#442464'), scene('#7448B0')] },
};
const POLE = [scene('#7A8FAD'), scene('#AFC5F6', 1.05)];

const WHITE_LIGHT = [1.0, 0.94, 0.84];

const VS = `#version 300 es
layout(location = 0) in vec2 aPos;
uniform mat3 uView;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform vec2 uRot;
out vec2 vLocal;
out vec2 vBoard;
void main() {
  vec2 l = (aPos * 2.0 - 1.0) * uHalf;
  vLocal = l;
  vec2 w = uCenter + vec2(l.x * uRot.x - l.y * uRot.y, l.x * uRot.y + l.y * uRot.x);
  vBoard = w;
  vec3 c = uView * vec3(w, 1.0);
  gl_Position = vec4(c.xy, 0.0, 1.0);
}`;

const FS_HEAD = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec2 vBoard;
uniform float uPx;
uniform vec2 uHalf;
out vec4 fragColor;
float aa(float d) { return clamp(0.5 - d / uPx, 0.0, 1.0); }
// Kills any soft falloff before it reaches the quad border, so no sprite shows its bounds.
float window() {
  float b = min(uHalf.x - abs(vLocal.x), uHalf.y - abs(vLocal.y));
  return smoothstep(0.0, 9.0, b);
}
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`;

// Proximity lighting: REFERENCE.md 10.2 item 1. The reference spills no light at all onto
// its brick; we accumulate a bounded set of nearby beam segments per fragment, each already
// tinted by its own wavelength on the CPU side, with a cheap inverse-square-plus-exponential
// falloff. Bounded at MAX_LIGHTS so the cost never scales with the number of traced segments.
const LIGHT_BLOCK = `
uniform int uLightCount;
uniform vec4 uLightSeg[${MAX_LIGHTS}];
uniform vec4 uLightCol[${MAX_LIGHTS}];
vec3 gatherLight(vec2 p, vec2 n) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    vec4 s = uLightSeg[i];
    vec2 pa = p - s.xy, ba = s.zw - s.xy;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    vec2 q = s.xy + ba * h;
    vec2 dv = q - p;
    float d = length(dv);
    float att = 1.0 / (1.0 + (d / 74.0) * (d / 74.0));
    att *= exp(-d / 300.0);
    float lam = max(dot(n, dv / max(d, 1e-4)), 0.0);
    sum += uLightCol[i].rgb * uLightCol[i].a * att * (0.42 + 0.58 * lam);
  }
  return min(sum, vec3(4.0));
}`;

const FS_WALL = `${FS_HEAD}
uniform vec2 uSize;
uniform float uHoriz;
// Per-face state, in the wall's own frame, ordered (-X, +X, -Y, +Y):
//   0 = joined      this face butts into another wall; draw straight through it
//   1 = open        this face looks into the room; darken through it and bleed onto the floor
//   2 = outer       this face is the board's outer boundary; give it a lit lip
uniform vec4 uFace;
// Per-face overlap in the same order, so a joined edge has no antialiased seam.
uniform vec4 uGrow;
// Corner mitres, ordered (-X-Y, +X-Y, -X+Y, +X+Y). The outer ring is four rectangles but
// the reference's frame is one continuous run of brick, mitred at every corner.
uniform vec4 uMitre;
uniform vec3 uLight;
uniform vec3 uMid;
uniform vec3 uDark;
uniform vec3 uRim;
uniform vec3 uMortar;
uniform sampler2D uDetail;
uniform float uDetailMix;
${LIGHT_BLOCK}
float cornerSeam(float a, float b) {
  float within = step(a, ${WALL_T.toFixed(1)}) * step(b, ${WALL_T.toFixed(1)});
  return within * exp(-pow((a - b) / 1.7, 2.0));
}
void main() {
  vec2 h = uSize * 0.5;
  vec2 lo = -h - vec2(uGrow.x, uGrow.z);
  vec2 hi = h + vec2(uGrow.y, uGrow.w);
  vec2 ctr = (lo + hi) * 0.5;
  vec2 ext = (hi - lo) * 0.5;
  vec2 q = abs(vLocal - ctr) - ext;
  float sd = min(max(q.x, q.y), 0.0) + length(max(q, 0.0));
  float body = aa(sd);

  vec4 dist = vec4(vLocal.x + h.x, h.x - vLocal.x, vLocal.y + h.y, h.y - vLocal.y);
  float thick = mix(uSize.x, uSize.y, uHoriz);
  float t = clamp(mix(dist.x, dist.z, uHoriz) / max(thick, 1e-3), 0.0, 1.0);

  // The bond lives in BOARD space and in ONE orientation for the whole board. Swapping the
  // axes per wall (which is what uHoriz used to do here) rotated the running bond 90 degrees
  // on every wall taller than it is wide, so the bond broke at all four corners of the frame
  // and on half the interior walls. A real wall is laid once; only the *thickness* shading
  // above and the face normal below are allowed to know which way this rectangle runs.
  float u = vBoard.x;
  float v = vBoard.y;

  float course = floor(v / ${COURSE_H.toFixed(2)});
  float rowOff = mod(course, 2.0) * ${(BRICK_LEN * 0.5).toFixed(3)};
  float bu = u + rowOff;
  float bIdx = floor(bu / ${BRICK_LEN.toFixed(2)});
  float fu = bu - bIdx * ${BRICK_LEN.toFixed(2)};
  float fv = v - course * ${COURSE_H.toFixed(2)};

  // The slab is a rounded extrusion: brightest close to either face, dimmest in the belly.
  // Measured on ref_001.jpg, rows 58-72 of the top band: 133 at the faces, 118 mid-slab.
  float belly = 1.0 - abs(t - 0.5) * 2.0;
  vec3 col = mix(uLight, uMid, smoothstep(0.05, 0.62, belly) * 0.75);
  col = mix(col, uDark, smoothstep(0.5, 1.0, belly) * 0.22);
  col = mix(col, uRim, smoothstep(0.20, 0.0, belly) * 0.25);

  // Per-brick tone. Measured on ref_001.jpg the reference's top band runs std/mean 0.089
  // across the whole band; a +/-13 % walk here alone overshot that, so the walk is halved.
  float r1 = hash21(vec2(bIdx, course) + 0.13);
  float r2 = hash21(vec2(bIdx, course) * 1.71 + 5.37);
  col *= 0.9095 + 0.170 * r1;
  col.r *= 1.0 + (r2 - 0.5) * 0.055;
  col.b *= 1.0 - (r2 - 0.5) * 0.065;

  float grit = vnoise(vec2(u, v) * 1.35 + vec2(bIdx * 7.0, course * 11.0));
  float fine = vnoise(vec2(u, v) * 6.1 + vec2(19.7, 3.3));
  col *= 0.946 + 0.062 * grit + 0.030 * fine;

  // The detail tile is 4 bricks by 12 courses; sampling it at four courses used to stretch
  // it 3x and scramble the per-brick tone it carries.
  vec3 det = texture(uDetail, vec2(u / ${(BRICK_LEN * 4.0).toFixed(2)}, v / ${(COURSE_H * 12.0).toFixed(2)})).rgb;
  float detL = dot(det, vec3(0.299, 0.587, 0.114));
  col *= mix(1.0, 0.66 + 0.68 * detL, uDetailMix);

  // Mortar is lighter than the brick face but only just: ~10 levels in the reference, with
  // a thin shadow line down the middle of the joint. REFERENCE.md 2.2.
  float jx = min(fu, ${BRICK_LEN.toFixed(2)} - fu);
  float jy = min(fv, ${COURSE_H.toFixed(2)} - fv);
  float je = min(jx, jy * 1.08);
  float joint = 1.0 - smoothstep(0.0, ${JOINT_W.toFixed(2)}, je);
  vec3 mortar = mix(uMortar, col * 1.05, 0.44);
  col = mix(col, mortar, joint * 0.70);
  col *= 1.0 - 0.06 * (1.0 - smoothstep(0.0, ${(JOINT_W * 0.40).toFixed(2)}, je));

  vec3 albedo = col;

  // Open faces: darken through the last few units of brick. The reference spends 128 -> 113
  // -> 42 -> 16 -> 6 across the inner course and only then reaches the floor.
  vec4 open = clamp(1.0 - abs(uFace - 1.0), 0.0, 1.0);
  vec4 outer = clamp(uFace - 1.0, 0.0, 1.0);
  vec4 ramp = smoothstep(vec4(6.5), vec4(0.0), dist);
  float darkK = max(max(ramp.x * open.x, ramp.y * open.y), max(ramp.z * open.z, ramp.w * open.w));
  col *= 1.0 - 0.36 * darkK * darkK;

  // Outer faces get the lit lip the reference shows on the board's outside edge.
  vec4 lipR = smoothstep(vec4(5.0), vec4(0.4), dist);
  float lipK = max(max(lipR.x * outer.x, lipR.y * outer.y), max(lipR.z * outer.z, lipR.w * outer.w));
  col *= 1.0 + 0.36 * lipK;

  float mit = max(max(uMitre.x * cornerSeam(dist.x, dist.z), uMitre.y * cornerSeam(dist.y, dist.z)),
                  max(uMitre.z * cornerSeam(dist.x, dist.w), uMitre.w * cornerSeam(dist.y, dist.w)));
  col *= 1.0 - 0.26 * mit;

  vec2 nrm = mix(vec2(open.y - open.x, 0.0), vec2(0.0, open.w - open.z), uHoriz);
  if (dot(nrm, nrm) < 0.01) nrm = mix(vec2(sign(vLocal.x), 0.0), vec2(0.0, sign(vLocal.y)), uHoriz);
  nrm = normalize(nrm + vec2(1e-5));
  vec3 lit = gatherLight(vBoard, nrm);
  col = col * (1.0 + 0.85 * lit) + lit * col * 0.9 + lit * 0.10;

  // Contact bleed: brick this warm does not stop dead at its own edge. Only open faces
  // spill, so the outer boundary of the board stays a hard edge.
  float sideX = mix(open.x, open.y, step(0.0, vLocal.x));
  float sideY = mix(open.z, open.w, step(0.0, vLocal.y));
  float openOut = clamp(step(0.001, q.x) * sideX + step(0.001, q.y) * sideY, 0.0, 1.0);
  float outd = max(sd, 0.0);
  // Measured on ref_001.jpg: the first floor pixel past the wall reads 57 % of the brick
  // face, then decays to 1 over about 8 css px. Keying it off the LIT face rather than the
  // raw albedo keeps it below the brick at every brightness, so a wall standing in a beam
  // never grows a glowing outline around a black border.
  vec3 warm = albedo * (1.0 + 0.85 * lit) + lit * 0.06;
  vec3 bleed = warm * openOut * (0.52 * exp(-outd / 3.6) + 0.16 * exp(-outd / 10.0)) * (1.0 - body);

  fragColor = vec4(col * body + bleed, body);
}`;

// A machined block: flat fill, a one-unit lighter lip on the faces that point at the key
// light, a darker one on the faces that turn away. uLitDir is the top-left key expressed in
// the box's own rotated frame, so the shading stays anchored to the board, not to the sprite.
const FS_BOX = `${FS_HEAD}
uniform vec2 uSize;
uniform vec3 uFill;
uniform vec3 uEdge;
uniform vec2 uLitDir;
uniform float uLightGain;
${LIGHT_BLOCK}
void main() {
  vec2 h = uSize * 0.5;
  vec2 d = abs(vLocal) - h;
  float sd = min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
  float a = aa(sd);
  float inset = -sd;

  vec2 face = d.x > d.y ? vec2(sign(vLocal.x), 0.0) : vec2(0.0, sign(vLocal.y));
  float facing = clamp(-dot(face, uLitDir), 0.0, 1.0);

  float along = clamp(dot(vLocal, uLitDir) / max(length(h), 1e-3), -1.0, 1.0);
  vec3 col = uFill * (0.82 + 0.30 * (-along));

  float lip = smoothstep(1.5, 0.2, inset) * facing;
  col = mix(col, uEdge, lip * 0.90);

  float shadowEdge = smoothstep(2.0, 0.3, inset) * (1.0 - facing);
  col *= 1.0 - 0.45 * shadowEdge;

  vec2 nrm = normalize(vLocal + vec2(1e-4));
  col += uFill * gatherLight(vBoard, nrm) * uLightGain;
  fragColor = vec4(col * a, a);
}`;

const FS_GLOW = `${FS_HEAD}
uniform vec2 uSpan;
uniform float uRadius;
uniform vec3 uColor;
uniform float uPower;
void main() {
  float d = sdSeg(vLocal, vec2(-uSpan.x, -uSpan.y), vec2(uSpan.x, uSpan.y));
  float k = clamp(1.0 - d / max(uRadius, 1e-3), 0.0, 1.0);
  float f = pow(k, uPower) * window();
  fragColor = vec4(uColor * f, 0.0);
}`;

const FS_SLIT = `${FS_HEAD}
uniform vec2 uSpan;
uniform float uWidth;
uniform vec3 uColor;
void main() {
  float d = sdSeg(vLocal, vec2(-uSpan.x, -uSpan.y), vec2(uSpan.x, uSpan.y));
  float core = clamp(1.0 - d / uWidth, 0.0, 1.0);
  float body = pow(core, 0.55);
  float halo = exp(-d / (uWidth * 2.0)) * 0.22;
  fragColor = vec4(uColor * (body + halo) * window(), 0.0);
}`;

const FS_RECEPTOR = `${FS_HEAD}
uniform vec3 uRing;
uniform float uLit;
uniform float uRadius;
uniform float uStroke;
uniform float uTime;
void main() {
  float d = length(vLocal);
  float e = abs(d - uRadius);

  // A receptor is a lamp that is already on. ORCHESTRATOR-NOTES.md section 2: satisfaction
  // is an increase, never a switch from dark to lit. The idle state therefore breathes
  // instead of sitting perfectly static.
  float breathe = 1.0 + 0.055 * sin(uTime * 1.6 + uRadius * 0.11);
  float amp = mix(breathe, 1.20, uLit);

  float core = exp(-pow(e / (uStroke * 0.40), 2.0));
  float glow = exp(-e / mix(3.8, 6.4, uLit)) * mix(0.38, 0.60, uLit);

  // Interior. Measured on ref_001.jpg the reference reads 39 % of the stroke peak at dead
  // centre and climbs outward to about 55 % just inside the stroke; ours used to read 15 %
  // and get DARKER toward the middle, which is the whole reason it looked like an icon.
  float ri = clamp(d / max(uRadius, 1e-3), 0.0, 1.0);
  float discCut = 1.0 - smoothstep(uRadius - uStroke * 0.30, uRadius + uStroke * 0.70, d);
  float disc = mix(0.32, 0.52, pow(ri, 1.4)) * discCut * mix(1.0, 1.30, uLit);

  // Outer pool. Fitted to the reference's radial profile out of the stroke (75 % at 3 px,
  // 55 % at 6 px, 45 % at 9 px, still readable 20 px out) as a near and a far lobe. This
  // pool IS the floor light: nothing else shades the floor.
  float x = max(d - uRadius, 0.0);
  float near = exp(-x / mix(9.5, 12.5, uLit));
  float far = exp(-x / mix(37.0, 48.0, uLit));
  float pool = (0.82 * near + 0.46 * far) * mix(1.0, 1.22, uLit);
  pool *= smoothstep(uRadius - uStroke * 0.6, uRadius + uStroke * 0.9, d);
  pool *= smoothstep(1.0, 0.70, d / max(uHalf.x, 1e-3));
  // A lamp inside the room cannot light the far side of the wall it stands against: the
  // pool washes the brick and dies at the board's outer boundary.
  vec2 ob = min(vBoard, vec2(${BOARD.toFixed(1)}) - vBoard);
  pool *= smoothstep(0.0, ${(WALL_T * 0.92).toFixed(1)}, min(ob.x, ob.y));

  vec3 tint = mix(uRing, vec3(dot(uRing, vec3(0.30, 0.59, 0.11))), 0.30 * uLit);
  vec3 col = uRing * (core + glow) * amp + tint * (disc + pool) * amp;
  fragColor = vec4(col * window(), 0.0);
}`;

const FS_FLAG = `${FS_HEAD}
uniform vec2 uSize;
uniform vec3 uColor;
uniform float uLit;
uniform vec3 uGlow;
uniform vec2 uGlowAt;
void main() {
  vec2 p = (vLocal + uSize * 0.5) / uSize;
  float x = clamp(p.x, 0.0, 1.0);

  // A pennant, not a triangle: one travelling wave down a tapering cloth. Built around a
  // wavy centre line so the whole flag moves instead of only its lower edge — at the 28 css
  // px this renders at, a wave applied to one edge alone collapses into a flat wedge.
  float wave = sin(x * 5.6 + 0.50);
  // A golf-pin pennant: full depth at the hoist, a near point at the fly, and the whole
  // cloth drifting down and waving as it goes — measured off ref_001.jpg, where the tip
  // sits about a third of the flag's depth below the hoist's centre line.
  float mid = 0.50 + 0.115 * x + 0.105 * wave * (0.25 + 0.75 * x);
  float span = 0.470 * (1.0 - 0.88 * x * x);
  float top = mid - span;
  float bot = mid + span;

  float inside = step(top, p.y) * step(p.y, bot) * step(0.0, p.x) * step(p.x, 1.0);
  float edge = min(min(p.y - top, bot - p.y), min(p.x, 1.0 - p.x)) * uSize.y;
  float a = inside * clamp(edge / max(uPx, 1e-3) + 0.5, 0.0, 1.0);

  // Fold shading follows the same wave, so the cloth reads as curved cloth.
  float fold = 0.84 + 0.26 * cos(x * 7.4 + 0.55) + 0.12 * smoothstep(1.0, 0.0, x);
  vec3 col = uColor * fold * (1.0 + 0.70 * uLit);
  float rim = smoothstep(2.0, 0.0, edge) * inside;
  col += uColor * rim * (0.15 + 0.45 * uLit);
  // The ring below is a lamp, so the pennant is lit from beneath by its own colour — but
  // only just: the reference's cloth stays darker than the floor pool it stands in.
  float gd = length(vLocal - uGlowAt);
  col += uGlow * (0.14 * exp(-gd / 34.0) + 0.10 * exp(-gd / 90.0)) * (1.0 + 0.7 * uLit);
  fragColor = vec4(col * a, a);
}`;

const FS_POLE = `${FS_HEAD}
uniform vec2 uSize;
uniform vec3 uColor;
uniform float uLit;
uniform vec3 uGlow;
uniform vec2 uGlowAt;
void main() {
  vec2 h = uSize * 0.5;
  vec2 d = abs(vLocal) - h;
  float sd = min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
  float a = aa(sd);
  float across = clamp((vLocal.x + h.x) / uSize.x, 0.0, 1.0);
  float shade = 0.62 + 0.75 * exp(-pow((across - 0.34) / 0.26, 2.0));
  vec3 col = uColor * shade * (1.0 + 0.55 * uLit);
  // Standing in the ring's pool, the pole picks up its colour strongly at the foot and
  // loses it toward the pennant — the single clearest tell that the lamp is on.
  float gd = length(vLocal - uGlowAt);
  col += uGlow * (0.85 * exp(-gd / 26.0) + 0.34 * exp(-gd / 78.0)) * (1.0 + 0.8 * uLit);
  float glow = exp(-max(sd, 0.0) / 3.0) * 0.20 * uLit * window();
  fragColor = vec4(col * a + uColor * glow, a);
}`;

const FS_MIRROR = `${FS_HEAD}
uniform float uHalfLen;
uniform float uRad;
uniform vec3 uBody;
uniform vec3 uBack;
uniform vec3 uSpec;
uniform vec3 uGlow;
uniform vec3 uLitColor;
uniform float uLitAmount;
uniform float uAlpha;
uniform float uGhost;
void main() {
  vec2 p = vLocal;
  float d = sdSeg(p, vec2(-uHalfLen, 0.0), vec2(uHalfLen, 0.0)) - uRad;
  float body = aa(d);
  float inset = -d;

  float side = clamp(p.y / uRad, -1.0, 1.0);
  vec3 substrate = mix(uBody, uBack, smoothstep(-0.22, 0.34, side));
  substrate *= 0.80 + 0.42 * smoothstep(0.9, -0.5, side);
  float endFade = smoothstep(uHalfLen + uRad, uHalfLen - uRad * 0.4, abs(p.x));
  substrate *= 0.55 + 0.45 * endFade;
  // A dark contour just inside the outline. ORCHESTRATOR-NOTES.md 9.5: the reference's
  // mirror is DARKER than the beam it reflects and keeps a readable dark edge; without this
  // the rod has no silhouette at all once a beam lands on it.
  substrate *= 1.0 - 0.42 * smoothstep(2.6, 0.0, inset);

  float specY = p.y + uRad * 0.42;
  float lineProfile = exp(-pow(specY / (uRad * 0.17), 2.0));
  float lengthProfile = smoothstep(uHalfLen, uHalfLen - uRad * 0.9, abs(p.x));
  lengthProfile *= 0.84 + 0.16 * cos(p.x / max(uHalfLen, 1e-3) * 1.4);
  float spec = lineProfile * lengthProfile * body;

  float rim = smoothstep(1.5, 0.0, abs(d)) * step(side, 0.05);
  float front = smoothstep(0.45, -0.55, side);
  float halo = (exp(-max(d, 0.0) / 1.9) * 0.20 + exp(-max(d, 0.0) / 5.0) * 0.035)
             * lengthProfile * (0.45 + 0.75 * front);

  vec3 col = substrate;
  // The rod glows along its coated face, not over its whole footprint. This used to add
  // 0.45 scene units across the entire sprite, which by itself pushed the rod past the
  // bloom prefilter threshold (0.72) everywhere and let the 6-step pyramid smear it.
  col += uLitColor * uLitAmount * (0.055 + 0.135 * lineProfile);
  vec3 add = uSpec * spec * (0.42 + 0.58 * uLitAmount);
  add += uGlow * rim * (0.5 + 0.8 * uLitAmount);
  add += mix(uGlow, uLitColor * 0.30, clamp(uLitAmount, 0.0, 1.0)) * halo * (0.5 + 0.5 * uLitAmount);

  float a = body * uAlpha;
  vec3 total = col * a + add * uAlpha * window();

  // Hard ceiling on the radiance this sprite may emit. Anything above the bloom prefilter
  // threshold (0.72, main.js POST_PARAMS) is smeared by the 6-step pyramid, so the rod is
  // allowed past it only along the hairline specular line (about 1.5 css px wide): measured
  // on an isolated lit rod the peak lands at 224/255 and the body at 180, against 252
  // (clipped) before. ORCHESTRATOR-NOTES.md 9.5.
  float lineMask = clamp(lineProfile * lengthProfile * body, 0.0, 1.0);
  float lim = mix(0.36, 0.80, lineMask) * mix(1.0, 0.34, uGhost) * uAlpha;
  float peak = max(max(total.r, total.g), total.b);
  total *= (peak > lim) ? lim / max(peak, 1e-5) : 1.0;

  fragColor = vec4(total, a);
}`;

const FS_PRISM = `${FS_HEAD}
uniform float uR;
uniform vec3 uEdge;
uniform vec3 uLitColor;
uniform float uLitAmount;
uniform float uAlpha;
uniform float uGhost;
float sdTri(vec2 p, float R) {
  const float K = 0.8660254;
  float d0 = dot(p, vec2(0.5, -K));
  float d1 = dot(p, vec2(-1.0, 0.0));
  float d2 = dot(p, vec2(0.5, K));
  return max(max(d0, d1), d2) - R * 0.5;
}
void main() {
  float d = sdTri(vLocal, uR);
  float inside = aa(d);
  float edge = exp(-pow(abs(d) / 1.4, 2.0));

  // REFERENCE.md 6.2: a 1.5-2 px near-white outline over an almost transparent fill, whose
  // interior measures only +8 to +14/255 over the background behind it, and explicitly
  // "no solid tinted body". Two things used to break that. The fill carried a full-strength
  // blue tint, and the halo term was a CONSTANT inside the triangle (exp(-max(d,0)/k) is 1
  // for every interior fragment), so an untouched prism sitting in the dark rendered a flat
  // grey-blue plate at 55-63/255 over a 1-4/255 floor.
  float litK = clamp(uLitAmount, 0.0, 1.0);
  vec3 bodyTint = mix(vec3(0.62, 0.66, 0.72), uLitColor, clamp(uLitAmount * 1.3, 0.0, 1.0));
  float depth = smoothstep(0.0, uR * 0.9, -d);
  vec3 body = bodyTint * (0.009 + 0.020 * depth) * (1.0 + 20.0 * uLitAmount);

  vec2 a = vec2(-uR * 0.5, -uR * 0.866);
  vec2 b = vec2(uR * 0.72, 0.0);
  float path = exp(-pow(sdSeg(vLocal, a, b) / 1.6, 2.0)) * inside;

  // Strictly an OUTER glow now: it fades out across the boundary instead of flooding the
  // interior with a constant term.
  float halo = exp(-max(d, 0.0) / 3.4) * smoothstep(-2.0, 0.6, d) * (0.03 + 0.62 * uLitAmount);

  vec3 col = body;
  vec3 add = uEdge * edge * (0.70 + 2.35 * uLitAmount);
  add += mix(uEdge, uLitColor, 0.85 * litK) * path * (0.10 + 1.30 * uLitAmount);
  add += mix(uEdge, uLitColor, 0.7 * litK) * halo;

  float alpha = inside * uAlpha * 0.55;
  vec3 total = col * alpha + add * uAlpha * window();
  // Same ceiling discipline as the mirror: the outline may be near-white, the glass may not.
  float lim = mix(0.34, 0.90, edge) * (1.0 + 0.9 * clamp(uLitAmount, 0.0, 1.0)) * mix(1.0, 0.34, uGhost);
  float peak = max(max(total.r, total.g), total.b);
  total *= (peak > lim) ? lim / max(peak, 1e-5) : 1.0;
  fragColor = vec4(total, alpha);
}`;

// No degree ticks. ARCHITECTURE.md section 11 item 4 and REFERENCE.md 10.1 item 13: a plain
// hairline circle at about 30 % opacity plus the handle dot is what makes it read as an
// instrument rather than a widget.
// The whole pass used to write alpha 0, i.e. pure additive over the board, which made the
// dark outline around the handle physically impossible: no fragment could ever land below
// the background it was drawn over. The disc and its collar now write premultiplied alpha
// (the board's blend is ONE / ONE_MINUS_SRC_ALPHA), so they occlude the beam and the mirror
// end cap beneath them, and the ring is cut where it meets the collar instead of shining
// through the disc.
const FS_PROTRACTOR = `${FS_HEAD}
uniform float uR;
uniform vec3 uColor;
uniform vec3 uHandleFill;
uniform vec2 uHandle;
uniform float uAlpha;
uniform float uGrab;
void main() {
  float d = length(vLocal);
  float hd = length(vLocal - uHandle);

  float hr = ${HANDLE_R.toFixed(2)} + 0.55 * uGrab;
  float collar = hr + ${HANDLE_COLLAR.toFixed(2)};

  float disc = smoothstep(hr, hr - 1.0, hd);
  float band = smoothstep(collar, collar - 1.3, hd) * (1.0 - disc);

  // Grab feedback. Rotating has to look different from merely being selected, but degree
  // ticks are forbidden (REFERENCE.md 10.1 item 13) and a radius needle would lie exactly
  // along a mirror's own rod, so the ring instead thickens over the ~60 degree arc the
  // handle is riding and the whole circle picks up a little light.
  float sigma = 1.05 + 1.25 * uGrab * smoothstep(uR * 0.58, uR * 0.12, hd);
  float ring = exp(-pow((d - uR) / sigma, 2.0)) * (1.0 - smoothstep(collar + 1.2, collar - 0.4, hd));

  // A 3 px glint, not a lamp.
  float glint = exp(-max(hd - hr, 0.0) / 1.7) * (1.0 - disc) * (0.11 + 0.07 * uGrab);

  vec3 col = uColor * ring * (1.0 + 0.30 * uGrab);
  col += uHandleFill * disc;
  col += uHandleFill * glint * 0.5;

  float w = window();
  float occl = clamp(disc + band * 0.92, 0.0, 1.0) * uAlpha * w;
  fragColor = vec4(max(col, vec3(0.0)) * uAlpha * w, occl);
}`;

const FS_TEXT = `${FS_HEAD}
uniform sampler2D uTex;
uniform vec2 uSize;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  vec2 uv = (vLocal / uSize) + 0.5;
  float m = texture(uTex, uv).a;
  fragColor = vec4(uColor * m * uAlpha, 0.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error('board.js shader: ' + log);
  }
  return s;
}

function link(gl, vs, fs) {
  if (typeof glmod.createProgram === 'function') {
    try {
      const p = glmod.createProgram(gl, vs, fs);
      if (p) return p;
    } catch (e) {
      // fall through to the local compiler
    }
  }
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  const p = gl.createProgram();
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error('board.js link: ' + log);
  }
  return p;
}

function uniforms(gl, prog) {
  const map = Object.create(null);
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(prog, i);
    const name = info.name.replace(/\[0\]$/, '');
    map[name] = gl.getUniformLocation(prog, name);
  }
  return map;
}

function pickTexture(gl, names) {
  for (const n of names) {
    const fn = textures[n];
    if (typeof fn === 'function') {
      try {
        const t = fn(gl);
        if (t instanceof WebGLTexture) return t;
        if (t && typeof t === 'object') {
          const tex = t.texture || t.tex;
          if (tex instanceof WebGLTexture) return tex;
        }
      } catch (e) {
        // ignore and try the next candidate
      }
    } else if (fn && typeof fn === 'object' && fn instanceof WebGLTexture) {
      return fn;
    }
  }
  return null;
}

function fallbackTexture(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  let seed = 1337;
  for (let i = 0; i < n * n; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const v = 118 + ((seed >>> 16) & 63);
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}

function nmColor(nm) {
  if (typeof spectrum.nmToLinearRGB === 'function') {
    const c = spectrum.nmToLinearRGB(nm);
    if (c && c.length >= 3) return c;
  }
  const t = Math.min(Math.max((nm - 380) / 320, 0), 1);
  const h = (1 - t) * 0.78;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const q = 1 - f;
  switch (i % 6) {
    case 0: return [1, f, 0];
    case 1: return [q, 1, 0];
    case 2: return [0, 1, f];
    case 3: return [0, q, 1];
    case 4: return [f, 0, 1];
    default: return [1, 0, q];
  }
}

function normAngle(a) {
  const t = a % TWO_PI;
  return t < 0 ? t + TWO_PI : t;
}

export function createBoardRenderer(gl) {
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const build = (fs) => {
    const p = link(gl, VS, fs);
    return { p, u: uniforms(gl, p) };
  };

  const progs = {
    wall: build(FS_WALL),
    box: build(FS_BOX),
    glow: build(FS_GLOW),
    slit: build(FS_SLIT),
    receptor: build(FS_RECEPTOR),
    flag: build(FS_FLAG),
    pole: build(FS_POLE),
    mirror: build(FS_MIRROR),
    prism: build(FS_PRISM),
    protractor: build(FS_PROTRACTOR),
    text: build(FS_TEXT),
  };

  const ownedTextures = [];
  let detail = pickTexture(gl, ['createBrickTexture', 'brickTexture', 'createBrick', 'makeBrickTexture', 'brick',
    'createNoiseTexture', 'noiseTexture', 'createNoise', 'noise', 'createGrainTexture', 'grainTexture', 'grain']);
  let detailMix = detail ? 0.23 : 0.0;
  if (!detail) {
    detail = fallbackTexture(gl);
    ownedTextures.push(detail);
    detailMix = 0.10;
  }

  const textCanvas = document.createElement('canvas');
  textCanvas.width = 64;
  textCanvas.height = 16;
  const tctx = textCanvas.getContext('2d');
  const textTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, textTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  ownedTextures.push(textTex);
  let textCache = '';

  let textHalfW = 20;
  let textHalfH = 5;

  // Rasterised at exactly the size it occupies on screen: hairline glyphs survive no other way.
  function updateText(str) {
    const capPx = Math.max(READOUT_CAP * pxPerUnit, 3.5);
    const key = str + '|' + capPx.toFixed(2);
    if (key === textCache) return;
    textCache = key;
    const fontPx = capPx / 0.72;
    const track = fontPx * 0.35;
    const font = fontPx.toFixed(2) + 'px "Share Tech Mono", "SFMono-Regular", Consolas, monospace';
    tctx.font = font;
    if ('letterSpacing' in tctx) tctx.letterSpacing = track.toFixed(2) + 'px';
    tctx.font = font;
    const w = Math.ceil(tctx.measureText(str).width) + Math.ceil(track) + 4;
    const h = Math.ceil(fontPx * 1.7) + 2;
    textCanvas.width = w;
    textCanvas.height = h;
    tctx.clearRect(0, 0, w, h);
    tctx.font = font;
    if ('letterSpacing' in tctx) tctx.letterSpacing = track.toFixed(2) + 'px';
    tctx.fillStyle = '#ffffff';
    tctx.textAlign = 'center';
    tctx.textBaseline = 'middle';
    tctx.fillText(str, w / 2 + track / 2, h / 2);
    textHalfW = w / (2 * pxPerUnit);
    textHalfH = h / (2 * pxPerUnit);
    gl.bindTexture(gl.TEXTURE_2D, textTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas);
  }

  const view = new Float32Array(9);
  let pxPerUnit = 0.568;
  let vw = 1;
  let vh = 1;

  const lightSeg = new Float32Array(MAX_LIGHTS * 4);
  const lightCol = new Float32Array(MAX_LIGHTS * 4);
  let lightCount = 0;

  const litFactors = new Map();
  const bornAt = new Map();
  let lastTime = 0;
  let cache = { level: null, optics: [], state: null };

  function setView() {
    let scale = 0;
    let ox = 0;
    let oy = 0;
    if (typeof glmod.boardToPixel === 'function') {
      try {
        const t = glmod.boardToPixel(vw, vh);
        if (t && isFinite(t.scale) && t.scale > 0) {
          scale = t.scale;
          ox = t.ox;
          oy = t.oy;
        }
      } catch (e) {
        scale = 0;
      }
    }
    if (!scale) {
      const dock = vh * 0.115;
      scale = Math.min(vw * 0.79, (vh - dock) * 0.94) / BOARD;
      ox = (vw - BOARD * scale) * 0.5;
      oy = (vh - dock - BOARD * scale) * 0.5 + dock * 0.12;
    }
    // The transform may be reported in CSS px while we render into a device-px buffer.
    if (BOARD * scale < vw * 0.35) {
      const dpr = vw / Math.max(BOARD * scale / 0.79, 1);
      if (dpr > 1.2 && dpr < 4.2) {
        scale *= dpr;
        ox *= dpr;
        oy *= dpr;
      }
    }
    pxPerUnit = scale;
    view[0] = (2 * scale) / vw; view[1] = 0; view[2] = 0;
    view[3] = 0; view[4] = (-2 * scale) / vh; view[5] = 0;
    view[6] = (2 * ox) / vw - 1; view[7] = 1 - (2 * oy) / vh; view[8] = 1;
  }

  function use(entry) {
    gl.useProgram(entry.p);
    if (entry.u.uView) gl.uniformMatrix3fv(entry.u.uView, false, view);
    if (entry.u.uPx) gl.uniform1f(entry.u.uPx, 1 / Math.max(pxPerUnit, 1e-4));
    return entry.u;
  }

  function place(u, cx, cy, hx, hy, angle) {
    gl.uniform2f(u.uCenter, cx, cy);
    gl.uniform2f(u.uHalf, hx, hy);
    const a = angle || 0;
    gl.uniform2f(u.uRot, Math.cos(a), Math.sin(a));
  }

  function bindLights(u) {
    if (!u.uLightCount) return;
    gl.uniform1i(u.uLightCount, lightCount);
    if (lightCount > 0) {
      gl.uniform4fv(u.uLightSeg, lightSeg);
      gl.uniform4fv(u.uLightCol, lightCol);
    }
  }

  function drawQuad() {
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function addLight(ax, ay, bx, by, r, g, b, i) {
    if (lightCount >= MAX_LIGHTS) return;
    const o = lightCount * 4;
    lightSeg[o] = ax; lightSeg[o + 1] = ay; lightSeg[o + 2] = bx; lightSeg[o + 3] = by;
    lightCol[o] = r; lightCol[o + 1] = g; lightCol[o + 2] = b; lightCol[o + 3] = i;
    lightCount++;
  }

  // Collapses the trace into at most MAX_LIGHTS segment lights: the longest, brightest white
  // runs, then the spectral fan folded into seven wavelength bands so a whole rainbow costs
  // seven lights instead of two hundred.
  function buildLights(level, state) {
    lightCount = 0;
    const explicit = state && Array.isArray(state.lights) ? state.lights : null;
    if (explicit) {
      for (const l of explicit) {
        if (lightCount >= MAX_LIGHTS) break;
        const ax = l.ax !== undefined ? l.ax : l.x;
        const ay = l.ay !== undefined ? l.ay : l.y;
        const bx = l.bx !== undefined ? l.bx : ax;
        const by = l.by !== undefined ? l.by : ay;
        const c = l.color || [l.r, l.g, l.b];
        addLight(ax, ay, bx, by, c[0] || 0, c[1] || 0, c[2] || 0, l.intensity === undefined ? 1 : l.intensity);
      }
    } else {
      const segs = state && state.trace && Array.isArray(state.trace.segments) ? state.trace.segments : null;
      if (segs) {
        const whites = [];
        const bands = new Map();
        for (const s of segs) {
          const inten = s.intensity === undefined ? 1 : s.intensity;
          if (inten <= 0.015) continue;
          const len = Math.hypot(s.bx - s.ax, s.by - s.ay);
          if (len < 4) continue;
          if (!s.nm) {
            whites.push({ s, w: inten * Math.min(len, 500) });
          } else {
            const band = Math.max(0, Math.min(6, Math.floor((s.nm - 380) / 45.72)));
            const key = band + ':' + (s.generation || 0);
            let g = bands.get(key);
            if (!g) {
              g = { ax: 0, ay: 0, bx: 0, by: 0, w: 0, inten: 0, nm: 0 };
              bands.set(key, g);
            }
            const wgt = inten * Math.min(len, 500);
            g.ax += s.ax * wgt; g.ay += s.ay * wgt; g.bx += s.bx * wgt; g.by += s.by * wgt;
            g.nm += s.nm * wgt;
            g.w += wgt;
            g.inten += inten;
          }
        }
        whites.sort((a, b) => b.w - a.w);
        const whiteMax = Math.min(whites.length, 8);
        for (let i = 0; i < whiteMax; i++) {
          const s = whites[i].s;
          const inten = (s.intensity === undefined ? 1 : s.intensity) * 0.85;
          addLight(s.ax, s.ay, s.bx, s.by, WHITE_LIGHT[0], WHITE_LIGHT[1], WHITE_LIGHT[2], inten);
        }
        const groups = [...bands.values()].filter((g) => g.w > 0).sort((a, b) => b.inten - a.inten);
        const spectralMax = Math.min(groups.length, MAX_LIGHTS - lightCount - 4);
        for (let i = 0; i < spectralMax; i++) {
          const g = groups[i];
          const c = nmColor(g.nm / g.w);
          const inten = Math.min(g.inten * 2.6, 1.4);
          addLight(g.ax / g.w, g.ay / g.w, g.bx / g.w, g.by / g.w, c[0], c[1], c[2], inten);
        }
      }
    }

    if (level && level.emitter && lightCount < MAX_LIGHTS) {
      addLight(level.emitter.x, level.emitter.y, level.emitter.x, level.emitter.y,
        WHITE_LIGHT[0], WHITE_LIGHT[1], WHITE_LIGHT[2], 0.55);
    }
    if (level && Array.isArray(level.receptors)) {
      for (let i = 0; i < level.receptors.length; i++) {
        if (lightCount >= MAX_LIGHTS) break;
        const r = level.receptors[i];
        const pal = RECEPTORS[r.color] || RECEPTORS.blue;
        const lit = litFactors.get(receptorKey(r, i)) || 0;
        const c = pal.ring[1];
        const peak = Math.max(c[0], c[1], c[2]) || 1;
        addLight(r.x, r.y, r.x, r.y, c[0] / peak, c[1] / peak, c[2] / peak, 0.62 + 0.85 * lit);
      }
    }
  }

  function receptorKey(r, i) {
    return r.id !== undefined ? r.id : 'r' + i;
  }

  function opticIllumination(x, y) {
    let r = 0;
    let g = 0;
    let b = 0;
    let amt = 0;
    for (let i = 0; i < lightCount; i++) {
      const o = i * 4;
      const ax = lightSeg[o];
      const ay = lightSeg[o + 1];
      const bx = lightSeg[o + 2];
      const by = lightSeg[o + 3];
      const dx = bx - ax;
      const dy = by - ay;
      const dd = dx * dx + dy * dy;
      const h = dd > 1e-6 ? Math.min(Math.max(((x - ax) * dx + (y - ay) * dy) / dd, 0), 1) : 0;
      const px = ax + dx * h;
      const py = ay + dy * h;
      const d = Math.hypot(x - px, y - py);
      const att = lightCol[o + 3] / (1 + (d / 46) * (d / 46));
      r += lightCol[o] * att;
      g += lightCol[o + 1] * att;
      b += lightCol[o + 2] * att;
      amt += att;
    }
    const peak = Math.max(r, g, b, 1e-4);
    const k = Math.min(amt, 1.6) / 1.6;
    return { r: r / peak, g: g / peak, b: b / peak, amount: Math.min(k, 1) };
  }

  // Face states, in the wall's own frame (-X, +X, -Y, +Y): 0 joined, 1 open, 2 outer.
  // The outer ring is four rectangles that must read as one continuous mitred frame, so the
  // faces where they meet are marked joined — no inner ramp, no bleed, and a small overlap
  // so the two antialiased edges do not leave the black notch the critic measured.
  const FACE_JOINED = 0;
  const FACE_OPEN = 1;
  const FACE_OUTER = 2;
  const JOIN_GROW = 0.9;

  function wallRects(level) {
    const out = [];
    out.push({
      x: 0, y: 0, w: BOARD, h: WALL_T,
      face: [FACE_OUTER, FACE_OUTER, FACE_OUTER, FACE_OPEN],
      grow: [0, 0, 0, 0],
      mitre: [1, 1, 0, 0],
    });
    out.push({
      x: 0, y: BOARD - WALL_T, w: BOARD, h: WALL_T,
      face: [FACE_OUTER, FACE_OUTER, FACE_OPEN, FACE_OUTER],
      grow: [0, 0, 0, 0],
      mitre: [0, 0, 1, 1],
    });
    out.push({
      x: 0, y: WALL_T, w: WALL_T, h: BOARD - WALL_T * 2,
      face: [FACE_OUTER, FACE_OPEN, FACE_JOINED, FACE_JOINED],
      grow: [0, 0, JOIN_GROW, JOIN_GROW],
      mitre: [0, 0, 0, 0],
    });
    out.push({
      x: BOARD - WALL_T, y: WALL_T, w: WALL_T, h: BOARD - WALL_T * 2,
      face: [FACE_OPEN, FACE_OUTER, FACE_JOINED, FACE_JOINED],
      grow: [0, 0, JOIN_GROW, JOIN_GROW],
      mitre: [0, 0, 0, 0],
    });
    if (level && Array.isArray(level.walls)) {
      for (const w of level.walls) {
        if (!w || !(w.w > 0) || !(w.h > 0)) continue;
        // An interior stub that reaches the frame butts into it rather than ending in a
        // cropped brick, so that edge is joined and the frame's bleed covers the seam.
        const face = [
          w.x <= WALL_T + 0.5 ? FACE_JOINED : FACE_OPEN,
          w.x + w.w >= BOARD - WALL_T - 0.5 ? FACE_JOINED : FACE_OPEN,
          w.y <= WALL_T + 0.5 ? FACE_JOINED : FACE_OPEN,
          w.y + w.h >= BOARD - WALL_T - 0.5 ? FACE_JOINED : FACE_OPEN,
        ];
        out.push({
          x: w.x, y: w.y, w: w.w, h: w.h,
          face,
          grow: [
            face[0] === FACE_JOINED ? JOIN_GROW : 0,
            face[1] === FACE_JOINED ? JOIN_GROW : 0,
            face[2] === FACE_JOINED ? JOIN_GROW : 0,
            face[3] === FACE_JOINED ? JOIN_GROW : 0,
          ],
          mitre: [0, 0, 0, 0],
        });
      }
    }
    return out;
  }

  // Enough room outside every rectangle for the contact bleed to fade to nothing.
  const WALL_MARGIN = 22;

  function drawWalls(level) {
    const u = use(progs.wall);
    gl.uniform3fv(u.uLight, BRICK_LIGHT);
    gl.uniform3fv(u.uMid, BRICK_MID);
    gl.uniform3fv(u.uDark, BRICK_DARK);
    gl.uniform3fv(u.uRim, BRICK_RIM);
    gl.uniform3fv(u.uMortar, MORTAR);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, detail);
    gl.uniform1i(u.uDetail, 0);
    gl.uniform1f(u.uDetailMix, detailMix);
    bindLights(u);
    for (const w of wallRects(level)) {
      const face = w.face || [FACE_OPEN, FACE_OPEN, FACE_OPEN, FACE_OPEN];
      const grow = w.grow || [0, 0, 0, 0];
      const mitre = w.mitre || [0, 0, 0, 0];
      gl.uniform2f(u.uSize, w.w, w.h);
      gl.uniform1f(u.uHoriz, w.w >= w.h ? 1 : 0);
      gl.uniform4f(u.uFace, face[0], face[1], face[2], face[3]);
      gl.uniform4f(u.uGrow, grow[0], grow[1], grow[2], grow[3]);
      gl.uniform4f(u.uMitre, mitre[0], mitre[1], mitre[2], mitre[3]);
      place(u, w.x + w.w / 2, w.y + w.h / 2, w.w / 2 + WALL_MARGIN, w.h / 2 + WALL_MARGIN, 0);
      drawQuad();
    }
  }

  // REFERENCE.md 4.4. The board's y axis grows downward and trace.js pushes the first ray
  // along (cos dir, sin dir) in exactly that frame, so the housing has to sit at
  // -(cos dir, sin dir) from the mouth. Getting this sign wrong buries the block inside the
  // beam, which is what used to happen.
  // How far back the housing can run before it meets brick. The reference's emitter reads as
  // a fixture bolted to the wall, not as a bar floating in the room, so the block is grown
  // until it buries itself in whatever wall stands behind it.
  function housingLength(level, ca, sa, ex, ey) {
    let best = Infinity;
    for (const w of wallRects(level)) {
      let t0 = 0;
      let t1 = EMITTER_MAX_LEN;
      const dx = -ca;
      const dy = -sa;
      if (Math.abs(dx) < 1e-6) {
        if (ex < w.x || ex > w.x + w.w) continue;
      } else {
        let a = (w.x - ex) / dx;
        let b = (w.x + w.w - ex) / dx;
        if (a > b) { const s2 = a; a = b; b = s2; }
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, b);
      }
      if (Math.abs(dy) < 1e-6) {
        if (ey < w.y || ey > w.y + w.h) continue;
      } else {
        let a = (w.y - ey) / dy;
        let b = (w.y + w.h - ey) / dy;
        if (a > b) { const s2 = a; a = b; b = s2; }
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, b);
      }
      if (t1 >= Math.max(t0, 0) && t0 < best) best = Math.max(t0, 0);
    }
    if (!isFinite(best)) return EMITTER_MIN_LEN;
    return Math.min(Math.max(best + EMITTER_BURY, EMITTER_MIN_LEN), EMITTER_MAX_LEN);
  }

  // REFERENCE.md 4.4. The board's y axis grows downward and trace.js pushes the first ray
  // along (cos dir, sin dir) in exactly that frame, so the housing has to sit at
  // -(cos dir, sin dir) from the mouth. Getting this sign wrong buries the block inside the
  // beam, which is what used to happen.
  function drawEmitter(level) {
    const e = level && level.emitter;
    if (!e) return;
    const dir = e.dir || 0;
    const ca = Math.cos(dir);
    const sa = Math.sin(dir);

    const len = housingLength(level, ca, sa, e.x, e.y);
    const bx = e.x - ca * (len * 0.5);
    const by = e.y - sa * (len * 0.5);

    // The top-left key light, rotated into the housing's own frame so the lit lip stays on
    // the board's top-left no matter which way the emitter points.
    const lx = (ca + sa) * SQRT1_2;
    const ly = (ca - sa) * SQRT1_2;

    // A pool of spill behind and around the block, so the housing sits in its own light
    // instead of on bare black. Drawn first: the box is opaque and covers its middle.
    const ug = use(progs.glow);
    gl.uniform2f(ug.uSpan, ca * len * 0.34, sa * len * 0.34);
    gl.uniform1f(ug.uRadius, 74);
    gl.uniform1f(ug.uPower, 2.4);
    gl.uniform3f(ug.uColor, SLIT[0] * 0.070, SLIT[1] * 0.072, SLIT[2] * 0.080);
    place(ug, e.x - ca * len * 0.34, e.y - sa * len * 0.34, len * 0.34 + 76, len * 0.34 + 76, 0);
    drawQuad();

    const ub = use(progs.box);
    gl.uniform2f(ub.uSize, len, EMITTER_W);
    gl.uniform3fv(ub.uFill, HOUSING);
    gl.uniform3fv(ub.uEdge, HOUSING_EDGE);
    gl.uniform2f(ub.uLitDir, lx, ly);
    // The housing is a machined block, not a lamp: it barely responds to its own beam.
    gl.uniform1f(ub.uLightGain, 0.14);
    bindLights(ub);
    place(ub, bx, by, len / 2 + 5, EMITTER_W / 2 + 5, dir);
    drawQuad();

    // The mouth: brighter than the beam it feeds (0.88 against 0.78), drawn at the beam's
    // full aperture height and perpendicular to the emitter direction.
    const us = use(progs.slit);
    gl.uniform2f(us.uSpan, 0, SLIT_SPAN);
    gl.uniform1f(us.uWidth, 2.6);
    gl.uniform3fv(us.uColor, SLIT);
    place(us, e.x, e.y, 26, SLIT_SPAN + 22, dir);
    drawQuad();
  }

  function drawReceptors(level, dt, t) {
    if (!level || !Array.isArray(level.receptors)) return;
    const evals = cache.state && cache.state.trace && Array.isArray(cache.state.trace.receptors)
      ? cache.state.trace.receptors : null;
    const provided = cache.state && cache.state.receptorLit ? cache.state.receptorLit : null;

    for (let i = 0; i < level.receptors.length; i++) {
      const r = level.receptors[i];
      const key = receptorKey(r, i);
      let target = 0;
      if (provided && provided[key] !== undefined) target = provided[key];
      else if (evals) {
        const ev = evals.find((x) => x.id === key) || evals[i];
        if (ev) target = ev.satisfied ? 1 : Math.min((ev.litIntensity || 0) / 0.06, 0.45);
      }
      const prev = litFactors.has(key) ? litFactors.get(key) : target;
      const k = 1 - Math.exp(-dt / 0.075);
      const lit = Math.min(Math.max(prev + (target - prev) * k, 0), 1);
      litFactors.set(key, lit);

      const pal = RECEPTORS[r.color] || RECEPTORS.blue;
      const ring = [
        pal.ring[0][0] + (pal.ring[1][0] - pal.ring[0][0]) * lit,
        pal.ring[0][1] + (pal.ring[1][1] - pal.ring[0][1]) * lit,
        pal.ring[0][2] + (pal.ring[1][2] - pal.ring[0][2]) * lit,
      ];
      const flagCol = [
        pal.flag[0][0] + (pal.flag[1][0] - pal.flag[0][0]) * lit,
        pal.flag[0][1] + (pal.flag[1][1] - pal.flag[0][1]) * lit,
        pal.flag[0][2] + (pal.flag[1][2] - pal.flag[0][2]) * lit,
      ];
      const poleCol = [
        POLE[0][0] + (POLE[1][0] - POLE[0][0]) * lit,
        POLE[0][1] + (POLE[1][1] - POLE[0][1]) * lit,
        POLE[0][2] + (POLE[1][2] - POLE[0][2]) * lit,
      ];

      const raise = 7.5 * lit;
      const poleTop = r.y - POLE_H - raise;

      // The colour the ring throws into the room, normalised so a dim palette entry still
      // lights its own pole and pennant at the same strength as a bright one.
      const ringPeak = Math.max(ring[0], ring[1], ring[2], 1e-4);
      const glowK = (0.30 + 0.55 * lit) * ringPeak;
      const glowCol = new Float32Array([
        (ring[0] / ringPeak) * glowK,
        (ring[1] / ringPeak) * glowK,
        (ring[2] / ringPeak) * glowK,
      ]);

      const poleCy = (poleTop + r.y + 2) / 2;
      const up = use(progs.pole);
      gl.uniform2f(up.uSize, POLE_W, POLE_H + raise + 2);
      gl.uniform3fv(up.uColor, new Float32Array(poleCol));
      gl.uniform1f(up.uLit, lit);
      gl.uniform3fv(up.uGlow, glowCol);
      gl.uniform2f(up.uGlowAt, 0, r.y - poleCy);
      place(up, r.x, poleCy, POLE_W / 2 + 11, (POLE_H + raise + 2) / 2 + 11, 0);
      drawQuad();

      const flagCx = r.x + POLE_W * 0.35 + FLAG_W / 2;
      const flagCy = poleTop + FLAG_H / 2 + 1;
      const uf = use(progs.flag);
      gl.uniform2f(uf.uSize, FLAG_W, FLAG_H);
      gl.uniform3fv(uf.uColor, new Float32Array(flagCol));
      gl.uniform1f(uf.uLit, lit);
      gl.uniform3fv(uf.uGlow, glowCol);
      gl.uniform2f(uf.uGlowAt, r.x - flagCx, r.y - flagCy);
      place(uf, flagCx, flagCy, FLAG_W / 2, FLAG_H / 2, 0);
      drawQuad();

      const ur = use(progs.receptor);
      gl.uniform3fv(ur.uRing, new Float32Array(ring));
      gl.uniform1f(ur.uLit, lit);
      gl.uniform1f(ur.uRadius, RECEPTOR_R);
      gl.uniform1f(ur.uStroke, RECEPTOR_STROKE);
      gl.uniform1f(ur.uTime, t || 0);
      // The pool has to be wide enough to BE the floor light: nothing else shades the floor,
      // and the reference's receptors tint 40+ css px of floor and wash the wall behind them.
      place(ur, r.x, r.y, RECEPTOR_HALO, RECEPTOR_HALO, 0);
      drawQuad();
    }
  }

  function drawMirror(x, y, angle, alpha, scaleK, reject, ghost) {
    const lit = reject ? { r: 0, g: 0, b: 0, amount: 0 } : opticIllumination(x, y);
    const u = use(progs.mirror);
    const hl = (MIRROR_LEN / 2) * scaleK;
    const rad = (MIRROR_T / 2) * scaleK;
    gl.uniform1f(u.uHalfLen, hl);
    gl.uniform1f(u.uRad, rad);
    gl.uniform3fv(u.uBody, reject ? REJECT_BODY : MIRROR_BODY);
    gl.uniform3fv(u.uBack, reject ? REJECT_BACK : MIRROR_BACK);
    gl.uniform3fv(u.uSpec, reject ? REJECT_SPEC : MIRROR_SPEC);
    gl.uniform3fv(u.uGlow, reject ? REJECT_GLOW : MIRROR_GLOW);
    gl.uniform3f(u.uLitColor, lit.r, lit.g, lit.b);
    gl.uniform1f(u.uLitAmount, lit.amount);
    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform1f(u.uGhost, ghost ? 1 : 0);
    place(u, x, y, hl + 26, rad + 24, -angle);
    drawQuad();
  }

  function drawPrism(x, y, angle, alpha, scaleK, reject, ghost) {
    const lit = reject ? { r: 0, g: 0, b: 0, amount: 0 } : opticIllumination(x, y);
    const u = use(progs.prism);
    const R = PRISM_R * scaleK;
    gl.uniform1f(u.uR, R);
    gl.uniform3fv(u.uEdge, reject ? REJECT_EDGE : GLASS_EDGE);
    gl.uniform3f(u.uLitColor, lit.r, lit.g, lit.b);
    gl.uniform1f(u.uLitAmount, lit.amount);
    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform1f(u.uGhost, ghost ? 1 : 0);
    place(u, x, y, R + 26, R + 26, -angle);
    drawQuad();
  }

  function drawOptic(o, alpha, scaleK, reject, ghost) {
    if (o.type === 'prism') drawPrism(o.x, o.y, o.angle || 0, alpha, scaleK, reject, ghost);
    else drawMirror(o.x, o.y, o.angle || 0, alpha, scaleK, reject, ghost);
  }

  function drawProtractor(o, scaleK, grabbed) {
    const a = normAngle(o.angle || 0);
    const R = RING_R * scaleK;
    const u = use(progs.protractor);
    gl.uniform1f(u.uR, R);
    gl.uniform3fv(u.uColor, PROTRACTOR);
    gl.uniform3fv(u.uHandleFill, HANDLE_FILL);
    gl.uniform2f(u.uHandle, Math.cos(a) * R, -Math.sin(a) * R);
    gl.uniform1f(u.uAlpha, scaleK);
    gl.uniform1f(u.uGrab, grabbed ? 1 : 0);
    place(u, o.x, o.y, R + 30, R + 30, 0);
    drawQuad();

    if (scaleK > 0.88) {
      updateText(((a * 180) / Math.PI).toFixed(1) + '°');
      const ut = use(progs.text);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textTex);
      gl.uniform1i(ut.uTex, 0);
      gl.uniform2f(ut.uSize, textHalfW * 2, textHalfH * 2);
      gl.uniform3fv(ut.uColor, READOUT);
      gl.uniform1f(ut.uAlpha, Math.min((scaleK - 0.88) / 0.12, 1));
      // Centred on the ring's centre, READOUT_GAP above the ring — not beside the handle.
      place(ut, o.x, o.y - R - READOUT_GAP - textHalfH, textHalfW, textHalfH, 0);
      drawQuad();
    }
  }

  function draw(glCtx, level, optics, state, time) {
    const g = glCtx || gl;
    const t = typeof time === 'number' ? time : 0;
    const dt = Math.min(Math.max(t - lastTime, 0), 0.1) || 0.016;
    lastTime = t;

    vw = g.drawingBufferWidth || 1;
    vh = g.drawingBufferHeight || 1;
    setView();

    const list = Array.isArray(optics) ? optics : [];
    cache = { level: level || null, optics: list, state: state || null };

    buildLights(level, state);

    g.disable(g.DEPTH_TEST);
    g.enable(g.BLEND);
    g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
    g.bindVertexArray(vao);

    drawWalls(level);
    drawEmitter(level);
    drawReceptors(level, dt, t);

    const nowMs = t * 1000;
    for (const o of list) {
      if (!o) continue;
      if (!bornAt.has(o.id)) bornAt.set(o.id, nowMs);
      const age = nowMs - bornAt.get(o.id);
      const p = Math.min(Math.max(age / PLACE_MS, 0), 1);
      const ease = 1 - Math.pow(1 - p, 3);
      const scaleK = 0.72 + 0.28 * ease;
      drawOptic(o, 0.35 + 0.65 * ease, scaleK);
    }

    // A rotate drag never needs a ghost: the real optic is already under the pointer, and
    // drawing a second copy at the drag's stale angle doubled the sprite mid-rotation.
    const drag0 = state && state.dragging;
    const ghost = state && (state.ghost || (drag0 && typeof drag0 === 'object'
      && drag0.kind !== 'rotate' && drag0.x !== undefined ? drag0 : null));
    if (ghost && ghost.type) {
      const bad = ghost.valid === false;
      // A refusal has to be readable as "not here", so the whole silhouette goes red and the
      // aura is fitted to the optic's own footprint. A 26 u point glow on a 110 u mirror was
      // a red dot on an otherwise normal sprite — it read as a status LED, not a rejection.
      drawOptic(ghost, bad ? 0.34 : 0.42, 0.94, bad, true);
      const ga = normAngle(ghost.angle || 0);
      const span = ghost.type === 'prism' ? 0 : (MIRROR_LEN / 2) * 0.82;
      const halo = ghost.type === 'prism' ? PRISM_R + 16 : MIRROR_T / 2 + 26;
      const ug = use(progs.glow);
      gl.uniform2f(ug.uSpan, Math.cos(ga) * span, -Math.sin(ga) * span);
      gl.uniform1f(ug.uRadius, halo);
      gl.uniform1f(ug.uPower, bad ? 2.1 : 3.2);
      // Dim enough that the wash reads as a refusal over a greyed-out sprite rather than
      // as a saturated red object in the red receptor's own colour family.
      if (bad) gl.uniform3f(ug.uColor, 0.085, 0.020, 0.018);
      // A preview, not a placement: the aura alone used to tonemap to 141/255, which is why
      // the ghost read as a blurred duplicate of a real optic instead of a proposal.
      else gl.uniform3f(ug.uColor, 0.075, 0.088, 0.12);
      place(ug, ghost.x, ghost.y, span + halo + 4, span + halo + 4, 0);
      drawQuad();
    }

    const selId = state ? state.selectedId : null;
    if (selId !== null && selId !== undefined) {
      const sel = list.find((o) => o && o.id === selId);
      if (sel) {
        const age = nowMs - (bornAt.has(sel.id) ? bornAt.get(sel.id) : nowMs);
        const p = Math.min(Math.max(age / PLACE_MS, 0), 1);
        const ease = 1 - Math.pow(1 - p, 3);
        const drag = state && state.dragging;
        const grabbed = !!(drag && typeof drag === 'object' && drag.kind === 'rotate' && drag.id === sel.id);
        drawProtractor(sel, 0.72 + 0.28 * ease, grabbed);
      }
    }

    g.bindVertexArray(null);

    for (const id of [...bornAt.keys()]) {
      if (!list.some((o) => o && o.id === id)) bornAt.delete(id);
    }
  }

  function hitTest(x, y) {
    const list = cache.optics;
    const st = cache.state;
    if (st) {
      const selId = st.selectedId;
      if (selId !== null && selId !== undefined) {
        const sel = list.find((o) => o && o.id === selId);
        if (sel) {
          const a = normAngle(sel.angle || 0);
          const hx = sel.x + Math.cos(a) * RING_R;
          const hy = sel.y - Math.sin(a) * RING_R;
          if (Math.hypot(x - hx, y - hy) <= HANDLE_R + 5) {
            return { kind: 'handle', id: sel.id, optic: sel };
          }
        }
      }
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const o = list[i];
      if (!o) continue;
      const a = normAngle(o.angle || 0);
      const ca = Math.cos(a);
      const sa = -Math.sin(a);
      const dx = x - o.x;
      const dy = y - o.y;
      const lx = dx * ca + dy * sa;
      const ly = -dx * sa + dy * ca;
      if (o.type === 'prism') {
        const K = 0.8660254;
        const d = Math.max(
          lx * 0.5 - ly * K,
          -lx,
          lx * 0.5 + ly * K,
        ) - PRISM_R * 0.5;
        if (d <= 4) return { kind: 'optic', id: o.id, optic: o };
      } else {
        const cx = Math.min(Math.max(lx, -MIRROR_LEN / 2), MIRROR_LEN / 2);
        if (Math.hypot(lx - cx, ly) <= MIRROR_T / 2 + 3) {
          return { kind: 'optic', id: o.id, optic: o };
        }
      }
    }
    const level = cache.level;
    if (level && Array.isArray(level.receptors)) {
      for (let i = 0; i < level.receptors.length; i++) {
        const r = level.receptors[i];
        if (Math.hypot(x - r.x, y - r.y) <= RECEPTOR_R + 8) {
          return { kind: 'receptor', id: receptorKey(r, i), receptor: r };
        }
      }
    }
    for (const w of wallRects(level)) {
      if (x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) {
        return { kind: 'wall', id: null, wall: w };
      }
    }
    return null;
  }

  function getReceptorLit(id) {
    return litFactors.get(id) || 0;
  }

  function dispose() {
    for (const k in progs) gl.deleteProgram(progs[k].p);
    for (const t of ownedTextures) gl.deleteTexture(t);
    gl.deleteBuffer(quad);
    gl.deleteVertexArray(vao);
    litFactors.clear();
    bornAt.clear();
  }

  return { draw, hitTest, getReceptorLit, dispose };
}
