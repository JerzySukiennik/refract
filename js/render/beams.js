// Instanced additive beam renderer: every traced ray segment becomes one expanded
// capsule quad, shaded in linear HDR with a flat-top core, handed warm/cool fringe,
// animated longitudinal grain and round end caps.
//
// The spectral path is deliberately NOT a set of tinted hairlines. Each wavelength is
// splatted at the SAME transverse width as the white beam it came from, in a palette
// balanced so that a full-spectrum sum is exactly neutral (spectrum.js RENDER_GAIN).
// Additive blending of those splats then performs the CIE integral per pixel: near the
// prism, where the whole spectrum still overlaps, the fan comes out grey for free, and
// hues separate only once the angular spread exceeds the beam width. That is
// REFERENCE.md 5.2 -- the one thing a hue-ramp implementation cannot reproduce.

import { createProgram, getTransform } from './gl.js';
import { nmToRenderRGB } from '../optics/spectrum.js';

const FLOATS_PER_INSTANCE = 13;
const INSTANCE_STRIDE = FLOATS_PER_INSTANCE * 4;

// Everything the reference measured is in pixels of a 720x694 frame whose board->pixel
// scale is 0.568 px per board unit (REFERENCE.md 1.1). Board units are the renderer's
// working space, so each measured pixel figure is divided by a scale here rather than
// baked in: the beam keeps the reference's proportions at any canvas size, and on a board
// drawn smaller than the reference the fringe is held at its measured 2.6 px so it cannot
// dissolve below one pixel.
const REFERENCE_SCALE = 0.568;
const FRINGE_OFFSET_PX = 2.6;   // REFERENCE.md 4.2: R shifted +2.6 px, B shifted -2.6 px
const PROFILE_EDGE_PX = 26.0;   // REFERENCE.md 4.1: v = 1 sits 26 px off the centreline
const BEAM_HALF_WIDTH = PROFILE_EDGE_PX / REFERENCE_SCALE;

const DEFAULTS = {
  whiteGain: 0.40,
  whiteHalfWidth: BEAM_HALF_WIDTH,
  spectralGain: 0.18,
  // A dispersed ray is the same beam, only narrower in wavelength: it keeps the width of
  // the beam that entered the glass. Anything thinner stops neighbouring wavelengths
  // overlapping, and the fan degenerates into a saturated hue ramp with a knife-edge
  // between red and green -- which is exactly what it used to do at 16 u.
  spectralHalfWidth: BEAM_HALF_WIDTH * 1.5,
  spectralGrow: 0.012,
  spectralCompRef: 620.0,
  spectralCompMax: 1.35,
  // Inside the glass the path is a faint guide line, not a beam: REFERENCE.md 6.2 wants
  // one thin internal line with the body of the prism staying almost transparent.
  insideHalfWidth: 5.0,
  insideGain: 0.20,
  fringeOffsetPx: FRINGE_OFFSET_PX,
  fringeChroma: 0.70,
  grainAmount: 0.27,
  grainDrift: 26.0,
  hotRadius: 22.0,
  hotGain: 0.55,
};

// Board units for a distance the reference measured in pixels.
function unitsFromPx(px) {
  const t = getTransform();
  const scale = t && t.scale > 0 ? Math.min(t.scale, REFERENCE_SCALE) : REFERENCE_SCALE;
  return px / scale;
}

const VERT = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aEnds;
layout(location = 2) in vec3 aColor;
layout(location = 3) in vec3 aParams;
layout(location = 4) in vec3 aHot;

uniform mat4 uViewProj;
uniform float uWhiteHalfWidth;
uniform float uSpecHalfWidth;
uniform float uInsideHalfWidth;
uniform float uSpecGrow;
uniform float uFringeOffset;

const float PROFILE_EXTENT = 1.25;

