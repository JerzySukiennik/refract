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
//
// The integral is only as good as the linearity of the palette it sums. Every factor in
// nmToRenderRGB is linear in spectral power for exactly that reason; see the long note
// above it in spectrum.js. Two settings here finish the job, and both are measured, not
// tuned by eye: the splat's half-max radius must stay near the white beam's own so the
// wedge leaves the prism neutral across its full width, and the fan's peak must stay well
// under the clip point, because a clipped pixel has no hue at all.

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
  // Scene-linear radiance at the peak of the white beam, BEFORE bloom and BEFORE the ACES
  // tonemap. ARCHITECTURE.md 11.6 and REFERENCE.md 4.6 both forbid clipping the core: it
  // must land in 0.78-0.89 sRGB after tonemapping. Running the composite backwards --
  // linearToSRGB, then the ACES quadratic -- an sRGB core of 0.80 needs 0.462 linear at the
  // composite, of which the halo lobe supplies 0.035 and bloom a little more. Measured back
  // out of the capture at three rows of a long run: 0.797, 0.801, 0.818.
  whiteGain: 0.455,
  whiteHalfWidth: BEAM_HALF_WIDTH,
  // REFERENCE.md 5.3: peak fan brightness is 0.48 of the white beam's own core, and the
  // fan NEVER clips -- the measured peak is value 0.44 against a core near 0.92. At 0.18
  // the fan composited to value 1.000 over several degrees of arc at R >= 200 px, and a
  // clipped pixel has no hue left, which is most of why the far half of the wedge read as
  // a white-blue disc instead of a spectrum. At 0.095 the fan peaks at 0.46-0.49 of the
  // white core measured on a clean single-pass fan, inside 5.3's recommended 0.45-0.50.
  spectralGain: 0.095,
  // A dispersed ray is the same beam, only narrower in wavelength: it keeps the width of
  // the beam that entered the glass. Anything thinner stops neighbouring wavelengths
  // overlapping, and the fan degenerates into a saturated hue ramp with a knife-edge
  // between red and green -- which is exactly what it used to do at 16 u.
  //
  // What matters is the ratio of the splat's HALF-MAX radius (which sets how far out the
  // wedge stays neutral, REFERENCE.md 5.2) to its 10 %-of-peak radius (which sets the
  // wedge's visible width, 5.1). Widening the profile exponent from 1.90 to 2.60 pulls
  // that ratio from 1.89 down to 1.62. Together with the 1.5 -> 1.23 half-width, the
  // half-max radius only comes in from 15.6 reference px to 13.6 -- so the wedge still
  // leaves the prism neutral, measured sat 0.07-0.14 in its core at R = 45-80 against
  // REFERENCE.md 5.2's #606467 / #66686B -- while the 10 % radius comes in much harder,
  // from 29.5 px to 22.0, which is what narrows the visible wedge.
  spectralHalfWidth: BEAM_HALF_WIDTH * 1.23,
  spectralGrow: 0.012,
  spectralCompRef: 620.0,
  spectralCompMax: 1.35,
  // Inside the glass the path is a faint guide line, not a beam: REFERENCE.md 6.2 wants
  // one thin internal line with the body of the prism staying almost transparent.
  insideHalfWidth: 5.0,
  insideGain: 0.20,
  fringeOffsetPx: FRINGE_OFFSET_PX,
  // The fringe is carried as an antisymmetric difference (see the fragment shader), so
  // this scales the warm/cool split without touching the luminance profile at all. At 0.85
  // the shoulder 14 px off the centreline composites to #8D7859 against the reference's
  // measured #907860, i.e. R-B of 48 against 48. At 1.0 it overshoots to 57.
  fringeChroma: 0.85,
  // GRAIN IS CALIBRATED ON THE COMPOSITED PNG, NOT AT AUTHORING TIME. REFERENCE.md 4.3
  // measures 1.0-1.4 % residual sigma over the local mean in the core, and tells you to
  // author at 4-6 % because video compression eats the rest. Authoring 4.6 % here and
  // stopping was the bug: between this shader and the final pixel the signal loses about
  // 14x. Roughly 4x of that is the ACES curve, whose relative gain d(log sRGB)/d(log linear)
  // is only 0.25 at the core's 0.46 linear radiance, and the remaining ~2x is the 2x
  // supersample being box-filtered down to 720x694 at capture.
  //
  // So this number is set by MEASURING: take the beam centreline out of the PNG, subtract a
  // 13 px running mean, divide the residual sigma by the local mean. The old 0.16 read
  // 0.30 %. 0.55 read 2.18 % with the octave weights below, and looked like it: soft cloud.
  // 0.30 reads 1.03 % on the emitter run of the fresh board, inside 4.3's measured band and
  // within 8 % of the 0.95 % the same test gives on ref_001 itself.
  grainAmount: 0.30,
  grainDrift: 26.0,
  // The soft skirt the beam sits in: the "very light volumetric haze so beams read as
  // occupying air" that ARCHITECTURE.md 11 lists as a deliberate departure from 4.1, which
  // measures the reference beam as effectively black past 26 px.
  //
  // It used to be far too generous. Measured against ref_001 at 26 / 30 / 40 px off a clean
  // centreline the reference falls 2.9 % / 0.5 % / 0.2 % of core, and the old 0.035 / 1.2
  // lobe held 5.1 % / 3.5 % / 1.4 % -- so the beam never reached black, its silhouette
  // dissolved and the geometric apex of the V at a mirror went with it. Capturing with the
  // lobe switched off proved the tail was all halo and not bloom: the same three samples
  // read 0.4 % / 0.2 % / 0.15 %. The lobe is now less than half as wide and slightly
  // stronger at its centre, which puts it back under the measured skirt and lets it die by
  // 40 px, where sRGB's steep toe otherwise magnifies a thousandth of a nit into 4/255.
  haloGain: 0.055,
  haloWidth: 0.65,
  haloExtent: 1.9,
  hotRadius: 22.0,
  // REFERENCE.md 4.4 is explicit that at a mirror hit there is NO visible hot spot or flare
  // beyond the rod's own specular line -- "the beam simply turns" -- and that the glow around
  // the emitter mouth is only ~0.12 peak. 0.75 was strong enough to bloom a bead into the
  // inside of every V and soften the apex the reference draws sharp, so the whole term is
  // pulled back to a little over half.
  //
  // It is NOT what blows the emitter out. The clipped pixels at the mouth measure as a
  // 33 x 2 px horizontal bar at the slit itself, drawn by board.js; dropping this from 0.75
  // to 0.42 moved the frame maximum only from 0.988 to 0.986. That one belongs to the prop.
  hotGain: 0.42,
  // Display-referred shaping of the transported intensity, and the same trick coreProfile
  // uses a few dozen lines down: the reference's numbers are measured AFTER a tonemap, so
  // matching them means inverting ours.
  //
  // REFERENCE.md 4.5 measures core luma by generation as 0.885 then 0.755 -- a 14.7 % drop
  // at the first bounce -- and reads R = 0.90 out of it. But 0.90 of the linear radiance,
  // pushed through ACES at the core's operating point, is a 2 % drop on screen: measured on
  // r2-folding the three generations came out 0.801 / 0.787 / 0.750, so every leg of a
  // four-bounce path read the same brightness and the beam lost all sense of travel. The
  // tracer keeps the physical 0.90 -- that is its contract and it is what the puzzle logic
  // and the receptors see. This exponent applies only to how it is DRAWN, and only to white
  // segments: raising it to a power leaves generation 0 at exactly 1.0 and deepens each
  // later bounce until the drop on screen matches 4.5. Spectral and in-glass segments are
  // excluded, because their intensities are wavelength weights whose sum has to stay
  // neutral (see the header) and a power would tilt the spectrum.
  intensityShape: 4.0,
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
uniform float uHaloExtent;

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
  // White segments carry the wide haze skirt and need a quad big enough to hold it; the
  // spectral fan does not, and there are far more of those, so it keeps the tight quad.
  float extent = mix(max(uHaloExtent, PROFILE_EXTENT), PROFILE_EXTENT, max(spectral, inside));
  float margin = hw * extent + fringeMargin;

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
uniform float uIntensityShape;
uniform float uHaloGain;
uniform float uHaloWidth;
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

