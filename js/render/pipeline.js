// HDR post chain: RGBA16F scene target (RGBA8 + exposure pre-scale fallback), soft-knee
// bright pass, progressive dual-filter bloom (13-tap down, 9-tap tent up), then a
// composite pass with ACES tonemapping, film grain, radial chromatic aberration and
// vignette. Every parameter is live-tweakable through setParams.

import {
  createProgram,
  createQuad,
  createFBO,
  getExtensions,
  getUniformLocations,
  FULLSCREEN_VS,
} from './gl.js';
import { createNoiseTexture } from './textures.js';

const MAX_BLOOM_STEPS = 6;
const FALLBACK_HDR_SCALE = 0.25;

// The contract documents setParams as taking scalars ({bloom, grain, aberration,
// vignette, exposure}); this module expands each into a group. Accept both spellings so a
// scalar reaches the group's headline property instead of overwriting the group.
const SCALAR_TARGET = { bloom: 'intensity', grain: 'amount', aberration: 'amount', vignette: 'amount' };

function normalizeParams(patch) {
  const out = {};
  for (const [key, value] of Object.entries(patch || {})) {
    const target = SCALAR_TARGET[key];
    out[key] = (target && typeof value === 'number') ? { [target]: value } : value;
  }
  return out;
}

const DEFAULTS = {
  exposure: 1.0,
  bloom: {
    enabled: true,
    threshold: 0.72,
    knee: 0.45,
    intensity: 0.62,
    radius: 1.0,
    steps: 6,
  },
  grain: {
    amount: 0.018,
    size: 1.0,
    speed: 1.0,
    shadowWeight: 0.35,
  },
  aberration: {
    amount: 0.0009,
    power: 3.2,
  },
  vignette: {
    amount: 0.11,
    radius: 0.82,
    softness: 0.6,
  },
  tonemap: {
    enabled: true,
  },
  dither: 0.6,
};

const COMMON = `
precision highp float;
precision highp int;
precision highp sampler2D;
`;

const PREFILTER_FS = `#version 300 es
${COMMON}
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_src;
uniform vec2 u_srcTexel;
uniform vec3 u_curve;
uniform float u_threshold;
uniform float u_unscale;

vec3 sampleBox13(vec2 uv) {
  vec2 t = u_srcTexel;
  vec3 a = texture(u_src, uv + t * vec2(-2.0, 2.0)).rgb;
  vec3 b = texture(u_src, uv + t * vec2(0.0, 2.0)).rgb;
  vec3 c = texture(u_src, uv + t * vec2(2.0, 2.0)).rgb;
  vec3 d = texture(u_src, uv + t * vec2(-2.0, 0.0)).rgb;
  vec3 e = texture(u_src, uv).rgb;
  vec3 f = texture(u_src, uv + t * vec2(2.0, 0.0)).rgb;
  vec3 g = texture(u_src, uv + t * vec2(-2.0, -2.0)).rgb;
  vec3 h = texture(u_src, uv + t * vec2(0.0, -2.0)).rgb;
  vec3 i = texture(u_src, uv + t * vec2(2.0, -2.0)).rgb;
  vec3 j = texture(u_src, uv + t * vec2(-1.0, 1.0)).rgb;
  vec3 k = texture(u_src, uv + t * vec2(1.0, 1.0)).rgb;
  vec3 l = texture(u_src, uv + t * vec2(-1.0, -1.0)).rgb;
  vec3 m = texture(u_src, uv + t * vec2(1.0, -1.0)).rgb;
  vec3 r = e * 0.125;
  r += (a + c + g + i) * 0.03125;
  r += (b + d + f + h) * 0.0625;
  r += (j + k + l + m) * 0.125;
  return r;
}

void main() {
  vec3 c = sampleBox13(v_uv) * u_unscale;
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - u_curve.x, 0.0, u_curve.y);
  soft = u_curve.z * soft * soft;
  float contribution = max(soft, br - u_threshold) / max(br, 0.0001);
  fragColor = vec4(c * contribution, 1.0);
}
`;

