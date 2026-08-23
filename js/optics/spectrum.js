// CIE 1931 colour matching, wavelength to linear sRGB, and Sellmeier dispersion for REFRACT.

export const NM_MIN = 380;
export const NM_MAX = 700;

// Piecewise-Gaussian analytic fit to the CIE 1931 2-degree observer (Wyman, Sloan & Shirley,
// JCGT 2013, multi-lobe form). Accurate to roughly 1% of peak across the visible range.
function lobe(x, mu, s1, s2) {
  const t = (x - mu) * (x < mu ? 1 / s1 : 1 / s2);
  return Math.exp(-0.5 * t * t);
}

export function cieX(nm) {
  return 1.056 * lobe(nm, 599.8, 37.9, 31.0)
    + 0.362 * lobe(nm, 442.0, 16.0, 26.7)
    - 0.065 * lobe(nm, 501.1, 20.4, 26.2);
}

export function cieY(nm) {
  return 0.821 * lobe(nm, 568.8, 46.9, 40.5)
    + 0.286 * lobe(nm, 530.9, 16.3, 31.1);
}

export function cieZ(nm) {
  return 1.217 * lobe(nm, 437.0, 11.8, 36.0)
    + 0.681 * lobe(nm, 459.0, 26.0, 13.8);
}

export function cieXYZ(nm) {
  return [cieX(nm), cieY(nm), cieZ(nm)];
}

// CIE XYZ (D65) to linear sRGB.
export const XYZ_TO_RGB = [
  3.2404542, -1.5371385, -0.4985314,
  -0.9692660, 1.8760108, 0.0415560,
  0.0556434, -0.2040259, 1.0572252,
];

const rgbScratch = new Float64Array(3);

// Writes desaturated (never negative) linear sRGB for a single wavelength, unnormalized.
function rawLinear(out, nm) {
  const X = cieX(nm);
  const Y = cieY(nm);
  const Z = cieZ(nm);
  let r = XYZ_TO_RGB[0] * X + XYZ_TO_RGB[1] * Y + XYZ_TO_RGB[2] * Z;
  let g = XYZ_TO_RGB[3] * X + XYZ_TO_RGB[4] * Y + XYZ_TO_RGB[5] * Z;
  let b = XYZ_TO_RGB[6] * X + XYZ_TO_RGB[7] * Y + XYZ_TO_RGB[8] * Z;
  // Out of gamut: add white rather than clipping a channel, so hue survives.
  const m = Math.min(r, g, b);
  if (m < 0) {
    r -= m;
    g -= m;
    b -= m;
  }
  out[0] = r;
  out[1] = g;
  out[2] = b;
  return Math.max(r, g, b);
}

// Brightest single-wavelength channel across the visible band, used as the normalizer.
const PEAK_CHANNEL = (() => {
  let peak = 0;
  for (let nm = NM_MIN; nm <= NM_MAX; nm += 0.5) {
    const m = rawLinear(rgbScratch, nm);
    if (m > peak) peak = m;
  }
  return peak;
})();

// Compresses the enormous luminance range of the spectral locus so the deep violet and
// deep red ends stay visible instead of collapsing to black.
const BRIGHT_GAMMA = 0.45;

export function nmToLinearRGBInto(out, nm) {
  if (nm < NM_MIN) nm = NM_MIN;
  else if (nm > NM_MAX) nm = NM_MAX;
  const peak = rawLinear(out, nm);
  if (peak <= 0) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return out;
  }
  const bright = Math.pow(peak / PEAK_CHANNEL, BRIGHT_GAMMA);
  const s = bright / peak;
  out[0] *= s;
  out[1] *= s;
  out[2] *= s;
  return out;
}

export function nmToLinearRGB(nm) {
  const out = new Float64Array(3);
  nmToLinearRGBInto(out, nm);
  return [out[0], out[1], out[2]];
}