// The transverse profile, REFERENCE.md 4.1 -- but corrected for the tonemap.
//
// 4.1 fits the beam as exp(-(|r|/16.0)^1.9) and offers the shader form
// pow(saturate(1 - pow(|v|, 1.9)), 1.35) with v = 1 at 26 px. That fit was made against
// LUMINANCE SAMPLED OFF THE VIDEO, i.e. in display space, after the reference's own
// tonemap and sRGB encode. This shader writes scene-linear radiance which then goes
// through ACES and linearToSRGB in the composite, and both of those lift midtones hard.
// Writing 4.1's curve as linear radiance and measuring the composited result gave FWHM
// 42.5 px against the measured 31, and a core 24 px wide against the measured 13: the beam
// came out a third too fat with a bloated top, because the tonemap flattened an already
// flat curve.
//
// So the composite is inverted instead. Taking the 4.1 profile table as the target in
// DISPLAY space, mapping each entry back through linearToSRGB and the ACES quadratic, and
// refitting pow(1 - |v|^n, m) to the resulting linear values gives n = 1.35, m = 2.07.
// Composited, that returns 0.76 at 2 px, 0.71 at 6, 0.49 at 10, 0.31 at 14, 0.17 at 18 and
// 0.06 at 22 against the measured 0.75, 0.71, 0.60, 0.47, 0.31, 0.14, with a 31 px FWHM, a
// 13 px core and 52 px total width -- the three numbers 4.1 states outright.
//
// The flat top survives the round trip: the tonemap is what supplies the flatness, so the
// linear curve underneath has to be the peakier one.
float coreProfile(float v) {
  float a = min(abs(v), 1.0);
  float b = 1.0 - pow(a, 1.35);
  return pow(max(b, 0.0), 2.07);
}

