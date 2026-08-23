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

const FLOATS_PER_INSTANCE = 14;
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
  //
  // Round 4 takes one small measured step. The 7-reference-px core mean of the fresh board's
  // emitter run read 0.789 where 4.6 asks for ~0.82, and the haze skirt measured slightly
  // UNDER the reference at the same time (absolute luminance at 26 / 30 / 40 reference px:
  // 6.79 / 1.53 / 0.35 against 7.16 / 2.05 / 0.71), so the beam read translucent rather than
  // as a solid lit volume. This gain scales the core and the skirt together, which is what
  // is wanted. The step is sized, not guessed: the composite's local exponent at this
  // operating point is 0.48, so 0.82 / 0.789 = 1.039 on screen needs 1.039^(1/0.48) = 1.084
  // in linear radiance, i.e. 0.455 -> 0.493. It is NOT taken to 4.5's 0.885, which is a
  // measurement of ref_030's generation 0 and 0.06 above what 4.6 says the tonemap should
  // land on.
  whiteGain: 0.493,
  whiteHalfWidth: BEAM_HALF_WIDTH,
  // REFERENCE.md 5.3: peak fan brightness is 0.48 of the white beam's own core, and the
  // fan NEVER clips -- the measured peak is value 0.44 against a core near 0.92. At 0.18
  // the fan composited to value 1.000 over several degrees of arc at R >= 200 px, and a
  // clipped pixel has no hue left, which is most of why the far half of the wedge read as
  // a white-blue disc instead of a spectrum. At 0.095 the fan peaks at 0.46-0.49 of the
  // white core measured on a clean single-pass fan, inside 5.3's recommended 0.45-0.50.
  //
  // Round 3 narrowed the fan hard (see spectralHalfWidth and spectrum.js SOURCE_*) and the
  // obvious worry was that concentrating the same flux into two thirds of the arc would
  // push the peak through the clip point. It does not, because the source envelope removes
  // wing flux at the same time as the profile concentrates the middle: measured on the
  // clean rig, peak value at R = 45/60/80/100/120/140/180 went 0.390/0.394/0.411/0.407/
  // 0.420/0.435/0.442 before to 0.389/0.408/0.409/0.409/0.428/0.443/0.441 after -- flat,
  // and inside REFERENCE.md 5.3's measured 0.42-0.45, so this number stays. It must not be
  // raised to chase the brightness of a fan that is dim because its beam has already been
  // through three mirrors -- that dimming is the contract's 10 % per bounce, not a gain
  // error, and 0.46 is the clip line.
  //
  // ROUND 4. Re-measured on the clean free-field rig (a generation-0 white beam entering a
  // prism at 45 deg, no receptor within reach of the wedge), the fan peaks at 0.380 / 0.392
  // / 0.400 / 0.404 at R = 45 / 60 / 80 / 100 reference px against a white core of 0.827-
  // 0.835 -- so 0.46-0.48 of the core, which is 5.3's ratio, but 10 % under 5.3's absolute
  // 0.42-0.45 because our core is 0.83 where the reference's is 0.89. The round-4 critic
  // measured 0.354 and -21 %; that figure was taken on a board where the fan was truncated
  // by total internal reflection AND overlaid by a receptor halo, and it does not reproduce
  // here. The honest gap is the smaller one, and this closes it: 0.095 -> 0.118 lifts the
  // linear radiance by 1.24x, which at this operating point of the ACES curve is about
  // 1.16x on screen. 0.118 was a step past the mark -- it measured 0.439 / 0.443 / 0.459 /
  // 0.475 at those four radii against the reference's 0.43 / 0.42 / 0.42 / 0.45 -- so it is
  // trimmed back by the measured overshoot to land ON the band rather than above it.
  spectralGain: 0.105,
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
  //
  // Round 3 takes it one step further, 1.23 -> 1.05, with the exponent 2.60 -> 3.20. That
  // puts the 10 % radius at 17.3 reference px and the half-max at 11.9. The 17.3 is not a
  // taste call: solving the reference's own measured widths -- 24.5 deg at R = 120, 22.0
  // at 140, 19.2 at 180 -- for the two terms of (angular dispersion) + 2*(splat radius)/R
  // gives a splat 10 % radius of 16.5 reference px and 8.5 deg of dispersion under it. The
  // narrower splat did not cost the neutral wedge REFERENCE.md 5.2 wants -- it improved it.
  // Sampling the fan's own centreline on the clean rig, R = 45/60/80 read #565D5B / #505A57
  // / #455951 at saturation 0.075 / 0.111 / 0.225 before, and #61615F / #646865 / #5E6563 at
  // 0.021 / 0.038 / 0.069 after, against 5.2's measured #606467 and #66686B at sat < 0.10.
  spectralHalfWidth: BEAM_HALF_WIDTH * 1.05,
  spectralGrow: 0.012,
  spectralCompRef: 620.0,
  spectralCompMax: 1.35,
  // Inside the glass the path is a faint guide line, not a beam: REFERENCE.md 6.2 wants
  // one thin internal line with the body of the prism staying almost transparent.
  insideHalfWidth: 5.0,
  insideGain: 0.20,
  fringeOffsetPx: FRINGE_OFFSET_PX,
  // The fringe is carried as an antisymmetric difference (see the fragment shader), so
  // this scales the warm/cool split without touching the luminance profile at all.
  //
  // Two things were wrong at 0.85 and only one of them was this number. Measured on
  // r3-fresh against ref_001, our |R-B| peaked at 55 where the reference peaks at 50, and
  // it peaked at r = 18-20 px where the reference peaks at 14-16 -- the band sat two px too
  // far out, which is most of why the two shoulders read as painted stripes rather than as
  // dispersion. The POSITION belongs to coreProfile: the fringe is a difference of two
  // profile samples, so it peaks where the profile's gradient does, and the old profile's
  // gradient peaked too far out. Rebuilding the profile moved the band to r = 15 on its own,
  // which left only the amplitude here. Simulating the composite over the new profile,
  // 0.75 gives 49 / 50 / 45 at r = 14 / 16 / 18 against the reference's 47 / 50 / 45.
  fringeChroma: 0.75,
  // GRAIN IS CALIBRATED ON THE COMPOSITED PNG, NOT AT AUTHORING TIME, and it is calibrated
  // on the BAND-RESOLVED spectrum, not on an RMS number. REFERENCE.md 4.3 measures 1.0-1.4 %
  // residual sigma over the local mean in the core and tells you to author at 4-6 % because
  // video compression eats the rest; between this shader and the final pixel the signal
  // loses about 14x, most of it the ACES curve, whose relative gain d(log sRGB)/d(log
  // linear) is only about 0.25 at the core's operating radiance.
  //
  // AN RMS NUMBER IS NOT ENOUGH AND ROUNDS 2 AND 3 WERE FOOLED BY ONE. Both calibrated
  // against a 13 px running mean, which is blind to everything slower than 13 px -- and the
  // beam's fault was that essentially ALL of its energy was slower than that. At win13 the
  // old stack measured 0.58 % against the reference's 0.63 % and looked on target; measured
  // properly against a 101 px mean and split by period it had 0.1 % of its energy in the
  // 3-6 px band against the reference's 21-35 % and 77 % above 25 px against 13-30 %. Use
  // a 101 px detrend and read the bands. See the octave stack in the fragment shader.
  //
  // The amplitude itself is then one measured scalar: take the 7-reference-px core mean
  // along a long clean run out of the PNG, detrend with a 61 px mean, divide the residual
  // sigma by the local mean. The reference reads 0.72-0.81 % on ref_001 and ref_010.
  grainAmount: 0.14,
  // Lattice cells per second, NOT board units per second -- the drift is applied in noise
  // space so every octave crawls at the same visual rate. 26 u/s on the old stack's
  // dominant octave was 1.76 cells/s, which is what this preserves.
  grainDrift: 1.8,
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
  //
  // Re-measured on the composited PNG rather than argued about, sampling a clean 400 px
  // stretch of the fresh board's emitter run and the same three offsets on ref_001, the
  // 0.055 / 0.65 lobe read 1.5 % / 0.57 % / 0.18 % against the reference's 3.2 % / 0.50 % /
  // 0.21 % at 26 / 30 / 40 reference px. The note that stood here blamed the 26 px gap on
  // coreProfile's compact support and told the next builder to leave both alone. The first
  // half was right and the second half was wrong: the support WAS the problem, and the
  // profile has now been refitted with a real tail (see coreProfile), which is what closes
  // 26 px. This lobe is refitted jointly with it -- slightly stronger and much shorter, so
  // it fills the 20-26 px shoulder without re-inflating 30-40 px, where the old width was
  // already at the reference and had nowhere to go.
  haloGain: 0.060,
  haloWidth: 0.55,
  haloExtent: 1.9,
  // The radius of the mouth flare, in BOARD UNITS, and the unit is the whole story. 22 u is
  // 12.5 reference px, but REFERENCE.md 4.4 measures "a soft roughly circular glow of radius
  // ~22 px" -- 22 REFERENCE px, which is 39 board units. The old value was the reference's
  // number with the conversion left out, so the glow died at little more than half the
  // distance it should. Measured on half-circle arcs behind the mouth (r4-fresh against
  // ref_001) at 10 / 16 / 22 / 30 reference px, ours read 0.326 / 0.081 / 0.008 / 0.006
  // against the reference's 0.509 / 0.328 / 0.197 / 0.056: we tracked it to 16 px and then
  // fell off a cliff.
  //
  // Do NOT raise hotGain to compensate. The slit already peaks 0.95 against the reference's
  // 0.89 and it is drawn by board.js, not here; more gain would blow it further without
  // moving the 22 and 30 px arcs, which are fed by the bloom of a WIDE bright region rather
  // than by a brighter small one.
  hotRadius: 39.0,
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
  // Scene-linear radiance of the additive mouth glow at its centre, as a multiple of
  // whiteGain -- see the mouth-glow block in the fragment shader for why it cannot be
  // carried by hotGain. Calibrated on the arcs behind the mouth, which is the only place it
  // is not sitting on top of the beam or the housing: 0.40 with a gaussian lobe read
  // 0.642 / 0.470 / 0.320 / 0.166 at 10 / 16 / 22 / 30 reference px and 0.60 with the cubic
  // read 0.740 / 0.606 / 0.416 / 0.139, both well past the reference's
  // 0.509 / 0.328 / 0.197 / 0.056. Inverting the composite at 22 px -- sRGB, then the ACES
  // quadratic -- says the reference's 0.197 is 0.041 of scene radiance where 0.60 was
  // putting 0.107 there, so 0.60 * 0.041 / 0.107 = 0.23. Measured, 0.23 landed
  // 0.566 / 0.374 / 0.210 / 0.059 -- right shape, still 5-14 % over at every radius -- and
  // 0.20 lands on it. Do not chase the 10 px arc any further from here: at 10 reference px
  // the arc is mostly the HOUSING, which board.js draws, and ours is both smaller and darker
  // than the reference's #4D4B50 block.
  mouthGain: 0.20,
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
  //
  // The exponent is CALIBRATED, not guessed, and 4.0 went past the mark. Measuring the
  // 7 px core mean of each leg of the folding capture, 4.0 gave 0.851 / 0.694 / 0.578, a
  // 18.4 % first step against 4.5's measured 14.7 %. Over the small range that matters the
  // composited step is very nearly a power of the linear one -- 0.9^4 = 0.656 linear
  // produced 0.816 on screen, i.e. an effective exponent of 0.48 -- so the linear ratio
  // wanted is 0.853^(1/0.48) = 0.72, which is 0.9^3.2.
  //
  // 3.2 was fitted against the FOUR-BOUNCE endpoint and undershot the first step, which is
  // the one the eye actually reads.
  //
  // MEASURE THE LEGS ON A WINDOW THAT CONTAINS ONLY BEAM. r4-folding's top run passes under
  // the green receptor's halo for its last third, and a window that includes it reads the
  // generation-0 core 0.03 high and its residual spectrum almost entirely above 25 px --
  // the receptor's glow, not the beam's grain. Every number below is measured on windows
  // clear of every receptor and wall slab.
  //
  // So measured: 3.2 gives legs of 0.790 / 0.717 / 0.596 / 0.539, a -9.3 % first step with
  // the fourth leg at 0.682 of generation 0; 3.5 gives 0.815 / 0.732 / 0.604 / 0.534,
  // -10.1 %, fourth leg 0.655. REFERENCE.md 4.5 wants -14.7 % and 0.565. Two measured
  // points bracket the response at 2.7 % of first step per unit of exponent -- the note
  // that used to stand here claimed 4.0 produced -18.4 %, which this bracket contradicts
  // and which was almost certainly measured on a contaminated window.
  //
  // The reference's own four points cannot both be hit: they are not monotonic (generation 2
  // measures 0.805 against generation 1's 0.755), so the first step and the endpoint ask for
  // different exponents -- 5.3 and 4.5 respectively. 4.5 is taken, because the endpoint is
  // an average of three bounces and therefore the better-conditioned of the two, and because
  // going past it would drive the last leg under the reference, which is the failure the
  // critic already named. 4.5 was tried first and measured 0.815 / 0.706 / 0.547 / 0.445 --
  // a -13.3 % first step but a fourth leg at 0.546, already 3 % PAST the reference. 4.3
  // interpolates between the two measured points to put the fourth leg on 0.565 exactly and
  // the first step at about -12.7 % of the reference's -14.7 %.
  intensityShape: 4.3,
  // THE PRISM'S LEFTOVERS MUST NOT OUTSHINE ITS SPECTRUM.
  //
  // REFERENCE.md 5.4 sweeps a full circle at R = 140 px around the reference prism and
  // finds three outputs: the primary fan at peak 0.42, a secondary fan at 0.26 and a
  // neutral residual at 0.32 -- i.e. the byproducts run at 0.62x and 0.76x the fan. Ours
  // ran the other way round. Measured on the free-field rig at prism angle 30 deg, the
  // neutral wedge peaked at 0.478 against the fan's 0.090: five times inverted, and the
  // round-4 critic measured 1.34x and 1.39x on its own capture of a different board.
  //
  // The cause is physics, not a shader bug, and the tracer is right to keep it. An
  // equilateral prism at n = 1.52 has a critical angle of 41 deg, so whenever the beam
  // arrives within about 30 deg of the entry face's normal the short half of the band
  // exceeds it at the exit face and total-internally-reflects. Scanning all 72 five-degree
  // orientations on a real board, 33 of them put a byproduct above 40 % of the primary and
  // 20 of them cut the fan itself down to 16-21 of its 48 wavelengths -- which is also why
  // the fan reads over-saturated in those orientations: what is left of it is the red half.
  //
  // So the split is drawn, not traced. `segment.side` counts glass-surface REFLECTIONS
  // (see the note above newSegment in optics/trace.js). The lowest `side` that carries
  // real spectral energy is the primary output -- which correctly follows the light when
  // the whole fan leaves through a face it had to bounce to reach, as it does at 15 deg --
  // and everything above it is a byproduct. Byproducts are then scaled so that their total
  // drawn energy is at most BYPRODUCT_BUDGET of the primary's, and desaturated toward their
  // own luminance so a truncated bundle cannot read as a coloured beam. The scale is 1
  // whenever the byproducts are already subordinate, so a clean orientation is untouched.
  //
  // Calibrated by capture, not by eye: see the round-4 numbers in the report.
  byproductBudget: 0.22,
  byproductDesat: 0.70,
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
layout(location = 4) in vec4 aHot;

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
// 1 on the emitter's own first segment, 0 everywhere else. An emitter is an opaque
// housing with a slot in it: light leaves through the slot and nowhere else. The capsule
// profile is radial about p0, so without this the first segment paints its full core out
// the BACK of the aperture and floods the housing board.js draws there -- measured at 0.83
// display luma 8 u behind the mouth and still 0.61 at 26 u, against the reference's 0.37
// machined-grey plateau at the same place.
flat out float vAperture;
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
  vAperture = aHot.w;
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
flat in float vAperture;
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
uniform float uMouthGain;

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