export function linearToSRGB(c) {
  if (c <= 0) return 0;
  if (c >= 1) return 1;
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function srgbToLinear(c) {
  if (c <= 0) return 0;
  if (c >= 1) return 1;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function nmToSRGB(nm) {
  const rgb = nmToLinearRGB(nm);
  return [linearToSRGB(rgb[0]), linearToSRGB(rgb[1]), linearToSRGB(rgb[2])];
}

// Real Sellmeier coefficients (Schott catalogue), lambda in micrometres.
export const GLASSES = {
  BK7: {
    B: [1.03961212, 0.231792344, 1.01046945],
    C: [0.00600069867, 0.0200179144, 103.560653],
  },
  FLINT: {
    B: [1.34533359, 0.209073176, 0.937357162],
    C: [0.00997743871, 0.0470450767, 111.886764],
  },
  SF11: {
    B: [1.73759695, 0.313747346, 1.89878101],
    C: [0.013188707, 0.0623068142, 155.23629],
  },
};

export function sellmeierIOR(nm, glass) {
  const g = GLASSES[glass] || GLASSES.SF11;
  const l2 = (nm * 0.001) * (nm * 0.001);
  let n2 = 1;
  for (let i = 0; i < 3; i++) n2 += (g.B[i] * l2) / (l2 - g.C[i]);
  return n2 > 1 ? Math.sqrt(n2) : 1;
}

export function abbeNumber(glass) {
  const nD = sellmeierIOR(587.5618, glass);
  const nF = sellmeierIOR(486.1327, glass);
  const nC = sellmeierIOR(656.2725, glass);
  return (nD - 1) / (nF - nC);
}

// The game prism. Its index curve has the exact shape of a real high-dispersion flint,
// but the base index and the total index spread are art directed: a physical SF11 wedge
// deviates so hard that most incidence angles total-internally-reflect and never produce
// a fan at all, and a physical spread gives a 7-degree rainbow where the reference shows
// close to 20. Snell's law is applied exactly; only n(lambda) is stretched.
export const PRISM_DEFAULTS = {
  glass: 'SF11',
  baseIOR: 1.52,
  // The index spread sets the fan's ANGULAR width, and REFERENCE.md 5.1 wants that wedge
  // narrower than this: 18 degrees between its 10 % points, about 28 including the wings,
  // against the 41 this spread rendered. It cannot come down from here. Two contracts hold
  // it: tools/test-optics.mjs asserts the traced fan stays between 24 and 34 degrees, and
  // -- the binding one -- every level's embedded solution is authored against the exact
  // wavelength that lands on each receptor. Trying 0.28 (26.5 traced degrees, still inside
  // the assertion) moved enough of the fan off its targets that five levels' solutions
  // stopped solving, with lit fractions falling to 0.054-0.100. Narrowing the wedge is a
  // job for the renderer's splat, not for the index curve; see beams.js spectralHalfWidth.
  spread: 0.30,
  // Real dispersion squeezes the whole orange-red half of the fan into under a degree,
  // which leaves a warm receptor no target to aim at. Blending the Sellmeier curve toward
  // perceptual hue spacing spends the fan's angle where the eye reads colour change, which
  // is also what the reference's near-uniform per-hue angular budget shows.
  shapeBlend: 0.9,
  apexAngle: Math.PI / 3,
};

const SHAPE_REF = sellmeierIOR(550, PRISM_DEFAULTS.glass);
const SHAPE_SPAN = sellmeierIOR(NM_MIN, PRISM_DEFAULTS.glass) - sellmeierIOR(NM_MAX, PRISM_DEFAULTS.glass);

export function sellmeierShape(nm, glass) {
  const g = glass || PRISM_DEFAULTS.glass;
  if (g === PRISM_DEFAULTS.glass) return (sellmeierIOR(nm, g) - SHAPE_REF) / SHAPE_SPAN;
  const ref = sellmeierIOR(550, g);
  const span = sellmeierIOR(NM_MIN, g) - sellmeierIOR(NM_MAX, g);
  return (sellmeierIOR(nm, g) - ref) / span;
}

export function dispersionShape(nm, glass, blend) {
  const k = blend === undefined ? PRISM_DEFAULTS.shapeBlend : blend;
  const s = sellmeierShape(nm, glass);
  if (k <= 0) return s;
  const p = perceptualPosition(550) - perceptualPosition(nm);
  return s * (1 - k) + p * k;
}

export function prismIOR(nm, baseIOR, spread, glass, blend) {
  const b = baseIOR === undefined ? PRISM_DEFAULTS.baseIOR : baseIOR;
  const s = spread === undefined ? PRISM_DEFAULTS.spread : spread;
  if (!nm) return b;
  return b + s * dispersionShape(nm, glass, blend);
}

// Perceptually even sampling: uniform steps along the arc length of the spectral locus in
// CIE xy, so the fast-moving blue-cyan region is not undersampled and the flat red end is
// not oversampled. A small per-nm floor keeps the far wings represented.
const LOCUS_STEP = 0.25;
const LOCUS_N = Math.round((NM_MAX - NM_MIN) / LOCUS_STEP) + 1;
const LOCUS_CUM = new Float64Array(LOCUS_N);

(() => {
  let px = 0;
  let py = 0;
  let cum = 0;
  for (let i = 0; i < LOCUS_N; i++) {
    const nm = NM_MIN + i * LOCUS_STEP;
    const X = cieX(nm);
    const Y = cieY(nm);
    const Z = cieZ(nm);
    const s = X + Y + Z;
    const x = s > 0 ? X / s : 0;
    const y = s > 0 ? Y / s : 0;
    if (i > 0) cum += Math.hypot(x - px, y - py) + 0.0008 * LOCUS_STEP;
    LOCUS_CUM[i] = cum;
    px = x;
    py = y;
  }
})();

// Position of a wavelength along the perceptual arc of the spectral locus, 0 at NM_MIN.
export function perceptualPosition(nm) {
  const clamped = nm < NM_MIN ? NM_MIN : (nm > NM_MAX ? NM_MAX : nm);
  const f = (clamped - NM_MIN) / LOCUS_STEP;
  const i = Math.min(LOCUS_N - 2, Math.floor(f));
  const c = LOCUS_CUM[i] + (LOCUS_CUM[i + 1] - LOCUS_CUM[i]) * (f - i);
  return c / LOCUS_CUM[LOCUS_N - 1];
}

const sampleCache = new Map();

export function sampleWavelengths(count) {
  const n = Math.max(1, count | 0);
  const hit = sampleCache.get(n);
  if (hit) return hit;
  const out = new Float32Array(n);
  const total = LOCUS_CUM[LOCUS_N - 1];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const target = total * ((i + 0.5) / n);
    while (j < LOCUS_N - 2 && LOCUS_CUM[j + 1] < target) j++;
    const c0 = LOCUS_CUM[j];
    const c1 = LOCUS_CUM[j + 1];
    const f = c1 > c0 ? (target - c0) / (c1 - c0) : 0;
    out[i] = NM_MIN + (j + f) * LOCUS_STEP;
  }
  sampleCache.set(n, out);
  return out;
}

// --- render palette ------------------------------------------------------------------
//
// A dispersion fan is not a set of hues laid side by side; it is an integral. Every pixel
// of a real fan receives a BAND of wavelengths whose width is set by the incident beam's
// own width, and the colour it shows is the CIE integral over that band. Near the prism
// the band is the whole visible spectrum and the pixel is grey; only far enough out that
// the beam width no longer covers the whole angular spread do hues separate.
//
// Because CIE XYZ is linear in spectral power, that integral is exactly what additive
// blending of per-wavelength linear-RGB splats computes for free -- but ONLY if every step
// from wavelength to framebuffer is itself linear in power. `nmToLinearRGB` is not, twice
// over: BRIGHT_GAMMA raises each wavelength's brightness to the 0.45 so a legend swatch of
// deep violet stays visible, and the out-of-gamut fix subtracts the smallest channel,
// which is a different amount of white at every wavelength. Neither commutes with
// summation, so a pixel that receives a band of wavelengths did NOT show the colour of
// that band -- it showed a hand-authored ramp added to itself. Measured on that palette,
// 424 nm came out at luminance 12.7 against 0.20 at 500 nm, no green survived being
// averaged with its neighbours, and the fan rendered as an orange bar, a black gap and a
// blue bar with hue 265-339 where green belongs.
//
// So the render path leaves nmToLinearRGB alone (receptor flags and legend swatches still
// want a violet you can see) and builds its own palette out of three strictly linear
// factors:
//
//   1. XYZ_TO_RGB * (X, Y, Z)      -- the CIE integrand itself, nothing else.
//   2. + RENDER_WHITE * Y          -- desaturation toward the wavelength's own luminance.
//      Linear in power because Y is, so it survives summation, unlike a per-wavelength
//      min-subtraction. Being proportional to Y it desaturates the greens and yellows
//      hardest and the violet and red wings barely at all, which is exactly the shape
//      REFERENCE.md 5.1 measures: saturation 1.00 at the violet edge, 0.90 at the red
//      edge, and 0.22-0.31 through the green middle.
//   3. * m^(-RENDER_WING_POWER), where m is that wavelength's own largest channel -- the
//      emitter's SPD, expressed per unit of perceptual arc, which is the axis the fan is
//      spread along. Weighting on m rather than on Y matters: HSV value, which is what
//      every measurement of the reference fan reports, is the LARGEST channel, not the
//      luminance. Tapering Y left cyan (where no single channel is large) sitting in a
//      45 % value trough between the blue and red humps; tapering m flattens the quantity
//      actually being measured, and the deepest interior minimum on a captured arc fell
//      from 57 % of peak to 2-4 %. At 0.56 the 385 nm and 697 nm ends of the palette sit
//      at 0.066 and 0.115 of its peak, against REFERENCE.md 5.1's measured 0.02 and 0.07
//      out of 0.44.
//
// A residual clamp at zero is still needed for the far violet, where sRGB has no red
// primary to give; it bites only on samples already below 2 % of peak value.
const RENDER_INTEGRAL_SAMPLES = 512;
const RENDER_WHITE = 2.0;
const RENDER_WING_POWER = 0.56;

function renderRawInto(out, nm) {
  const X = cieX(nm);
  const Y = cieY(nm);
  const Z = cieZ(nm);
  const white = RENDER_WHITE * Y;
  let r = XYZ_TO_RGB[0] * X + XYZ_TO_RGB[1] * Y + XYZ_TO_RGB[2] * Z + white;
  let g = XYZ_TO_RGB[3] * X + XYZ_TO_RGB[4] * Y + XYZ_TO_RGB[5] * Z + white;
  let b = XYZ_TO_RGB[6] * X + XYZ_TO_RGB[7] * Y + XYZ_TO_RGB[8] * Z + white;
  if (r < 0) r = 0;
  if (g < 0) g = 0;
  if (b < 0) b = 0;
  const m = Math.max(r, g, b, 1e-9);
  const w = Math.pow(m, -RENDER_WING_POWER);
  out[0] = r * w;
  out[1] = g * w;
  out[2] = b * w;
  return out;
}

// One von Kries balance, so that a pixel reached by the WHOLE spectrum comes out exactly
// neutral at any sample count. Because every factor above is linear, this is the only
// correction needed, and a 512-sample sweep of the finished palette means exactly
// (1.000, 1.000, 1.000) -- which is what makes the wedge leave the prism grey without any
// hand-authored grey being drawn.
const RENDER_GAIN = (() => {
  const s = sampleWavelengths(RENDER_INTEGRAL_SAMPLES);
  const acc = new Float64Array(3);
  const tmp = new Float64Array(3);
  for (let i = 0; i < s.length; i++) {
    renderRawInto(tmp, s[i]);
    acc[0] += tmp[0];
    acc[1] += tmp[1];
    acc[2] += tmp[2];
  }
  const n = s.length;
  return [n / Math.max(acc[0], 1e-6), n / Math.max(acc[1], 1e-6), n / Math.max(acc[2], 1e-6)];
})();

// Linear sRGB for one wavelength, scaled so that the mean over a full perceptually
// uniform sweep of the visible band is exactly (1, 1, 1).
export function nmToRenderRGBInto(out, nm) {
  if (nm < NM_MIN) nm = NM_MIN;
  else if (nm > NM_MAX) nm = NM_MAX;
  renderRawInto(out, nm);
  out[0] *= RENDER_GAIN[0];
  out[1] *= RENDER_GAIN[1];
  out[2] *= RENDER_GAIN[2];
  return out;
}

export function nmToRenderRGB(nm) {
  const out = new Float64Array(3);
  nmToRenderRGBInto(out, nm);
  return [out[0], out[1], out[2]];
}

// Acceptance windows for coloured receptors, in nanometres. The boundaries are pushed
// toward equal shares of the perceptual arc so that every colour owns a comparable slice
// of the fan's angle and of the traced samples: a band that owns 4 of 48 samples can never
// reach the receptor threshold no matter how well the player aims at it.
export const RECEPTOR_BANDS = {
  violet: [380, 450],
  blue: [450, 495],
  cyan: [495, 515],
  green: [515, 560],
  yellow: [560, 585],
  orange: [585, 635],
  red: [635, 700],
};

export function bandCenter(color) {
  const b = RECEPTOR_BANDS[color];
  return b ? (b[0] + b[1]) * 0.5 : 0;
}

export function inBand(nm, color) {
  const b = RECEPTOR_BANDS[color];
  if (!b || !nm) return false;
  return nm >= b[0] && nm <= b[1];
}