// The dispersed fan is a different problem: dozens of wedges have to sum per pixel into a
// smooth spectrum, so its profile stays a soft super-gaussian with no hard edge, faded out
// before the quad boundary so neighbouring wavelengths cross-fade instead of stacking
// visible rails. The exponent is the fan's width control: raising it flattens the top and
// steepens the skirt, which keeps neighbouring wavelengths overlapping (a neutral wedge
// near the prism) while shortening the faint tails that were spreading the visible wedge
// to 41 degrees. At 48 samples over ~29 degrees the sample spacing is under a fifth of the
// half-max radius, so no exponent in this range can let individual rails show through.
float spectralProfile(float v) {
  float a = abs(v);
  float p = exp(-pow(max(a * 2.05, 1e-4), 2.60));
  return p * (1.0 - smoothstep(PROFILE_EXTENT - 0.45, PROFILE_EXTENT, a));
}

void main() {
  float axialClamped = clamp(vAlong, 0.0, vLen);
  float hw = vHalfWidth0 + vGrow * axialClamped;
  float invHw = 1.0 / max(hw, 1e-3);

  vec3 energy;
  float coreness;

  // See DEFAULTS.intensityShape. White segments only; a spectral segment's intensity is a
  // wavelength weight and must pass through untouched.
  float shaped = mix(pow(max(vIntensity, 1e-5), uIntensityShape), vIntensity,
                     max(vSpectral, vInside));

  if (vSpectral > 0.5) {
    float d = capsuleDist(vAlong, vAcross, vLen);
    float p = spectralProfile(d * invHw);
    if (p <= 1e-5) discard;
    // The wedge widens as it travels, so a fixed per-sample energy would read as a beam
    // fading out. REFERENCE.md 5.3: the reference wedge is close to constant brightness
    // over the whole board, dimming only ~14 % across 200 px.
    float comp = 1.0 + uSpecCompMax * min(axialClamped / max(uSpecCompRef, 1.0), 1.0);
    float gain = mix(uSpecGain * comp, uInsideGain, vInside);
    energy = vColor * (p * gain * shaped);
    coreness = p;
  } else {
    // REFERENCE.md 4.2. vAcross is already signed by the ray's own transverse frame -- the
    // tracer mirrors it at every bounce -- so sampling the profile 2.6 px to the +side for
    // red and 2.6 px to the -side for blue puts the amber shoulder wherever the ray's own
    // handedness says it goes.
    //
    // The three samples are NOT used as the three channels directly. Their DIFFERENCE is,
    // and the luminance stays one symmetric profile underneath. Two things follow, and
    // both are the difference between a lit volume and a bar with piping on it:
    //
    //   - the core is exactly neutral. On the centreline the +2.6 and -2.6 samples are
    //     equal by symmetry, so the difference is identically zero and R = G = B. Feeding
    //     the samples straight in as channels instead leaves red and blue 9 % under green
    //     there: a visible green cast on the one part of the beam the reference measures as
    //     neutral (#C5C6C8, all three channels within 3/255).
    //   - no channel outlives the others at the edge. The profile has compact support, so
    //     three independent samples mean red is still alive where green has already died,
    //     which strokes a saturated orange rail down one side and a blue rail down the
    //     other -- ORCHESTRATOR-NOTES.md 9.1's "hard-edged coloured outline" exactly. Here
    //     the difference is scaled by the same envelope that is dying, so all three fade
    //     out together and the tint stays a gradient across the whole shoulder.
    float off = uFringeOffset;
    float pC = coreProfile(capsuleDist(vAlong, vAcross, vLen) * invHw);
    float pR = coreProfile(capsuleDist(vAlong, vAcross - off, vLen) * invHw);
    float pB = coreProfile(capsuleDist(vAlong, vAcross + off, vLen) * invHw);
    float fringe = (pR - pB) * 0.5 * uFringeChroma;
    vec3 p = max(vec3(pC + fringe, pC, pC - fringe), vec3(0.0));
    energy = vColor * p * (uWhiteGain * shaped);
    coreness = pC;
  }

  // Four octaves at the four periods REFERENCE.md 4.3 measured in the residual's power
  // spectrum -- 18.3, 11.7, 8.4 and 4.5 reference px along the beam, i.e. 0.031, 0.0486,
  // 0.0676 and 0.126 per board unit -- with the lateral scale giving the ~3 px correlation
  // length across the beam that the same section measures.
  //
  // The weights are tilted UP towards the short periods. An equal-weight or low-tilted
  // stack reads as cloud, not grain: at 4x zoom it made soft mottled blobs where the
  // reference shows fine longitudinal striation, because the 18 px octave carries the eye
  // and the 4.5 px one is invisible under it.
  float drift = uTime * uGrainDrift;
  float ax = vAlong - drift + vSeed * 91.0;
  float lat = vAcross * 0.2 + vSeed;
  float n = 0.55 * (vnoise(vec2(ax * 0.0310, lat)) - 0.5);
  n += 0.80 * (vnoise(vec2(ax * 0.0486 + 13.7, lat * 1.4 + 4.1)) - 0.5);
  n += 1.00 * (vnoise(vec2(ax * 0.0676 + 71.3, lat * 1.9 + 9.6)) - 0.5);
  n += 0.85 * (vnoise(vec2(ax * 0.1262 + 41.9, lat * 2.6 + 21.4)) - 0.5);
  // REFERENCE.md 4.3 puts the grain at 1.0-1.4 % in the core, 0.6-0.9 % on the shoulders and
  // 0.5 % in the wings, so it is weighted by how core-like the sample is. The window is
  // tighter than it used to be: a multiplicative ripple riding the steep outer gradient
  // displaces the silhouette sideways and gave the beam a visibly wavy edge, which the
  // reference does not have.
  float grainWeight = mix(0.30, 1.0, smoothstep(0.35, 0.95, coreness));
  energy *= max(1.0 + n * uGrainAmount * grainWeight, 0.0);

  // The haze skirt. Added after the grain so it stays smooth -- dust in the air scatters an
  // average of the beam, it does not flicker with it -- and before the hot term so a bounce
  // or the emitter mouth flares its own halo, which is the ~22 px circular glow
  // REFERENCE.md 4.4 measures at the slit. White beams only: the spectral fan is already
  // wide and a full spectrum puts two hundred of them on screen at once.
  if (vSpectral <= 0.5 && vInside <= 0.5) {
    float hv = capsuleDist(vAlong, vAcross, vLen) * invHw / max(uHaloWidth, 1e-3);
    energy += vColor * (exp(-hv * hv) * uHaloGain * uWhiteGain * shaped);
  }

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
    intensityShape: gl.getUniformLocation(program, 'uIntensityShape'),
    haloGain: gl.getUniformLocation(program, 'uHaloGain'),
    haloWidth: gl.getUniformLocation(program, 'uHaloWidth'),
    haloExtent: gl.getUniformLocation(program, 'uHaloExtent'),
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
    g.uniform1f(uni.intensityShape, params.intensityShape);
    g.uniform1f(uni.haloGain, params.haloGain);
    g.uniform1f(uni.haloWidth, params.haloWidth);
    g.uniform1f(uni.haloExtent, params.haloExtent);
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