// One BAND-PASSED octave of longitudinal grain.
//
// This exists because plain value noise is the wrong instrument for authoring a spectrum.
// A value-noise field with lattice spacing L is white noise sampled every L and then
// interpolated: its power spectrum runs from DC up to the lattice Nyquist and DECAYS
// monotonically, so its energy sits at periods of 2L and LONGER, never at L. Stacking four
// such octaves at lattices of 18.3 / 11.7 / 8.4 / 4.5 reference px therefore authored
// nothing at all below 9 px and piled most of the energy into 30-300 px drifts -- which is
// exactly what the round-4 critic measured on the composited PNG (0.1 % of the residual's
// energy in the 3-6 px band against the reference's 34.8 %, and 77 % above 25 px against
// 13 %) and exactly why the beam read as slow smoke rather than as dusty air. The old
// comment naming those four periods described the LATTICES, not the periods they produce.
//
// Differencing the field against itself a fixed distance 'delta' downstream turns it into a
// band-pass: the transfer is |2 sin(pi f delta)|, identically zero at DC and first maximal
// at a period of 2 * delta. Multiplying that against the field's own decaying spectrum puts
// a real peak at a chosen period instead of a shoulder at an unreachable one. Both samples
// come from the same field, so the octave stays a smooth, correlated pattern -- it is a
// high-passed cloud, not a second uncorrelated noise.
//
// 'freq' is in cycles per board unit and 'delta' in lattice cells, so an octave whose
// lattice is L reference px uses freq = REFERENCE_SCALE / L and peaks at 2 * delta * L
// reference px.
float grainBand(float ax, float lat, float freq, float delta, float phase) {
  float x = ax * freq + phase;
  return vnoise(vec2(x, lat)) - vnoise(vec2(x + delta, lat));
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
// So the composite is inverted instead: 4.1's table is treated as the target in DISPLAY
// space, mapped back through linearToSRGB and the ACES quadratic, and a curve is fitted to
// the resulting LINEAR values. The flat top survives that round trip -- the tonemap is what
// supplies the flatness, so the linear curve underneath has to be the peakier one.
//
// The fit used to be pow(1 - |v|^1.35, 2.07), which has COMPACT SUPPORT: it is identically
// zero past v = 1, i.e. past 26 reference px. Measured against ref_001 that produced a beam
// with a fat shoulder and then a cliff -- normalised luminance 0.373 / 0.244 / 0.131 / 0.017
// at 18 / 20 / 22 / 26 px against the reference's 0.303 / 0.179 / 0.114 / 0.035, so +23 %,
// +36 %, +15 % of extra energy piled into the coloured shoulder and then 0.49x at 26, where
// the curve simply stops. A beam that stops rather than dissolves holds a hard silhouette
// edge, and it drags the fringe out with it, because the fringe is a difference of two
// samples of THIS function and therefore peaks wherever this function's gradient does.
//
// This is not a width problem and must not be fixed by changing the width: FWHM already
// measured 32.2 reference px against the reference's 30.0. It is tail shape. The curve is
// refitted here as a super-gaussian, which has the same near-flat top under the tonemap but
// an infinite tail, so the beam dissolves instead of ending. Fitted in linear space against
// ref_001's own inverted profile, jointly with the haze lobe above, the exponent and radius
// come out as exp(-(r / 12.0 px)^1.98), written below in v units where v = 1 is 26 px.
//
// Composited, that predicts 0.934 / 0.797 / 0.570 / 0.437 / 0.311 / 0.205 / 0.122 / 0.063 /
// 0.027 / 0.005 of peak at r = 6 / 10 / 14 / 16 / 18 / 20 / 22 / 24 / 26 / 30 px against the
// reference's measured 0.936 / 0.819 / 0.624 / 0.483 / 0.317 / 0.190 / 0.112 / 0.063 /
// 0.031 / 0.005, with a 30.1 px FWHM against 30.0 and an unchanged 0.80 peak.
float coreProfile(float v) {
  return exp(-pow(max(abs(v) * 2.1667, 1e-5), 1.98));
}

// The dispersed fan is a different problem: dozens of wedges have to sum per pixel into a
// smooth spectrum, so its profile stays a soft super-gaussian with no hard edge, faded out
// before the quad boundary so neighbouring wavelengths cross-fade instead of stacking
// visible rails. The exponent is the fan's width control: raising it flattens the top and
// steepens the skirt, which keeps neighbouring wavelengths overlapping (a neutral wedge
// near the prism) while shortening the faint tails that were spreading the visible wedge
// to 41 degrees. At 48 samples over ~29 degrees the sample spacing is under a fifth of the
// half-max radius, so no exponent in this range can let individual rails show through --
// at 3.20 with the round-3 half-width the spacing is 0.13 of the half-max radius at
// R = 140 reference px and still only 0.26 at R = 400, so the wedge stays continuous.
//
// ROUND 4 refits it AT CONSTANT 10 % RADIUS. Two independent things were being set by one
// pair of numbers, and they pull opposite ways: the HALF-MAX radius decides how much
// neighbouring wavelengths overlap, i.e. how far out the wedge stays neutral (5.2), and the
// 10 % radius decides the wedge's visible width (5.1). Round 3 needed the second one small
// and paid for it with the first: 2.05 / 3.20 put the half-max at 11.9 reference px, which
// is well inside the 15 px half-width of the white beam that made the fan. A fan body
// narrower than its own source beam cannot smear the spectrum the way a real one does, and
// it showed -- measured on the scripted dispersion board, mean saturation across the fan
// band read 0.171 / 0.223 / 0.276 / 0.329 / 0.362 at R = 45 / 60 / 80 / 100 / 120 against
// ref_030's own 0.146 / 0.140 / 0.235 / 0.256 / 0.325.
//
// 1.81 / 5.00 solves the pair instead of trading them: half-max 14.0 reference px, within a
// pixel of the beam's own 15, and the 10 % radius 17.8 against 17.2 before -- so the visible
// wedge is unchanged while the overlap near the prism goes up by a fifth. The exponent stops
// at 5; the profile a perfectly matched pair would need is nearly a rectangle, and a
// rectangle draws a hard outer edge on the wedge, which is the tell we are removing.
float spectralProfile(float v) {
  float a = abs(v);
  float p = exp(-pow(max(a * 1.81, 1e-4), 5.00));
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

  // Four octaves, fitted to the BAND-RESOLVED power spectrum of the reference's own
  // centreline residual rather than to an RMS number. Measured on ref_001's emitter run
  // (7-reference-px core mean, residual after a 101 px running mean, Hann-windowed), the
  // reference splits as 0-3 px 10.3 %, 3-6 px 21.4 %, 6-10 px 7.1 %, 10-25 px 31.2 %,
  // > 25 px 30.0 %. It is broadband with a third of its energy at periods a human reads as
  // SPECKLE, and that third is what makes it look like dust in air.
  //
  // Three of the four octaves are band-passed through grainBand (see its note) so their
  // energy actually lands where they are named; the fourth is a plain octave, kept because
  // the reference genuinely does carry a long, slow component and a purely band-passed
  // stack reads as sandpaper. Lattices and peak periods, in reference px:
  //
  //   w 1.00  lattice 1.0   delta 2.0 cells -> peaks at  4.0 px   the speckle
  //   w 0.55  lattice 2.4   delta 2.0 cells -> peaks at  9.6 px
  //   w 0.80  lattice 6.0   delta 1.0 cell  -> peaks at 12.0 px
  //   w 0.75  lattice 14.0  plain           -> the > 25 px drift
  //
  // Modelled through the composite this predicts 0-3 7.6 %, 3-6 29.4 %, 6-10 16.2 %,
  // 10-25 27.9 %, > 25 18.8 %.
  //
  // The lateral scale is unchanged: 0.2 per board unit is a 5 u lattice, i.e. the ~3
  // reference px correlation length across the beam that REFERENCE.md 4.3 measures.
  //
  // Drift is applied in NOISE space, not in board units, so every octave crawls at the same
  // visual rate. Scrolling board units instead would move the 1 px lattice sixteen times
  // faster than the 14 px one and turn the speckle into television static.
  float drift = uTime * uGrainDrift;
  float ax = vAlong + vSeed * 91.0;
  float lat = vAcross * 0.2 + vSeed;
  float n = 1.00 * grainBand(ax, lat, 0.5680, 2.0, -drift);
  n += 0.55 * grainBand(ax, lat * 1.5 + 4.1, 0.2367, 2.0, 13.7 - drift);
  n += 0.80 * grainBand(ax, lat * 2.0 + 9.6, 0.0947, 1.0, 71.3 - drift);
  n += 0.75 * (vnoise(vec2(ax * 0.0406 + 41.9 - drift, lat * 2.6 + 21.4)) - 0.5);
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

  // The aperture plane. Cut over 3 u rather than hard, so the edge antialiases instead of
  // stair-stepping across the slit, and applied after the hot term so the mouth's own flare
  // is cut with everything else.
  energy *= 1.0 - vAperture * clamp(-vAlong / 3.0, 0.0, 1.0);

  // The mouth glow: REFERENCE.md 4.4's "soft roughly circular glow of radius ~22 px"
  // surrounding the emitter mouth.
  //
  // It has to be ADDITIVE and it has to sit AFTER the aperture cut, and both of those follow
  // from one measurement. The flare above is a MULTIPLIER on beam energy, and behind the
  // aperture plane there is no beam energy to multiply -- so no value of hotRadius can put
  // any light there. Measured on half-circle arcs behind the mouth, widening hotRadius from
  // 22 u to 39 u moved 22 reference px from 0.008 to 0.010 against the reference's 0.197:
  // the right diagnosis of the radius, and the wrong term to carry it.
  //
  // A real aperture scatters into the air on every side of itself, so the glow is a plain
  // radial lobe about the mouth point, gated to the emitter's own first segment (vAperture)
  // so a mirror bounce cannot grow one -- 4.4 is explicit that a mirror shows no flare.
  //
  // The lobe is a CUBIC exponential, not the gaussian the multiplicative flare uses. A
  // gaussian of the same radius holds 0.32 at 22 reference px and still 0.17 at 30, a ratio
  // of 1.9 where the reference's own arcs fall 0.197 to 0.056, a ratio of 3.5. The reference
  // glow has a fuller middle and a much harder end than a gaussian does, and reaching that
  // by shrinking the radius instead would pull the middle in with it.
  float mouthGlow = vAperture * vHot.x;
  if (mouthGlow > 0.0) {
    float dm = dA / max(uHotRadius, 1e-3);
    energy += vColor * (mouthGlow * uMouthGain * uWhiteGain * exp(-dm * dm * dm));
  }

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

// How hard each end of a segment flares. Only the emitter mouth keeps a full-strength one:
// REFERENCE.md 4.4 says outright that a mirror hit shows no visible hot spot beyond the
// rod's own specular line, "the beam simply turns".
const BOUNCE_HOT = 0.12;

function hotStart(seg) {
  if (seg.generation === 0) return 1.0;
  // The first thing that happens inside the glass is the entry face lighting up, which is
  // where the reference prism reads brightest (REFERENCE.md 6.2).
  if (seg.inside) return 0.85;
  return seg.nm ? 0.16 : BOUNCE_HOT;
}

// `terminal === null` is the tracer's word for "the ray carries on" - a mirror face or a
// glass interface - so the incoming segment's end and the outgoing segment's start both
// flare there and the two overlap.
//
// They used to overlap at 0.5 each, which with hotGain put a 1.42x multiplier on the inside
// of every V. That is a lot: it pushes the core from 0.46 linear to 0.65, deep into the
// part of the ACES curve where chroma is compressed away, so both legs of the bend washed to
// neutral white and the warm band the reference runs continuously around the inside of the
// bend disappeared exactly where it is most visible. At BOUNCE_HOT the same overlap is
// 1.10x: the corner still reads as a corner and the fringe survives it.
function hotEnd(seg) {
  const t = seg.terminal;
  if (typeof t === 'string' && t.indexOf('receptor') === 0) return 0.9;
  if (t === 'wall') return 0.12;
  if (t === null || t === undefined) return seg.nm ? 0.16 : BOUNCE_HOT;
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
    mouthGain: gl.getUniformLocation(program, 'uMouthGain'),
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
  gl.vertexAttribPointer(4, 4, gl.FLOAT, false, INSTANCE_STRIDE, 40);
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

  // Which glass-reflection order is the primary spectral output, and how hard every later
  // order has to be pulled down to stay under DEFAULTS.byproductBudget of it. Runs over the
  // segment list once, allocates nothing beyond the small per-order accumulator, and
  // returns 1 when there is no prism in the scene at all.
  const sideEnergy = new Float64Array(16);
  const plan = { primarySide: 0, scale: 1 };

  function byproductPlan(list) {
    plan.primarySide = 0;
    plan.scale = 1;
    sideEnergy.fill(0);
    let total = 0;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!s.nm || s.inside) continue;
      const intensity = s.intensity === undefined ? 1.0 : s.intensity;
      if (!(intensity > 0.0004)) continue;
      const side = Math.min(sideEnergy.length - 1, (s.side | 0));
      sideEnergy[side] += intensity;
      total += intensity;
    }
    if (total <= 0) return plan;
    // A 2 % floor keeps a stray sliver of light that happened to leave early from being
    // mistaken for the spectrum and dimming the real fan behind it.
    let primarySide = 0;
    for (let i = 0; i < sideEnergy.length; i++) {
      if (sideEnergy[i] > total * 0.02) { primarySide = i; break; }
    }
    plan.primarySide = primarySide;
    const primary = sideEnergy[primarySide];
    let rest = 0;
    for (let i = primarySide + 1; i < sideEnergy.length; i++) rest += sideEnergy[i];
    if (rest <= 0 || primary <= 0) return plan;
    plan.scale = Math.min(1, (params.byproductBudget * primary) / rest);
    return plan;
  }

  function upload(segments) {
    if (disposed) return;
    const list = segments || [];
    ensureCapacity(list.length || 1);

    byproductPlan(list);
    const desat = params.byproductDesat;

    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const dx = s.bx - s.ax;
      const dy = s.by - s.ay;
      if (dx * dx + dy * dy < 1e-8) continue;
      let intensity = s.intensity === undefined ? 1.0 : s.intensity;
      if (!(intensity > 0.0004)) continue;

      // A byproduct is any light that needed one more glass reflection than the spectrum
      // did. In-glass segments are excluded: they are the guide line inside the prism.
      const byproduct = !s.inside && (s.side | 0) > plan.primarySide;
      if (byproduct) intensity *= plan.scale;

      const spectral = s.nm ? 1.0 : 0.0;
      let r = 1.0;
      let g = 1.0;
      let b = 1.0;
      if (spectral === 1.0) {
        const c = linearForNm(s.nm);
        r = c[0]; g = c[1]; b = c[2];
        if (byproduct && desat > 0) {
          // Toward the sample's own luminance, which is linear in spectral power, so the
          // sum over a full bundle stays exactly as neutral as it was.
          const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
          r += (y - r) * desat;
          g += (y - g) * desat;
          b += (y - b) * desat;
        }
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
      data[w + 13] = (s.generation | 0) === 0 && !s.inside ? 1.0 : 0.0;
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
    g.uniform1f(uni.mouthGain, params.mouthGain);

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