const DOWNSAMPLE_FS = `#version 300 es
${COMMON}
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_src;
uniform vec2 u_srcTexel;

void main() {
  vec2 t = u_srcTexel;
  vec3 a = texture(u_src, v_uv + t * vec2(-2.0, 2.0)).rgb;
  vec3 b = texture(u_src, v_uv + t * vec2(0.0, 2.0)).rgb;
  vec3 c = texture(u_src, v_uv + t * vec2(2.0, 2.0)).rgb;
  vec3 d = texture(u_src, v_uv + t * vec2(-2.0, 0.0)).rgb;
  vec3 e = texture(u_src, v_uv).rgb;
  vec3 f = texture(u_src, v_uv + t * vec2(2.0, 0.0)).rgb;
  vec3 g = texture(u_src, v_uv + t * vec2(-2.0, -2.0)).rgb;
  vec3 h = texture(u_src, v_uv + t * vec2(0.0, -2.0)).rgb;
  vec3 i = texture(u_src, v_uv + t * vec2(2.0, -2.0)).rgb;
  vec3 j = texture(u_src, v_uv + t * vec2(-1.0, 1.0)).rgb;
  vec3 k = texture(u_src, v_uv + t * vec2(1.0, 1.0)).rgb;
  vec3 l = texture(u_src, v_uv + t * vec2(-1.0, -1.0)).rgb;
  vec3 m = texture(u_src, v_uv + t * vec2(1.0, -1.0)).rgb;
  vec3 r = e * 0.125;
  r += (a + c + g + i) * 0.03125;
  r += (b + d + f + h) * 0.0625;
  r += (j + k + l + m) * 0.125;
  fragColor = vec4(r, 1.0);
}
`;

const UPSAMPLE_FS = `#version 300 es
${COMMON}
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_src;
uniform vec2 u_srcTexel;
uniform float u_radius;

void main() {
  vec2 o = u_srcTexel * u_radius;
  vec3 s = texture(u_src, v_uv + vec2(-o.x, o.y)).rgb;
  s += texture(u_src, v_uv + vec2(0.0, o.y)).rgb * 2.0;
  s += texture(u_src, v_uv + vec2(o.x, o.y)).rgb;
  s += texture(u_src, v_uv + vec2(-o.x, 0.0)).rgb * 2.0;
  s += texture(u_src, v_uv).rgb * 4.0;
  s += texture(u_src, v_uv + vec2(o.x, 0.0)).rgb * 2.0;
  s += texture(u_src, v_uv + vec2(-o.x, -o.y)).rgb;
  s += texture(u_src, v_uv + vec2(0.0, -o.y)).rgb * 2.0;
  s += texture(u_src, v_uv + vec2(o.x, -o.y)).rgb;
  fragColor = vec4(s * 0.0625, 1.0);
}
`;

const COMPOSITE_FS = `#version 300 es
${COMMON}
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform sampler2D u_noise;
uniform vec2 u_noiseScale;
uniform vec2 u_noiseOffset;
uniform float u_exposure;
uniform float u_unscale;
uniform float u_bloomIntensity;
uniform float u_aberration;
uniform float u_aberrationPower;
uniform float u_grainAmount;
uniform float u_grainShadow;
uniform float u_vignetteAmount;
uniform float u_vignetteRadius;
uniform float u_vignetteSoftness;
uniform float u_dither;
uniform float u_tonemap;

vec3 aces(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 linearToSRGB(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(hi, lo, step(c, vec3(0.0031308)));
}

void main() {
  vec2 uv = v_uv;
  vec2 centred = uv - 0.5;
  float r2 = dot(centred, centred) * 4.0;
  float radial = pow(clamp(r2, 0.0, 1.0), u_aberrationPower * 0.5);
  vec2 dir = centred * u_aberration * radial;

  vec3 scene;
  vec3 bloom;
  if (u_aberration > 0.0) {
    scene.r = texture(u_scene, uv + dir).r;
    scene.g = texture(u_scene, uv).g;
    scene.b = texture(u_scene, uv - dir).b;
    bloom.r = texture(u_bloom, uv + dir).r;
    bloom.g = texture(u_bloom, uv).g;
    bloom.b = texture(u_bloom, uv - dir).b;
  } else {
    scene = texture(u_scene, uv).rgb;
    bloom = texture(u_bloom, uv).rgb;
  }

  vec3 color = scene * u_unscale + bloom * u_bloomIntensity;

  float vr = length(centred) * 2.0;
  float vig = 1.0 - u_vignetteAmount *
    smoothstep(u_vignetteRadius, u_vignetteRadius + u_vignetteSoftness, vr);
  color *= vig;

  color *= u_exposure;
  color = mix(clamp(color, 0.0, 1.0), aces(color), u_tonemap);
  color = linearToSRGB(color);

  vec3 n = texture(u_noise, gl_FragCoord.xy * u_noiseScale + u_noiseOffset).rgb;
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float weight = mix(u_grainShadow, 1.0, 1.0 - pow(abs(luma * 2.0 - 1.0), 1.6));
  color += (n - 0.5) * (u_grainAmount * weight);

  float dither = (n.g - 0.5) * (u_dither / 255.0);
  fragColor = vec4(max(color + dither, vec3(0.0)), 1.0);
}
`;