out float vAlong;
out float vAcross;
flat out float vLen;
flat out float vHalfWidth0;
flat out float vGrow;
flat out vec3 vColor;
flat out float vIntensity;
flat out float vSpectral;
flat out float vInside;
flat out vec2 vHot;
flat out float vSeed;

void main() {
  vec2 p0 = aEnds.xy;
  vec2 p1 = aEnds.zw;
  vec2 delta = p1 - p0;
  float len = length(delta);
  vec2 dir = len > 1e-4 ? delta / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);

  float spectral = aParams.y;
  float inside = aHot.z;
  float hw0 = mix(uWhiteHalfWidth, uSpecHalfWidth, spectral);
  hw0 = mix(hw0, uInsideHalfWidth, inside);
  float grow = uSpecGrow * spectral * (1.0 - inside);
  float fringeMargin = uFringeOffset * (1.0 - spectral) * 1.6;

  float along = aCorner.x * len;
  float hw = hw0 + grow * along;
  float margin = hw * PROFILE_EXTENT + fringeMargin;

  float axial = along + (aCorner.x * 2.0 - 1.0) * margin;
  float lateral = aCorner.y * margin;

  vec2 pos = p0 + dir * axial + nrm * lateral;

  vAlong = axial;
  vAcross = lateral * aParams.z;
  vLen = len;
  vHalfWidth0 = hw0;
  vGrow = grow;
  vColor = aColor;
  vIntensity = aParams.x;
  vSpectral = spectral;
  vInside = inside;
  vHot = aHot.xy;
  vSeed = fract(dot(p0, vec2(0.0173, 0.0311)) + dot(p1, vec2(0.0071, 0.0129))) * 37.0;

  gl_Position = uViewProj * vec4(pos, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;

in float vAlong;
in float vAcross;
flat in float vLen;
flat in float vHalfWidth0;
flat in float vGrow;
flat in vec3 vColor;
flat in float vIntensity;
flat in float vSpectral;
flat in float vInside;
flat in vec2 vHot;
flat in float vSeed;

uniform float uTime;
uniform float uWhiteGain;
uniform float uSpecGain;
uniform float uInsideGain;
uniform float uSpecCompRef;
uniform float uSpecCompMax;
uniform float uFringeOffset;
uniform float uFringeChroma;
uniform float uGrainAmount;
uniform float uGrainDrift;
uniform float uHotRadius;
uniform float uHotGain;

out vec4 outColor;

const float PROFILE_EXTENT = 1.25;

float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float capsuleDist(float along, float across, float len) {
  float t = clamp(along, 0.0, len);
  float da = along - t;
  return sqrt(da * da + across * across);
}

// Inverse-tonemapping the reference column (ref_001.jpg x = 400) back to scene-linear
// radiance fits a super-gaussian, exp(-(k|v|)^n): smooth and non-zero everywhere inside
// the quad. That property matters more than the exponents. The old profile was a flat top
// with compact support, so the +/-2.6 px per-channel offsets could only differ across the
// one steep pixel band at |v| = 1 and stroked two saturated rails there; a profile whose
// slope is spread over the whole shoulder tints the whole falloff instead, which is what
// the reference does.
float beamProfile(float v, float soft) {
  float a = abs(v);
  float k = mix(1.98, 2.05, soft);
  float n = mix(2.14, 1.90, soft);
  float p = exp(-pow(max(a * k, 1e-4), n));
  return p * (1.0 - smoothstep(PROFILE_EXTENT - 0.45, PROFILE_EXTENT, a));
}

void main() {
  float axialClamped = clamp(vAlong, 0.0, vLen);
  float hw = vHalfWidth0 + vGrow * axialClamped;
  float invHw = 1.0 / max(hw, 1e-3);

  vec3 energy;
  float coreness;

  if (vSpectral > 0.5) {
    float d = capsuleDist(vAlong, vAcross, vLen);
    float p = beamProfile(d * invHw, 1.0);
    if (p <= 1e-5) discard;
    // The wedge widens as it travels, so a fixed per-sample energy would read as a beam
    // fading out. REFERENCE.md 5.3: the reference wedge is close to constant brightness
    // over the whole board, dimming only ~14 % across 200 px.
    float comp = 1.0 + uSpecCompMax * min(axialClamped / max(uSpecCompRef, 1.0), 1.0);
    float gain = mix(uSpecGain * comp, uInsideGain, vInside);
    energy = vColor * (p * gain * vIntensity);
    coreness = p;
  } else {
    // vAcross is already signed by the ray's own transverse frame, so shifting R to the
    // +side and B to the -side puts the amber shoulder wherever the tracer says it goes.
    // abs() lives inside beamProfile, which is the symmetric part.
    float off = uFringeOffset;
    float dR = capsuleDist(vAlong, vAcross - off, vLen);
    float dG = capsuleDist(vAlong, vAcross, vLen);
    float dB = capsuleDist(vAlong, vAcross + off, vLen);
    vec3 p = vec3(
      beamProfile(dR * invHw, 0.0),
      beamProfile(dG * invHw, 0.0),
      beamProfile(dB * invHw, 0.0)
    );
    if (p.r + p.g + p.b <= 3e-5) discard;
    float m = (p.r + p.g + p.b) * (1.0 / 3.0);
    p = max(m + (p - m) * uFringeChroma, vec3(0.0));
    energy = vColor * p * (uWhiteGain * vIntensity);
    coreness = p.g;
  }

  float drift = uTime * uGrainDrift;
  float ax = vAlong - drift + vSeed * 91.0;
  float lat = vAcross * 0.2 + vSeed;
  float n = vnoise(vec2(ax * 0.031, lat)) - 0.5;
  n += 0.70 * (vnoise(vec2(ax * 0.066 + 13.7, lat * 1.7 + 4.1)) - 0.5);
  n += 0.45 * (vnoise(vec2(ax * 0.125 + 71.3, lat * 2.4 + 9.6)) - 0.5);
  float grainWeight = mix(0.55, 1.0, smoothstep(0.25, 0.9, coreness));
  energy *= max(1.0 + n * uGrainAmount * grainWeight, 0.0);

  float dA = length(vec2(vAlong, vAcross));
  float dB2 = length(vec2(vAlong - vLen, vAcross));
  float hr2 = max(uHotRadius * uHotRadius, 1.0);
  float hot = vHot.x * exp(-dA * dA / hr2) + vHot.y * exp(-dB2 * dB2 / hr2);
  energy *= 1.0 + hot * uHotGain;

  // White light does not attenuate with distance (REFERENCE.md 4.4). Per-bounce loss is
  // the tracer's business and already sits in vIntensity.

  if (energy.r + energy.g + energy.b < 1e-4) discard;

  float luma = dot(energy, vec3(0.2126, 0.7152, 0.0722));
  outColor = vec4(energy, clamp(luma, 0.0, 1.0));
}
`;

function toMat4(m) {
  if (m && m.length === 16) return m;
  if (m && m.length === 9) {
    const o = new Float32Array(16);
    o[0] = m[0]; o[1] = m[1]; o[2] = 0; o[3] = m[2];
    o[4] = m[3]; o[5] = m[4]; o[6] = 0; o[7] = m[5];
    o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0;
    o[12] = m[6]; o[13] = m[7]; o[14] = 0; o[15] = m[8];
    return o;
  }
  const id = new Float32Array(16);
  id[0] = 1; id[5] = 1; id[10] = 1; id[15] = 1;
  return id;
}

function hotStart(seg) {
  if (seg.generation === 0) return 1.0;
  // The first thing that happens inside the glass is the entry face lighting up, which is
  // where the reference prism reads brightest (REFERENCE.md 6.2).
  if (seg.inside) return 0.85;
  return seg.nm ? 0.16 : 0.5;
}

// A fold is a bounce, and a bounce is where the reference flares. `terminal === null` is
// the tracer's word for "the ray carries on" - a mirror face or a glass interface - so the
// incoming segment's end and the outgoing segment's start both get a hot spot there and
// the two overlap into the chevron the reference shows at every mirror. Spectral segments
// keep only a token flare: a fan crosses many interfaces and would otherwise pick up a
// bead at each one.
function hotEnd(seg) {
  const t = seg.terminal;
  if (typeof t === 'string' && t.indexOf('receptor') === 0) return 0.9;
  if (t === 'wall') return 0.12;
  if (t === null || t === undefined) return seg.nm ? 0.16 : 0.5;
  return 0.0;
}

export function createBeamRenderer(gl) {
  const program = createProgram(gl, VERT, FRAG);

  const uni = {
    viewProj: gl.getUniformLocation(program, 'uViewProj'),
    time: gl.getUniformLocation(program, 'uTime'),
    whiteHalfWidth: gl.getUniformLocation(program, 'uWhiteHalfWidth'),
    specHalfWidth: gl.getUniformLocation(program, 'uSpecHalfWidth'),
    insideHalfWidth: gl.getUniformLocation(program, 'uInsideHalfWidth'),
    specGrow: gl.getUniformLocation(program, 'uSpecGrow'),
    whiteGain: gl.getUniformLocation(program, 'uWhiteGain'),
    specGain: gl.getUniformLocation(program, 'uSpecGain'),
    insideGain: gl.getUniformLocation(program, 'uInsideGain'),
    specCompRef: gl.getUniformLocation(program, 'uSpecCompRef'),
    specCompMax: gl.getUniformLocation(program, 'uSpecCompMax'),
    fringeOffset: gl.getUniformLocation(program, 'uFringeOffset'),
    fringeChroma: gl.getUniformLocation(program, 'uFringeChroma'),
    grainAmount: gl.getUniformLocation(program, 'uGrainAmount'),
    grainDrift: gl.getUniformLocation(program, 'uGrainDrift'),
    hotRadius: gl.getUniformLocation(program, 'uHotRadius'),
    hotGain: gl.getUniformLocation(program, 'uHotGain'),
  };

  const params = Object.assign({}, DEFAULTS);

  const cornerBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    0.0, -1.0,
    0.0, 1.0,
    1.0, -1.0,
    1.0, 1.0,
  ]), gl.STATIC_DRAW);

  const instanceBuffer = gl.createBuffer();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
  gl.vertexAttribDivisor(0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, INSTANCE_STRIDE, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 3, gl.FLOAT, false, INSTANCE_STRIDE, 16);
  gl.vertexAttribDivisor(2, 1);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 3, gl.FLOAT, false, INSTANCE_STRIDE, 28);
  gl.vertexAttribDivisor(3, 1);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 3, gl.FLOAT, false, INSTANCE_STRIDE, 40);
  gl.vertexAttribDivisor(4, 1);

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  let data = new Float32Array(1024 * FLOATS_PER_INSTANCE);
  let capacity = 1024;
  let allocated = 0;
  let count = 0;
  let disposed = false;

  const colorCache = new Map();
  function linearForNm(nm) {
    const key = Math.round(nm * 4) * 0.25;
    let c = colorCache.get(key);
    if (!c) {
      const rgb = nmToRenderRGB(key);
      c = [rgb[0], rgb[1], rgb[2]];
      colorCache.set(key, c);
    }
    return c;
  }

  function ensureCapacity(n) {
    if (n <= capacity) return;
    let next = capacity;
    while (next < n) next *= 2;
    data = new Float32Array(next * FLOATS_PER_INSTANCE);
    capacity = next;
  }

  function upload(segments) {
    if (disposed) return;
    const list = segments || [];
    ensureCapacity(list.length || 1);

    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const dx = s.bx - s.ax;
      const dy = s.by - s.ay;
      if (dx * dx + dy * dy < 1e-8) continue;
      const intensity = s.intensity === undefined ? 1.0 : s.intensity;
      if (!(intensity > 0.0004)) continue;

      const spectral = s.nm ? 1.0 : 0.0;
      let r = 1.0;
      let g = 1.0;
      let b = 1.0;
      if (spectral === 1.0) {
        const c = linearForNm(s.nm);
        r = c[0]; g = c[1]; b = c[2];
      }

      // The handedness is a property of the ray, carried by the tracer. Falling back to
      // generation parity is only correct for pure mirror chains, so it is a last resort.
      let perp;
      if (typeof s.perp === 'number' && s.perp !== 0) perp = s.perp > 0 ? 1.0 : -1.0;
      else perp = ((s.generation | 0) & 1) === 0 ? 1.0 : -1.0;

      data[w] = s.ax;
      data[w + 1] = s.ay;
      data[w + 2] = s.bx;
      data[w + 3] = s.by;
      data[w + 4] = r;
      data[w + 5] = g;
      data[w + 6] = b;
      data[w + 7] = intensity;
      data[w + 8] = spectral;
      data[w + 9] = perp;
      data[w + 10] = hotStart(s);
      data[w + 11] = hotEnd(s);
      data[w + 12] = s.inside ? 1.0 : 0.0;
      w += FLOATS_PER_INSTANCE;
    }

    count = w / FLOATS_PER_INSTANCE;
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    if (allocated !== capacity) {
      gl.bufferData(gl.ARRAY_BUFFER, capacity * INSTANCE_STRIDE, gl.DYNAMIC_DRAW);
      allocated = capacity;
    }
    if (count > 0) gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, w);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  function setParams(next) {
    if (!next) return;
    for (const k in DEFAULTS) {
      if (typeof next[k] === 'number') params[k] = next[k];
    }
  }

  function draw(glCtx, viewProj, time) {
    const g = glCtx || gl;
    if (disposed || count === 0) return;

    g.useProgram(program);
    g.bindVertexArray(vao);

    g.uniformMatrix4fv(uni.viewProj, false, toMat4(viewProj));
    g.uniform1f(uni.time, time || 0);
    g.uniform1f(uni.whiteHalfWidth, params.whiteHalfWidth);
    g.uniform1f(uni.specHalfWidth, params.spectralHalfWidth);
    g.uniform1f(uni.insideHalfWidth, params.insideHalfWidth);
    g.uniform1f(uni.specGrow, params.spectralGrow);
    g.uniform1f(uni.whiteGain, params.whiteGain);
    g.uniform1f(uni.specGain, params.spectralGain);
    g.uniform1f(uni.insideGain, params.insideGain);
    g.uniform1f(uni.specCompRef, params.spectralCompRef);
    g.uniform1f(uni.specCompMax, params.spectralCompMax);
    g.uniform1f(uni.fringeOffset, unitsFromPx(params.fringeOffsetPx));
    g.uniform1f(uni.fringeChroma, params.fringeChroma);
    g.uniform1f(uni.grainAmount, params.grainAmount);
    g.uniform1f(uni.grainDrift, params.grainDrift);
    g.uniform1f(uni.hotRadius, params.hotRadius);
    g.uniform1f(uni.hotGain, params.hotGain);

    g.disable(g.DEPTH_TEST);
    g.disable(g.CULL_FACE);
    g.enable(g.BLEND);
    g.blendEquation(g.FUNC_ADD);
    g.blendFuncSeparate(g.ONE, g.ONE, g.ONE, g.ONE);

    g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, count);

    g.bindVertexArray(null);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    gl.deleteVertexArray(vao);
    gl.deleteBuffer(instanceBuffer);
    gl.deleteBuffer(cornerBuffer);
    gl.deleteProgram(program);
    colorCache.clear();
    count = 0;
  }

  return { upload, draw, setParams, dispose };
}
