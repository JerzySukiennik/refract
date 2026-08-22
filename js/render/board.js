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
const READOUT_CAP = 7.0;

const RECEPTOR_R = 29;
const RECEPTOR_STROKE = 7.9;
const POLE_H = 77.5;
const POLE_W = 5.3;
const FLAG_W = 49.3;
const FLAG_H = 22.9;

const MAX_LIGHTS = 16;
const PLACE_MS = 150;

const TWO_PI = Math.PI * 2;

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

const BRICK_LIGHT = scene('#8E6C64');
const BRICK_MID = scene('#815751');
const BRICK_DARK = scene('#72463E');
const BRICK_RIM = scene('#7F605D');
const MORTAR = scene('#96706A');

const HOUSING = scene('#4D4B50');
const HOUSING_EDGE = scene('#7C7A82');
const SLIT = scene('#E0DEE1', 3.0);

const MIRROR_BODY = scene('#8F9AA6', 0.85);
const MIRROR_BACK = scene('#2A2E36');
const MIRROR_SPEC = scene('#FFFFFF', 0.42);
const MIRROR_GLOW = scene('#C4CEDA', 0.30);
const GLASS_EDGE = scene('#B9C4CE', 1.15);

const PROTRACTOR = scene('#8A7A78');
const READOUT = scene('#9A9298');