function deepMerge(target, patch) {
  for (const key of Object.keys(patch || {})) {
    const v = patch[key];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      deepMerge(target[key], v);
    } else if (v !== undefined) {
      target[key] = v;
    }
  }
  return target;
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

export function createPipeline(gl) {
  const ext = getExtensions(gl);
  const hdr = ext.canRenderHalfFloat;
  const hdrScale = hdr ? 1.0 : FALLBACK_HDR_SCALE;
  const params = clone(DEFAULTS);

  const quad = createQuad(gl);
  const noise = createNoiseTexture(gl, { size: 128 });

  const progPrefilter = createProgram(gl, FULLSCREEN_VS, PREFILTER_FS, 'bloom-prefilter');
  const progDown = createProgram(gl, FULLSCREEN_VS, DOWNSAMPLE_FS, 'bloom-downsample');
  const progUp = createProgram(gl, FULLSCREEN_VS, UPSAMPLE_FS, 'bloom-upsample');
  const progComposite = createProgram(gl, FULLSCREEN_VS, COMPOSITE_FS, 'composite');

  const uPre = getUniformLocations(gl, progPrefilter, [
    'u_src', 'u_srcTexel', 'u_curve', 'u_threshold', 'u_unscale',
  ]);
  const uDown = getUniformLocations(gl, progDown, ['u_src', 'u_srcTexel']);
  const uUp = getUniformLocations(gl, progUp, ['u_src', 'u_srcTexel', 'u_radius']);
  const uComp = getUniformLocations(gl, progComposite, [
    'u_scene', 'u_bloom', 'u_noise', 'u_noiseScale', 'u_noiseOffset',
    'u_exposure', 'u_unscale', 'u_bloomIntensity', 'u_aberration', 'u_aberrationPower',
    'u_grainAmount', 'u_grainShadow', 'u_vignetteAmount', 'u_vignetteRadius',
    'u_vignetteSoftness', 'u_dither', 'u_tonemap',
  ]);

  let scene = null;
  let mips = [];
  let width = 0;
  let height = 0;
  let activeSteps = 0;
  let frameIndex = 0;
  let timeSeconds = 0;
  let running = false;

  function allocate(w, h) {
    if (scene && w === width && h === height) return;
    width = w;
    height = h;
    if (!scene) {
      scene = createFBO(gl, w, h, { float: hdr, linear: true });
    } else {
      scene.resize(w, h);
    }
    for (const m of mips) m.dispose();
    mips = [];
    let mw = w;
    let mh = h;
    for (let i = 0; i < MAX_BLOOM_STEPS; i++) {
      mw = Math.max(1, mw >> 1);
      mh = Math.max(1, mh >> 1);
      if (mw < 8 || mh < 8) break;
      mips.push(createFBO(gl, mw, mh, { float: hdr, linear: true }));
    }
  }

  function bindSource(fbo, unit) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, fbo.tex);
  }

  function runBloom() {
    const steps = Math.max(1, Math.min(params.bloom.steps | 0, mips.length));
    activeSteps = steps;
    const knee = Math.max(0.0001, params.bloom.knee);
    const threshold = params.bloom.threshold;

    gl.disable(gl.BLEND);

    // Bright pass into mip 0, which also performs the first half-resolution downsample.
    gl.useProgram(progPrefilter);
    mips[0].bind();
    bindSource(scene, 0);
    gl.uniform1i(uPre.u_src, 0);
    gl.uniform2f(uPre.u_srcTexel, 1 / scene.w, 1 / scene.h);
    gl.uniform3f(uPre.u_curve, threshold - knee, knee * 2.0, 0.25 / knee);
    gl.uniform1f(uPre.u_threshold, threshold);
    gl.uniform1f(uPre.u_unscale, 1 / hdrScale);
    quad.draw();

    gl.useProgram(progDown);
    gl.uniform1i(uDown.u_src, 0);
    for (let i = 1; i < steps; i++) {
      const src = mips[i - 1];
      mips[i].bind();
      bindSource(src, 0);
      gl.uniform2f(uDown.u_srcTexel, 1 / src.w, 1 / src.h);
      quad.draw();
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(progUp);
    gl.uniform1i(uUp.u_src, 0);
    gl.uniform1f(uUp.u_radius, params.bloom.radius);
    for (let i = steps - 1; i > 0; i--) {
      const src = mips[i];
      mips[i - 1].bind();
      bindSource(src, 0);
      gl.uniform2f(uUp.u_srcTexel, 1 / src.w, 1 / src.h);
      quad.draw();
    }
    gl.disable(gl.BLEND);
  }

  function composite() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.useProgram(progComposite);

    bindSource(scene, 0);
    gl.uniform1i(uComp.u_scene, 0);

    const bloomOn = params.bloom.enabled && mips.length > 0;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bloomOn ? mips[0].tex : scene.tex);
    gl.uniform1i(uComp.u_bloom, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, noise.tex);
    gl.uniform1i(uComp.u_noise, 2);

    const grainSize = Math.max(0.1, params.grain.size);
    gl.uniform2f(uComp.u_noiseScale, 1 / (noise.w * grainSize), 1 / (noise.h * grainSize));

    // Two coprime-ish irrational strides keep the animated grain from ever landing
    // back on the same tile phase.
    const t = frameIndex * params.grain.speed;
    gl.uniform2f(uComp.u_noiseOffset, (t * 0.7548776662) % 1.0, (t * 0.5698402909) % 1.0);

    gl.uniform1f(uComp.u_exposure, params.exposure);
    gl.uniform1f(uComp.u_unscale, 1 / hdrScale);
    gl.uniform1f(uComp.u_bloomIntensity, bloomOn ? params.bloom.intensity / activeSteps : 0);
    gl.uniform1f(uComp.u_aberration, params.aberration.amount);
    gl.uniform1f(uComp.u_aberrationPower, params.aberration.power);
    gl.uniform1f(uComp.u_grainAmount, params.grain.amount);
    gl.uniform1f(uComp.u_grainShadow, params.grain.shadowWeight);
    gl.uniform1f(uComp.u_vignetteAmount, params.vignette.amount);
    gl.uniform1f(uComp.u_vignetteRadius, params.vignette.radius);
    gl.uniform1f(uComp.u_vignetteSoftness, Math.max(0.0001, params.vignette.softness));
    gl.uniform1f(uComp.u_dither, params.dither);
    gl.uniform1f(uComp.u_tonemap, params.tonemap.enabled ? 1 : 0);
    quad.draw();

    gl.activeTexture(gl.TEXTURE0);
  }

  const api = {
    // Assign a function here and call frame() to have the pipeline drive the scene draw.
    drawSceneCallback: null,

    // Linear-HDR values written by scene shaders must be multiplied by this. It is 1 on
    // hardware with float render targets and 0.25 on the RGBA8 fallback, where it buys
    // two stops of highlight headroom before the 8-bit target clips.
    get hdrScale() {
      return hdrScale;
    },
    get isHDR() {
      return hdr;
    },
    get sceneTarget() {
      return scene;
    },
    get width() {
      return width;
    },
    get height() {
      return height;
    },

    begin(w, h) {
      allocate(Math.max(1, w | 0), Math.max(1, h | 0));
      running = true;
      scene.bind();
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },

    end() {
      if (!running) return;
      running = false;
      frameIndex++;
      if (params.bloom.enabled && mips.length > 0) runBloom();
      composite();
    },

    frame(w, h, draw) {
      api.begin(w, h);
      const fn = draw || api.drawSceneCallback;
      if (fn) fn(gl, scene);
      api.end();
    },

    setTime(seconds) {
      timeSeconds = seconds;
    },
    get time() {
      return timeSeconds;
    },

    setParams(patch) {
      deepMerge(params, normalizeParams(patch));
      params.bloom.steps = Math.max(1, Math.min(MAX_BLOOM_STEPS, params.bloom.steps | 0));
      return clone(params);
    },
    getParams() {
      return clone(params);
    },
    resetParams() {
      Object.assign(params, clone(DEFAULTS));
      return clone(params);
    },

    dispose() {
      if (scene) scene.dispose();
      for (const m of mips) m.dispose();
      mips = [];
      scene = null;
      noise.dispose();
      quad.dispose();
      gl.deleteProgram(progPrefilter);
      gl.deleteProgram(progDown);
      gl.deleteProgram(progUp);
      gl.deleteProgram(progComposite);
    },
  };

  return api;
}

export const PIPELINE_DEFAULTS = DEFAULTS;