const RECEPTORS = {
  blue: { ring: [scene('#26549C'), scene('#43AAF9', 1.15)], flag: [scene('#183A7A'), scene('#4696E7', 1.1)] },
  green: { ring: [scene('#6EAF74'), scene('#B1F5B5', 1.15)], flag: [scene('#507C52'), scene('#AAF0B2', 1.1)] },
  orange: { ring: [scene('#9C682C'), scene('#EDB950', 1.15)], flag: [scene('#724420'), scene('#DEAC4C', 1.1)] },
  red: { ring: [scene('#9C3030'), scene('#F96060', 1.15)], flag: [scene('#7A2020'), scene('#E76060', 1.1)] },
  yellow: { ring: [scene('#9C9330'), scene('#F5E85C', 1.15)], flag: [scene('#7A7220'), scene('#E7DC5C', 1.1)] },
  cyan: { ring: [scene('#2A9098'), scene('#5CE8F5', 1.15)], flag: [scene('#1E6E76'), scene('#5CD8E7', 1.1)] },
  violet: { ring: [scene('#6A3A9C'), scene('#B47CF9', 1.15)], flag: [scene('#4E2A7A'), scene('#A47CE7', 1.1)] },
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
uniform vec3 uLight;
uniform vec3 uMid;
uniform vec3 uDark;
uniform vec3 uRim;
uniform vec3 uMortar;
uniform sampler2D uDetail;
uniform float uDetailMix;
${LIGHT_BLOCK}
void main() {
  float horiz = uHoriz;
  float thick = mix(uSize.x, uSize.y, horiz);
  float along = mix(uSize.y, uSize.x, horiz);
  float u = mix(vLocal.y + uSize.y * 0.5, vLocal.x + uSize.x * 0.5, horiz);
  float v = mix(vLocal.x + uSize.x * 0.5, vLocal.y + uSize.y * 0.5, horiz);
  float t = clamp(v / max(thick, 1e-3), 0.0, 1.0);

  float course = floor(v / ${COURSE_H.toFixed(2)});
  float rowOff = mod(course, 2.0) * ${(BRICK_LEN * 0.5).toFixed(3)};
  float bu = u + rowOff;
  float bIdx = floor(bu / ${BRICK_LEN.toFixed(2)});
  float fu = bu - bIdx * ${BRICK_LEN.toFixed(2)};
  float fv = v - course * ${COURSE_H.toFixed(2)};

  vec3 col = mix(uLight, uMid, smoothstep(0.07, 0.36, t));
  col = mix(col, uDark, smoothstep(0.36, 0.72, t));
  col = mix(col, uRim, smoothstep(0.72, 0.87, t));

  float r = hash21(vec2(bIdx, course) + 0.13);
  col *= 0.94 + 0.12 * r;
  float grit = vnoise(vec2(u, v) * 1.35 + vec2(bIdx * 7.0, course * 11.0));
  col *= 0.96 + 0.08 * grit;

  vec3 det = texture(uDetail, vec2(u / ${(BRICK_LEN * 4.0).toFixed(2)}, v / ${(COURSE_H * 4.0).toFixed(2)})).rgb;
  float detL = dot(det, vec3(0.299, 0.587, 0.114));
  col *= mix(1.0, 0.72 + 0.56 * detL, uDetailMix);

  float jx = min(fu, ${BRICK_LEN.toFixed(2)} - fu);
  float jy = min(fv, ${COURSE_H.toFixed(2)} - fv);
  float joint = 1.0 - min(smoothstep(0.0, ${JOINT_W.toFixed(2)}, jx), smoothstep(0.0, ${(JOINT_W * 0.85).toFixed(2)}, jy));
  col = mix(col, uMortar * (0.80 + 0.45 * (1.0 - t)), joint * 0.82);

  vec2 nrm = mix(vec2(sign(vLocal.x), 0.0), vec2(0.0, sign(vLocal.y)), horiz);
  if (t < 0.5) nrm = -nrm;
  nrm = normalize(nrm + vec2(1e-5));
  vec3 lit = gatherLight(vBoard, nrm);
  vec3 albedo = col;
  col = albedo * (1.0 + 0.85 * lit) + lit * albedo * 0.9 + lit * 0.10;

  float fadeV = smoothstep(0.0, 2.2 / max(thick, 1e-3), t) * smoothstep(1.0, 1.0 - 2.6 / max(thick, 1e-3), t);
  float endDist = along * 0.5 - abs(mix(vLocal.y, vLocal.x, horiz));
  float fadeU = smoothstep(0.0, 2.0, endDist);
  float a = fadeV * fadeU;
  fragColor = vec4(col * a, a);
}`;

const FS_BOX = `${FS_HEAD}
uniform vec2 uSize;
uniform vec3 uFill;
uniform vec3 uEdge;
${LIGHT_BLOCK}
void main() {
  vec2 h = uSize * 0.5;
  vec2 d = abs(vLocal) - h;
  float sd = min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
  float a = aa(sd);
  float bevel = smoothstep(0.0, 2.2, -sd);
  float outline = smoothstep(2.6, 0.4, -sd);
  vec3 col = mix(uEdge, uFill, bevel);
  float lit = clamp((-vLocal.x - vLocal.y) / max(uSize.x + uSize.y, 1e-3) + 0.5, 0.0, 1.0);
  col *= 0.72 + 0.62 * lit;
  col = mix(col, uFill * 0.28, outline * 0.55);
  col += uEdge * smoothstep(1.9, 0.9, -sd) * 0.55 * lit;
  vec2 nrm = normalize(vLocal + vec2(1e-4));
  col += uFill * gatherLight(vBoard, nrm) * 1.2;
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
void main() {
  float d = length(vLocal);
  float e = abs(d - uRadius);
  float core = exp(-pow(e / (uStroke * 0.52), 2.0));
  float glowR = mix(3.4, 6.0, uLit);
  float glow = exp(-e / glowR) * mix(0.34, 0.58, uLit);
  float inner = smoothstep(uRadius - uStroke * 0.6, 0.0, d);
  float disc = inner * mix(0.045, 0.26, uLit);
  float halo = exp(-max(d - uRadius, 0.0) / mix(5.0, 9.0, uLit)) * mix(0.05, 0.12, uLit);
  vec3 tint = mix(uRing, vec3(dot(uRing, vec3(0.30, 0.59, 0.11))), 0.30 * uLit);
  vec3 col = uRing * (core + glow) + tint * (disc + halo);
  fragColor = vec4(col * window(), 0.0);
}`;

const FS_FLAG = `${FS_HEAD}
uniform vec2 uSize;
uniform vec3 uColor;
uniform float uLit;
void main() {
  vec2 p = (vLocal + uSize * 0.5) / uSize;
  float x = clamp(p.x, 0.0, 1.0);
  float top = 0.04 + 0.032 * sin(x * 3.4);
  float bot = mix(0.97, top + 0.02, pow(x, 2.1)) + 0.085 * sin(x * 6.4 + 0.4) * (1.0 - x * x);
  bot = max(bot, top + 0.01);
  float inside = step(top, p.y) * step(p.y, bot) * step(0.0, p.x) * step(p.x, 1.0);
  float edge = min(min(p.y - top, bot - p.y), min(p.x, 1.0 - p.x)) * uSize.y;
  float a = inside * clamp(edge / max(uPx, 1e-3) + 0.5, 0.0, 1.0);
  float shade = 0.80 + 0.32 * smoothstep(1.0, 0.0, x) + 0.10 * sin(x * 6.0);
  vec3 col = uColor * shade * (1.0 + 0.85 * uLit);
  float rim = smoothstep(2.4, 0.0, edge) * inside;
  col += uColor * rim * (0.25 + 0.6 * uLit);
  fragColor = vec4(col * a, a);
}`;

const FS_POLE = `${FS_HEAD}
uniform vec2 uSize;
uniform vec3 uColor;
uniform float uLit;
void main() {
  vec2 h = uSize * 0.5;
  vec2 d = abs(vLocal) - h;
  float sd = min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
  float a = aa(sd);
  float across = clamp((vLocal.x + h.x) / uSize.x, 0.0, 1.0);
  float shade = 0.62 + 0.75 * exp(-pow((across - 0.34) / 0.26, 2.0));
  vec3 col = uColor * shade * (1.0 + 0.55 * uLit);
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
void main() {
  vec2 p = vLocal;
  float d = sdSeg(p, vec2(-uHalfLen, 0.0), vec2(uHalfLen, 0.0)) - uRad;
  float body = aa(d);

  float side = clamp(p.y / uRad, -1.0, 1.0);
  vec3 substrate = mix(uBody, uBack, smoothstep(-0.22, 0.34, side));
  substrate *= 0.80 + 0.42 * smoothstep(0.9, -0.5, side);
  float endFade = smoothstep(uHalfLen + uRad, uHalfLen - uRad * 0.4, abs(p.x));
  substrate *= 0.55 + 0.45 * endFade;

  float specY = p.y + uRad * 0.42;
  float lineProfile = exp(-pow(specY / (uRad * 0.17), 2.0));
  float lengthProfile = smoothstep(uHalfLen, uHalfLen - uRad * 0.9, abs(p.x));
  lengthProfile *= 0.84 + 0.16 * cos(p.x / max(uHalfLen, 1e-3) * 1.4);
  float spec = lineProfile * lengthProfile * body;

  float rim = smoothstep(1.5, 0.0, abs(d)) * step(side, 0.05);
  float front = smoothstep(0.45, -0.55, side);
  float halo = (exp(-max(d, 0.0) / 2.0) * 0.34 + exp(-max(d, 0.0) / 5.5) * 0.07)
             * lengthProfile * (0.45 + 0.75 * front);

  vec3 col = substrate;
  col += uLitColor * uLitAmount * (0.30 + 0.70 * lineProfile) * 0.45;
  vec3 add = uSpec * spec * (0.42 + 0.58 * uLitAmount);
  add += uGlow * rim * (0.5 + 0.8 * uLitAmount);
  add += mix(uGlow, uLitColor * 0.7, clamp(uLitAmount, 0.0, 1.0)) * halo * (0.55 + 1.0 * uLitAmount);

  float a = body * uAlpha;
  fragColor = vec4(col * a + add * uAlpha * window(), a);
}`;

const FS_PRISM = `${FS_HEAD}
uniform float uR;
uniform vec3 uEdge;
uniform vec3 uLitColor;
uniform float uLitAmount;
uniform float uAlpha;
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

  vec3 bodyTint = mix(vec3(0.55, 0.60, 0.68), uLitColor, clamp(uLitAmount * 1.3, 0.0, 1.0));
  float depth = smoothstep(0.0, uR * 0.9, -d);
  vec3 body = bodyTint * (0.055 + 0.10 * depth) * (1.0 + 2.6 * uLitAmount);

  vec2 a = vec2(-uR * 0.5, -uR * 0.866);
  vec2 b = vec2(uR * 0.72, 0.0);
  float path = exp(-pow(sdSeg(vLocal, a, b) / 1.6, 2.0)) * inside;

  float halo = exp(-max(d, 0.0) / 3.4) * (0.10 + 0.55 * uLitAmount);

  vec3 col = body;
  vec3 add = uEdge * edge * (0.85 + 2.2 * uLitAmount);
  add += mix(uEdge, uLitColor, clamp(uLitAmount, 0.0, 1.0)) * path * (0.30 + 1.1 * uLitAmount);
  add += mix(uEdge, uLitColor, 0.7) * halo;

  float alpha = inside * uAlpha * 0.55;
  fragColor = vec4(col * alpha + add * uAlpha * window(), alpha);
}`;

const FS_PROTRACTOR = `${FS_HEAD}
uniform float uR;
uniform vec3 uColor;
uniform vec2 uHandle;
uniform float uAlpha;
uniform float uSnap;
void main() {
  float d = length(vLocal);
  float ring = exp(-pow((d - uR) / 1.05, 2.0));

  float ang = atan(-vLocal.y, vLocal.x);
  float k = ang / 0.2617993878;
  float dk = abs(fract(k + 0.5) - 0.5);
  float tickBand = smoothstep(uR - 5.4, uR - 4.2, d) * smoothstep(uR - 0.6, uR - 1.9, d);
  float tick = smoothstep(0.055, 0.012, dk) * tickBand;

  float hd = length(vLocal - uHandle);
  float handle = smoothstep(${HANDLE_R.toFixed(2)}, ${(HANDLE_R - 1.1).toFixed(2)}, hd);
  float handleRing = smoothstep(${(HANDLE_R + 2.2).toFixed(2)}, ${HANDLE_R.toFixed(2)}, hd) * (1.0 - handle);
  float handleHalo = exp(-max(hd - ${HANDLE_R.toFixed(2)}, 0.0) / 5.5) * 0.22;

  vec3 col = uColor * (ring + tick * (0.45 + 0.9 * uSnap));
  col += vec3(2.6, 2.55, 2.5) * handle + vec3(0.55) * handleHalo;
  col *= 1.0 - 0.55 * handleRing;
  fragColor = vec4(max(col, vec3(0.0)) * uAlpha * window(), 0.0);
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
        if (t && typeof t === 'object') return t.texture || t;
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
  let detailMix = detail ? 0.34 : 0.0;
  if (!detail) {
    detail = fallbackTexture(gl);
    ownedTextures.push(detail);
    detailMix = 0.18;
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
        addLight(r.x, r.y, r.x, r.y, c[0] / peak, c[1] / peak, c[2] / peak, 0.16 + 0.5 * lit);
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

  function wallRects(level) {
    const out = [];
    out.push({ x: 0, y: 0, w: BOARD, h: WALL_T });
    out.push({ x: 0, y: BOARD - WALL_T, w: BOARD, h: WALL_T });
    out.push({ x: 0, y: WALL_T, w: WALL_T, h: BOARD - WALL_T * 2 });
    out.push({ x: BOARD - WALL_T, y: WALL_T, w: WALL_T, h: BOARD - WALL_T * 2 });
    if (level && Array.isArray(level.walls)) {
      for (const w of level.walls) {
        if (w && w.w > 0 && w.h > 0) out.push(w);
      }
    }
    return out;
  }

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
      gl.uniform2f(u.uSize, w.w, w.h);
      gl.uniform1f(u.uHoriz, w.w >= w.h ? 1 : 0);
      place(u, w.x + w.w / 2, w.y + w.h / 2, w.w / 2, w.h / 2, 0);
      drawQuad();
    }
  }

  function drawEmitter(level) {
    const e = level && level.emitter;
    if (!e) return;
    const dir = e.dir || 0;
    const cx = Math.cos(dir);
    const cy = -Math.sin(dir);
    const halfLen = 18;
    const halfAcross = 23;
    const hx = e.x - cx * halfLen;
    const hy = e.y - cy * halfLen;

    const ub = use(progs.box);
    gl.uniform2f(ub.uSize, halfLen * 2, halfAcross * 2);
    gl.uniform3fv(ub.uFill, HOUSING);
    gl.uniform3fv(ub.uEdge, HOUSING_EDGE);
    bindLights(ub);
    place(ub, hx, hy, halfLen + 3, halfAcross + 3, -dir);
    drawQuad();

    const ug = use(progs.glow);
    gl.uniform2f(ug.uSpan, 0, 0);
    gl.uniform1f(ug.uRadius, 42);
    gl.uniform1f(ug.uPower, 3.0);
    gl.uniform3f(ug.uColor, SLIT[0] * 0.13, SLIT[1] * 0.13, SLIT[2] * 0.14);
    place(ug, e.x, e.y, 42, 42, 0);
    drawQuad();

    const us = use(progs.slit);
    gl.uniform2f(us.uSpan, 0, 27);
    gl.uniform1f(us.uWidth, 2.6);
    gl.uniform3fv(us.uColor, SLIT);
    place(us, e.x, e.y, 30, 52, -dir);
    drawQuad();
  }

  function drawReceptors(level, dt) {
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

      const up = use(progs.pole);
      gl.uniform2f(up.uSize, POLE_W, POLE_H + raise + 2);
      gl.uniform3fv(up.uColor, new Float32Array(poleCol));
      gl.uniform1f(up.uLit, lit);
      place(up, r.x, (poleTop + r.y + 2) / 2, POLE_W / 2 + 11, (POLE_H + raise + 2) / 2 + 11, 0);
      drawQuad();

      const uf = use(progs.flag);
      gl.uniform2f(uf.uSize, FLAG_W, FLAG_H);
      gl.uniform3fv(uf.uColor, new Float32Array(flagCol));
      gl.uniform1f(uf.uLit, lit);
      place(uf, r.x + POLE_W * 0.35 + FLAG_W / 2, poleTop + FLAG_H / 2 + 1, FLAG_W / 2, FLAG_H / 2, 0);
      drawQuad();

      const ur = use(progs.receptor);
      gl.uniform3fv(ur.uRing, new Float32Array(ring));
      gl.uniform1f(ur.uLit, lit);
      gl.uniform1f(ur.uRadius, RECEPTOR_R);
      gl.uniform1f(ur.uStroke, RECEPTOR_STROKE);
      const halo = RECEPTOR_R + 46;
      place(ur, r.x, r.y, halo, halo, 0);
      drawQuad();
    }
  }

  function drawMirror(x, y, angle, alpha, scaleK) {
    const lit = opticIllumination(x, y);
    const u = use(progs.mirror);
    const hl = (MIRROR_LEN / 2) * scaleK;
    const rad = (MIRROR_T / 2) * scaleK;
    gl.uniform1f(u.uHalfLen, hl);
    gl.uniform1f(u.uRad, rad);
    gl.uniform3fv(u.uBody, MIRROR_BODY);
    gl.uniform3fv(u.uBack, MIRROR_BACK);
    gl.uniform3fv(u.uSpec, MIRROR_SPEC);
    gl.uniform3fv(u.uGlow, MIRROR_GLOW);
    gl.uniform3f(u.uLitColor, lit.r, lit.g, lit.b);
    gl.uniform1f(u.uLitAmount, lit.amount);
    gl.uniform1f(u.uAlpha, alpha);
    place(u, x, y, hl + 26, rad + 24, -angle);
    drawQuad();
  }

  function drawPrism(x, y, angle, alpha, scaleK) {
    const lit = opticIllumination(x, y);
    const u = use(progs.prism);
    const R = PRISM_R * scaleK;
    gl.uniform1f(u.uR, R);
    gl.uniform3fv(u.uEdge, GLASS_EDGE);
    gl.uniform3f(u.uLitColor, lit.r, lit.g, lit.b);
    gl.uniform1f(u.uLitAmount, lit.amount);
    gl.uniform1f(u.uAlpha, alpha);
    place(u, x, y, R + 26, R + 26, -angle);
    drawQuad();
  }

  function drawOptic(o, alpha, scaleK) {
    if (o.type === 'prism') drawPrism(o.x, o.y, o.angle || 0, alpha, scaleK);
    else drawMirror(o.x, o.y, o.angle || 0, alpha, scaleK);
  }

  function drawProtractor(o, scaleK, snapping) {
    const a = normAngle(o.angle || 0);
    const R = RING_R * scaleK;
    const u = use(progs.protractor);
    gl.uniform1f(u.uR, R);
    gl.uniform3fv(u.uColor, PROTRACTOR);
    gl.uniform2f(u.uHandle, Math.cos(a) * R, -Math.sin(a) * R);
    gl.uniform1f(u.uAlpha, scaleK);
    gl.uniform1f(u.uSnap, snapping ? 1 : 0);
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
      place(ut, o.x, o.y - R - 14 - textHalfH, textHalfW, textHalfH, 0);
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
    drawReceptors(level, dt);

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

    const ghost = state && (state.ghost || (state.dragging && typeof state.dragging === 'object'
      && state.dragging.x !== undefined ? state.dragging : null));
    if (ghost && ghost.type) {
      drawOptic(ghost, ghost.valid === false ? 0.20 : 0.42, 0.94);
      const ug = use(progs.glow);
      gl.uniform2f(ug.uSpan, 0, 0);
      gl.uniform1f(ug.uRadius, 26);
      gl.uniform1f(ug.uPower, 3.2);
      if (ghost.valid === false) gl.uniform3f(ug.uColor, 0.36, 0.05, 0.05);
      else gl.uniform3f(ug.uColor, 0.11, 0.13, 0.18);
      place(ug, ghost.x, ghost.y, 28, 28, 0);
      drawQuad();
    }

    const selId = state ? state.selectedId : null;
    if (selId !== null && selId !== undefined) {
      const sel = list.find((o) => o && o.id === selId);
      if (sel) {
        const age = nowMs - (bornAt.has(sel.id) ? bornAt.get(sel.id) : nowMs);
        const p = Math.min(Math.max(age / PLACE_MS, 0), 1);
        const ease = 1 - Math.pow(1 - p, 3);
        drawProtractor(sel, 0.72 + 0.28 * ease, !(state && state.shift));
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
