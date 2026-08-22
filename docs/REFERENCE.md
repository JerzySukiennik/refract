# REFRACT — Reference Measurements

Everything below was measured off `reference/frames/ref_001..038.jpg` and
`reference/dense/f_0001..0150.jpg` with pixel sampling, not eyeballed. Source video is
**720 × 694 px**, dense extraction is **4 fps over 37.5 s** (150 frames), the level shown
throughout is **LEVEL 13 — THE LONG SPECTRUM, par 5**.

Two coordinate systems are used:

- **px** — pixels in the 720 × 694 source frame.
- **u** — board units, per `ARCHITECTURE.md` §3 (1000 × 1000 logical board).

The conversion, derived in §1: **1 u = 0.568 px**, board origin at px (76, 55).

The `@STEREO.DRIFT` Instagram watermark and the final 3.75 s outro fade (frames
`f_0135`+ / `ref_038`) are video furniture, not game. They are excluded everywhere except
where explicitly called out.

Where a number is quoted to 0.1 it is a real measurement. Where it is round it is a
recommended design value that the measurement supports.

---

## 1. Layout

### 1.1 Board bounds and the board→pixel transform

Measured by thresholding the brick ring against the black background:

| Quantity | px | Fraction of frame | u |
|---|---|---|---|
| Board outer left edge | x = 76 | 0.1056 W | 0 |
| Board outer right edge | x = 643 | 0.8931 W | 1000 |
| Board outer top edge | y = 55 | 0.0793 H | 0 |
| Board outer bottom edge | y = 621 | 0.8948 H | 1000 |
| Board outer width | 568 | 0.7889 W | 1000 |
| Board outer height | 567 | 0.8170 H | 1000 |

**Aspect ratio 568 : 567 = 1.0018.** The board is square to within a pixel; treat it as
exactly square. **Scale = 0.568 px/u.**

Margins: left 76 px, right 77 px (symmetric — the board is horizontally centred in the
frame), top 55 px, bottom 73 px. The board is **not** vertically centred: its centre sits at
y = 338 while the frame centre is y = 347, i.e. the board is pushed **9 px (1.3 % H) above
centre** to leave room for the inventory dock. Reproduce this by centring the board in
`viewportHeight − dockHeight` rather than in the full viewport.

### 1.2 Wall thickness — CONTRACT CONFLICT

Measured wall band thickness, three independent walls:

| Wall | px | u |
|---|---|---|
| Left outer wall (row 400) | x 76–97 → 22.0 | 38.7 |
| Right outer wall (row 400) | x 622–643 → 22.0 | 38.7 |
| Top outer wall (col 360) | y 55–76 → 22.0 | 38.7 |
| Bottom outer wall (col 200) | y 600–621 → 22.0 | 38.7 |
| Interior ledge 1 (col 360) | y 195–216 → 22.0 | 38.7 |
| Interior ledge 2 (col 360) | y 310–330 → 21.0 | 37.0 |

**Measured wall thickness is 38.7 u, not the 30 u in `ARCHITECTURE.md` §3.** Playable
interior is therefore `[38.7, 961.3]²`, not `[30, 970]²`. See §10.

Recommendation: set wall thickness to **40 u**, interior `[40, 960]`. That is within 1.3 u
of measurement, lands on round numbers, and keeps the visual weight of the frame. A 30 u
wall renders 17 px wide here — visibly thinner and flimsier than the reference.

Every measured wall has the same thickness; there is no distinction between outer ring and
interior ledges.

### 1.3 The level's own geometry (for `levels.js`)

Recorded so the level author can reproduce the reference frame exactly.

| Feature | px | u |
|---|---|---|
| Ledge 1 (upper) | x 98→518, y 195→216 | x 38.7→778.2, y 246.5→283.5 |
| Ledge 2 (lower) | x 223→621, y 310→330 | x 258.8→959.5, y 448.9→484.2 |
| Emitter slit (beam origin) | (144, 134) | (119.7, 139.1) |
| Emitter housing box | x 122–143, y 126–144 | x 81.0–118.0, y 125.0–156.7 |
| Blue receptor centre | (456, 578) | (669.0, 920.8) |
| Green receptor centre | (512, 578) | (767.6, 920.8) |
| Orange receptor centre | (561.5, 578) | (854.8, 920.8) |

Note the receptors are **not** evenly spaced: 98.6 u then 87.2 u apart. They are placed by
hand, not on a strict grid.

Note also the emitter housing **floats ~42 u clear of the left wall's inner face**; it is
not embedded in the wall. `ARCHITECTURE.md` §4's example `emitter: { x: 30, ... }` would put
the emitter inside the wall. The reference emitter mouth is at x ≈ 120 u.

Wall centrelines sit close to a 50 u grid (ledge 1 y-centre 265 ≈ 5.3 cells, ledge 2
y-centre 466.5 ≈ 9.3 cells) but not exactly. Do not assume walls snap to the design grid.

### 1.4 HUD chrome

All boxes measured by border detection. `W`/`H` are frame width/height.

**Level title block** (top-left, left-aligned, x = 15 px = 0.0208 W):

| Element | px bbox | Fraction |
|---|---|---|
| `LEVEL 13` cap-height band | x 15–63, y 16–20 | y 0.0231 H, cap 0.0072 H |
| `THE LONG SPECTRUM` cap band | x 15–228, y 31–43 | y 0.0447 H, cap 0.0187 H |

Baseline-to-baseline gap between the two lines is 23 px (0.0331 H). The title block's left
edge (15 px) is **61 px left of the board's left edge** — it hangs outside the board in the
frame margin.

**Top-right button row** — four buttons, y 13–31 px (18 px tall = 0.0259 H):

| Button | x span px | width px |
|---|---|---|
| `RESET` | 553–587 | 34 |
| `HINT` | 592–622 | 30 |
| `LEVELS` | 627–664 | 38 |
| `SOUND` | 670–705 | 35 |

Gaps 5 px. Row spans x 553–705 (0.7681 → 0.9792 W), so the row's right edge is at 15 px
from the frame's right edge — **mirroring the title block's 15 px left inset**. Buttons are
auto-width from their label plus **~9 px horizontal padding** each side. Corner radius
~2 px. Vertical centre y = 22 px; the board's top edge is y = 55, so the row sits fully in
the top margin.

**Bottom inventory dock** — two tiles, x 304–420 px, y 634–678 px:

| Element | px | u-equivalent size |
|---|---|---|
| Tile 1 (`MIRROR`) | x 304–356, y 634–678 | 53 × 45 px |
| Tile 2 (`PRISM`) | x 362–415, y 634–678 | 53 × 45 px |
| Gap between tiles | 6 px | |
| Dock overall | 116 × 45 px | 0.1611 W × 0.0648 H |
| Tile corner radius | ~3 px | |
| Icon centre | tile centre (330, 656) / (388, 656) | |
| Mirror icon bar | x 318–343, y 653–658 → 26 × 5 px | |
| Prism icon triangle | ~22 px wide, ~20 px tall, apex up, 1 px stroke | |
| Label cap band | y 668–673 (cap 5 px) | |
| Count badge | Ø 14 px, centred on the tile's top-right corner at (354.5, 636.5) | |

The dock is horizontally centred on the frame (dock centre x = 362 vs frame centre 360) and
sits **13 px below the board's bottom edge**.

**Badge** overlaps the tile corner by ~7 px in both axes — it deliberately breaks the tile
outline. Filled white disc when count > 0, dark disc with a grey 1 px ring when count = 0.

**USED / PAR and hint line** share one text strip **directly under the board**:

| Element | px bbox |
|---|---|
| Hint line (`ref_001`, used = 0) | x 220–509, y 618–626, cap 5 px, centred x = 364.5 |
| `USED 4 · PAR 5` (`ref_015`) | x ≈ 322–398, y 618–626, cap 5 px, centred x ≈ 360 |

They occupy the same 9 px band and are mutually exclusive in every frame examined: the hint
shows while `used = 0`, `USED n · PAR m` replaces it once a piece is placed. The strip
straddles the bottom wall's lower edge (wall ends y = 621) — the text is drawn **over** the
brick, not clear of it.

Full hint text on level 13:
`FOUR TURNS TO REACH THE FLOOR · THE PRISM GOES IN THE LAST STRAIGHT`

---

## 2. Palette

All values sampled from JPEG frames; expect ±3 per channel of compression error. Note the
consistent **cool violet cast** on every neutral (B ≥ R in all UI greys) — this is a
deliberate tint, not noise, and it separates the UI from the warm brick.

### 2.1 Background

| Role | Hex | Notes |
|---|---|---|
| Page / board background | `#010000` | Effectively pure black. Use `#000000`. |
| Standard deviation of the empty board | **0.0** | See §10 — there is **no film grain and no vignette** anywhere outside the beams. |

### 2.2 Brick wall

The wall is a **dusty rose / terracotta brick**, lit from the **top-left**: every wall slab
carries a linear gradient from a light top/left face to a dark bottom/right face, plus a
narrow re-lit lip on the far edge. Measured across the bottom wall (col 300, y 600→621):

| Position in slab | px offset from lit edge | Hex |
|---|---|---|
| Outer AA ramp | 0–2 | `#170D0C` → `#3E2B27` |
| **Brick face — light** (lit edge) | 3–5 | `#886966` … `#8C6663` |
| Brick face — mid | 6–10 | `#84554F` … `#80534D` |
| **Brick face — dark** (far edge) | 11–15 | `#774743` … `#724943` |
| **Far-edge rim highlight** | 16–18 | `#7A554F` → `#7F605D` |
| Shadow ramp out | 19–21 | `#5B423E` → `#200E0E` |

Statistics over a clean wall band (x 80–95, y 350–500):
`p2 #71463F · p10 #764C44 · p25 #7B524B · p50 #815751 · p75 #865D56 · p90 #8B615B · p98 #8F6661`

Recommended tokens:

| Token | Hex |
|---|---|
| `--brick-light` | `#8E6C64` |
| `--brick-mid` | `#815751` |
| `--brick-dark` | `#72463E` |
| `--brick-rim` | `#7F605D` |
| `--wall-edge-shadow` | `#1B0C0B` (2–3 px AA ramp into black on every wall edge) |
| `--mortar` | **lighter** than the brick face, ≈ `#96706A` at 1 px |

**The mortar lines are lighter than the brick, not darker.** Measured course profile down
the 22 px top wall (col-averaged, x 110–600) shows luminance maxima at rows 59, 66 and 72 —
i.e. **three courses across the wall thickness, ~7 px each**.

Brick module, from joint detection along a single course (row band y 60–64 and 67–71):
dominant joint spacing clusters at **19–24 px**, median ≈ 21 px.

| Brick dimension | px | u |
|---|---|---|
| Brick length | 21 | 37 |
| Course height | 7.3 | 12.9 |
| Joint width | ~1 | ~1.8 |

Bond is a running bond with a half-brick offset per course. Face-to-face luminance varies
±6 % randomly per brick (measured spread within one course: `#724C43` … `#815C53`).

### 2.3 Receptors

Peak-of-stroke sampling (mean of the 12 brightest pixels in the ring stroke):

| Receptor | Ring unlit | Ring lit | Flag unlit | Flag lit |
|---|---|---|---|---|
| Blue | `#26549C` | `#43AAF9` | `#183A7A` | `#4696E7` |
| Green | `#6EAF74` | `#B1F5B5` | `#507C52` | `#AAF0B2` |
| Orange | `#9C682C` | `#EDB950` | `#724420` | `#DEAC4C` |

Flag pole: `#7A8FAD` unlit → `#AFC5F6` lit (the pole itself brightens and picks up the
receptor hue).

Lit rings run ≈ **2.0–2.2× the unlit luminance** and desaturate toward white as they
brighten. Suggested base emissive colours before bloom, which reproduce both states with a
single intensity multiplier:

| Receptor | Base emissive | Unlit intensity | Lit intensity |
|---|---|---|---|
| Blue | `#2E7BFF` | 0.42 | 1.00 |
| Green | `#4CFF5C` | 0.42 | 1.00 |
| Orange | `#FF9A20` | 0.42 | 1.00 |

Additionally, **when lit the ring's interior fills with a soft radial disc** of the same
hue at ≈ 0.28 of the ring's own brightness (measured blue interior at row 577, x 448–468:
`#2252A6`…`#2F76C8` against `#011D44` when unlit).

### 2.4 UI

| Role | Hex | Approx. alpha over black |
|---|---|---|
| Title text | `#F5F2F6` | 0.96 |
| `LEVEL nn` label | `#4E4C4F` | 0.31 |
| Button label | `#858286` | 0.52 |
| Button border | `#2F2D32` | 0.18 |
| Button fill | `#0A0810` | 0.04 (near-transparent, not a filled chip) |
| Dock tile border (available) | `#323133` | 0.20 |
| Dock tile border (depleted) | `#110F13` | 0.07 |
| Dock tile fill | `#040107` | 0.02 |
| Dock label (available) | `#767478` | 0.46 |
| Dock label (depleted) | `#2A282C` | 0.16 |
| Mirror icon bar | `#A2A1A6` | 0.64 |
| Prism icon stroke | `#81848C` | 0.52 |
| Count badge fill (n > 0) | `#FFFDFF` | 1.00 |
| Count badge digit (n > 0) | near-black on white | |
| Count badge ring (n = 0) | `#4E4C51` | 0.31 |
| Hint / USED·PAR text | `#575557` | 0.34 |
| Solved panel fill | `#07050A` | **opaque** |
| Solved panel border | `#201C1D` | 0.12, 1 px |
| Free-play button fill | `#F5F4F6` | 1.00 |
| Protractor ring | warm pale `#8A7A78` peak | ≈ 0.30, 1 px |
| Protractor handle | `#FFFFFF` disc + ~1.5 px dark ring |
| Cursor fill | `#2131C7` (peak `#5669F8`) | |
| Cursor outline | `#FFFFFF`, ~2 px | |

---

## 3. Typography

One family is used everywhere: a **monoline, squared, technical monospace**. Identifying
features across `THE LONG SPECTRUM`, `SOLVED`, `RESET`, `MIRROR`:

- `O` is a rounded rectangle, not a circle.
- `G` carries a horizontal bar into the counter.
- `R` has a straight diagonal leg springing from the bowl.
- `M` has a shallow pointed vertex that stops around mid cap-height.
- `C`, `S`, `E`, `U` are squared with flat horizontal terminals; `E`'s three arms are equal.
- `V` is a sharp point.
- Everything on screen is **UPPERCASE**. No lowercase appears in any frame.

Glyph advances in the title are uniform at 12.7 px regardless of letter (`M` ink = 10 px,
`E` ink = 8 px), and the word space is exactly one advance — the face is genuinely
monospaced, not a proportional face with tracking.

### Font identification

Ink width / cap height ratio measures **0.62–0.77**, which rules out wide display faces.
With cap height 13 px the implied em is ~18 px, and a native advance of ~0.5 em plus
tracking reproduces the measured 12.7 px advance exactly.

| Rank | Google Font | Fit |
|---|---|---|
| **1** | **Share Tech Mono** (400) | Matches every letterform listed above; 0.5 em advance, 0.72 em cap height. Use for all four roles. |
| 2 | Chivo Mono (300/400) | Correct proportions, slightly rounder `O` and `S`. |
| 3 | Nova Mono | Right weight and squareness, quirkier `G` and `R`. |

Rejected: **Michroma** — letterforms match but it is far too wide (an `M` alone would exceed
the measured advance). **Iceland** — too light, corners are chamfered rather than rounded.

Load `Share Tech Mono` from `fonts.googleapis.com` (permitted by the artifact CSP) with a
fallback stack of `'Share Tech Mono', 'SFMono-Regular', 'Consolas', monospace`.

### Measured metrics

| Role | Cap height px | Implied font-size px | % frame H | Advance px | Letter-spacing | Weight | Colour |
|---|---|---|---|---|---|---|---|
| Level title | 13 | 18 | 2.60 % | 12.7 | **+0.21 em** | 400 | `#F5F2F6` |
| `LEVEL nn` | 5 | 7 | 1.01 % | 6.9 | **+0.49 em** | 400 | `#4E4C4F` |
| Button label | 4.5 | 6.3 | 0.91 % | ~6.2 | **+0.48 em** | 400 | `#858286` |
| Inventory label | 5 | 7 | 1.01 % | ~6.8 | **+0.47 em** | 400 | `#767478` |
| Hint / USED·PAR | 5 | 7 | 1.01 % | ~6.6 | **+0.44 em** | 400 | `#575557` |
| `SOLVED` | 23 | 32 | 4.61 % | 27.0 | **+0.34 em** | 400 | `#FFFFFF` |
| Solved subtitle | 5 | 7 | 1.01 % | ~5.3 | **+0.26 em** | 400 | ≈ `#8A888C` |
| Angle readout | ~4 | 5.5 | 0.79 % | ~5.0 | **+0.35 em** | 400 | ≈ `#9A9298` |

Rule of thumb the whole HUD follows: **the smaller the text, the wider the tracking.**
Everything at 7 px sits near +0.47 em; the 18 px title drops to +0.21 em; the 32 px `SOLVED`
sits at +0.34 em (a display exception, deliberately airy).

Sizes are best expressed as a fraction of the **board width** so the HUD scales with the
board: title = 3.17 % of board width, small labels = 1.23 %, `SOLVED` = 5.63 %.

---

## 4. Beam

The most important measurement in this document.

### 4.1 Cross-sectional profile

Sampled perpendicular to the beam at three independent places (emitter run x = 400;
vertical run y = 230; generation-3 diagonal, perpendicular cut at its midpoint). All three
agree.

| Quantity | px | u |
|---|---|---|
| **Total visible width** (>2 % of peak) | 49–54, median **52** | **91.5** |
| **FWHM** | 30.5–31.0, median **31** | **54.6** |
| **Hot near-neutral core** (>90 % of peak) | **13** | **22.9** |
| Peak core luminance | 197–226 / 255 | — |

Full measured profile at x = 400 (emitter run, travelling +x, peak at y = 134):

| Δ from centre px | Hex | Luma /765 | Note |
|---|---|---|---|
| −23 | `#101624` | 0.10 | cool wing |
| −18 | `#42566F` | 0.34 | **blue shoulder** |
| −14 | `#5D758F` | 0.46 | |
| −10 | `#8496AA` | 0.59 | |
| −6 | `#A8B0BB` | 0.69 | |
| −2 | `#BBBEC3` | 0.75 | |
| **0** | `#C5C6C8` | **0.78** | neutral core |
| +2 | `#C6C2BF` | 0.76 | |
| +6 | `#BEB7AD` | 0.71 | |
| +10 | `#A69989` | 0.60 | |
| +14 | `#907860` | 0.47 | **amber shoulder** |
| +18 | `#684C36` | 0.31 | |
| +22 | `#382214` | 0.14 | warm wing |

Fitting the luminance: the profile is **not** Gaussian and **not** `1/(1+r²)`. It is close
to `exp(−(|r|/16.0)^1.9)` with `r` in px, i.e. a slightly super-Gaussian with a flat top.
A cheap shader match: `pow(saturate(1 - pow(abs(v), 1.9)), 1.35)` over `v ∈ [−1, 1]` where
`v = 1` is 26 px from the centreline.

### 4.2 The asymmetric warm/cool fringe — critical

The beam is **not symmetric**. One shoulder is warm amber, the other is cool blue. Measured
on four segments of the same beam path:

| Segment | Generation | Direction (screen, +y down) | Amber side | Blue side |
|---|---|---|---|---|
| Emitter run | 0 | (+1, 0) | +y (below) | −y (above) |
| Right down-run | 1 | (0, +1) | +x (right) | −x (left) |
| Return run | 2 | (−1, 0) | −y (above) | +y (below) |
| Diagonal to prism | 3 | (+0.519, +0.855) | −n side | +n side |

Define `n = (−dy, dx)` for a segment direction `(dx, dy)` in screen space. Then:

> **The amber shoulder lies on the `+n` side for even generations and the `−n` side for odd
> generations.** Equivalently: the transverse fringe axis is a real transverse property of
> the ray that is **mirrored at every reflection**, exactly as physical handedness is.

All four measurements fit this rule; a screen-fixed offset, a radial chromatic aberration
and a plain direction-relative rule all fail on at least one segment.

The renderer must therefore carry a signed `perp` in each traced segment: initialise it as
`(−dy, dx)` at the emitter and flip its sign at each mirror bounce. Do not derive it from
the segment direction alone.

Fringe colours and positions (relative to the FWHM half-width of 15.5 px):

| Shoulder | Centre at | Peak hue | Peak chroma |
|---|---|---|---|
| Cool | 0.9–1.2× half-width | `#42566F` → `#5D758F`, hue ≈ 212° | B−R = +45 |
| Warm | 0.9–1.4× half-width | `#907860` → `#684C36`, hue ≈ 30° | R−B = +50 |

The warm wing extends ~17 px past half-max, the cool wing ~15 px — the warm side is
slightly longer and considerably more saturated. In a linear-HDR beam shader this is
reproduced by offsetting the R channel's profile by **+2.6 px** and the B channel's by
**−2.6 px** along `perp` (2.6 px = 4.6 u), then adding a chroma boost of ~1.3× on the
resulting difference.

### 4.3 Longitudinal grain

Measured by removing a 13-px running mean along the beam centreline and examining residuals
(x 190–590, rows 118–154 of `ref_001`):

| Region | Residual σ | σ / local mean |
|---|---|---|
| Hot core (rows 128–143) | 1.8–2.4 | **1.0–1.4 %** |
| Shoulders (rows 118–127, 144–151) | 0.7–1.2 | 0.6–0.9 % |
| Wings (rows 152–154) | 0.3 | 0.5 % |

Correlation structure: across the beam, correlation is 0.72 at 1 px, 0.25 at 3 px, ~0 at
6 px. Along the beam, the residual's power spectrum peaks at periods of **18.3 px, 11.7 px,
8.4 px and 4.5 px** — broadband, multi-octave, no single frequency.

So the grain is **anisotropic noise: correlation length ~3 px across the beam, ~8–18 px
along it**, concentrated in the core, at ~1.2 % RMS *as captured*.

Video compression destroys high-frequency noise. **Author the shader at 4–6 % RMS**; it
compresses down to the measured 1.2 % and looks right on screen. Animate it by scrolling
the noise along the beam axis — see §9.

### 4.4 Beam at the emitter mouth, at a mirror, along a run

**At the emitter mouth** (`ref_001`, x 110–170, y 105–170):

- A rectangular housing box, x 122–143 × y 126–144 px (17 × 18 px = 30 × 32 u), fill
  `#4D4B50`, 1 px lighter top/left edge. It reads as a machined grey block, not glowing.
- At its mouth, a **vertical slit bar 2–3 px wide at x = 143–145**, peak `#E0DEE1` (0.88) —
  **brighter than the beam core it feeds** (0.78). This is the single brightest board
  feature in an un-solved frame.
- The slit's vertical extent (y ≈ 118–151, 33 px) matches the beam's FWHM (31 px) — the
  slit is the beam's aperture, drawn at full height.
- A soft roughly circular glow of radius ~22 px surrounds the mouth at ≈ 0.12 peak.

**At a mirror hit** (`ref_030`, top-right mirror): the two segments meet in a sharp V with
no rounding; the mirror rod's own specular line sits inside the V and reads brighter than
either beam (its brightest pixels clip to 255). There is **no visible hot spot or flare at
the reflection point** beyond the rod's own highlight — the beam simply turns.

**Along a long straight run**: the centreline luminance is essentially **flat** — measured
at x = 180…580 on the emitter run, the 15-px-smoothed centreline reads 193.6, 194.3, 196.8,
196.4, 197.2, 198.1, 197.2, 198.9, 193.7, 194.2, 190.5. That is ±2 % over 400 px (704 u).
**The white beam has no distance attenuation.** Do not add falloff.

### 4.5 Per-bounce attenuation

Core luminance by generation on the same beam (`ref_030`):

| Generation | Core hex | Luma |
|---|---|---|
| 0 (emitter run) | `#E2E1E3` | 0.885 |
| 1 (vertical) | `#C5BFB9` | 0.755 |
| 2 (return run) | `#D4CAC6` | 0.805 |
| 3 (diagonal) | `#7A7E86` | 0.500 |

Consistent with a mirror reflectance of ≈ **0.90 per bounce** plus measurement noise from
overlapping bloom. Use `R = 0.90`.

### 4.6 Tone mapping — do not blow the beam out

Across `ref_001`, `ref_010`, `ref_020`, `ref_030`, the number of pixels whose mean channel
exceeds 250 is **312, 480, 488, 372** — a few hundred out of 500 000, and they are confined
to the emitter slit, mirror specular lines and the protractor handle. **The beam core never
clips**; it sits at 0.78–0.89.

Also, the core is essentially neutral (`#C5C6C8` — R:G:B within 3/255) with the merest
violet tilt. A naive additive beam renderer will clip to pure `#FFFFFF` and lose the entire
warm/cool fringe structure, which is what makes the reference read as light rather than as
a white polygon. Tone-map so the core lands at **~0.82** and leave headroom.

### 4.7 Beam glow on nearby wall surfaces — a negative finding

Comparing `ref_001` (one beam) with `ref_030` (six beams plus a full spectrum) at identical
wall pixels:

| Sample | ref_001 | ref_030 |
|---|---|---|
| Right wall col 630, y = 100…600, 26 samples | mean 288 | mean 285 |
| Top wall row 65, x = 110…630, 14 samples | mean 285 | mean 279 |

Zero difference. **The reference does not light its walls with the beam.** What looks like a
glow on the brick is only the beam's own bloom halo compositing over it additively. The one
place a difference is measurable is the bottom wall under the lit receptors (330 → 400,
+21 %), and that too is receptor bloom rather than surface lighting.

See §10.2 — this is the clearest place to beat the reference.

---

## 5. Dispersion

Measured by sampling on circular arcs centred on the prism (`ref_030`, prism centroid at
px (205.3, 377.0)), stepping 1° and reading hue/saturation/value.

### 5.1 The primary fan

Incident ray arrives at bearing 53.2° (down-right). The fan occupies bearings **10°–28°**,
i.e. it is deviated **25°–43° counter-clockwise** from the incident direction.

| Bearing | Hex @ R = 260 px | Hue° | Sat | Val |
|---|---|---|---|---|
| 10 | `#020005` | 262 | 1.00 | 0.02 |
| 11 | `#010009` | 247 | 1.00 | 0.04 |
| 12 | `#010520` | 232 | 0.97 | 0.13 |
| 13 | `#06103A` | 228 | 0.90 | 0.23 |
| 14 | `#091E4D` | 221 | 0.88 | 0.30 |
| 15 | `#0F335B` | 211 | 0.83 | 0.36 |
| **16** | `#1E4E6F` | 204 | 0.73 | **0.44** |
| 17 | `#2A5B6B` | 195 | 0.61 | 0.42 |
| 18 | `#38676A` | 183 | 0.47 | 0.42 |
| 19 | `#4C6D5F` | 155 | 0.31 | 0.43 |
| 20 | `#5F7158` | 104 | 0.22 | 0.44 |
| 21 | `#6F6C4A` | 54 | 0.33 | 0.44 |
| 22 | `#6A5F34` | 47 | 0.51 | 0.42 |
| 23 | `#5B4C20` | 45 | 0.65 | 0.36 |
| 24 | `#503715` | 33 | 0.73 | 0.31 |
| 25 | `#40200B` | 23 | 0.82 | 0.25 |
| 26 | `#331105` | 15 | 0.90 | 0.20 |
| 27 | `#230A06` | 8 | 0.83 | 0.14 |
| 28 | `#120505` | 358 | 0.74 | 0.07 |

**Total angular spread: 18° between the 10 % points, ~28° including the barely-visible
violet and red wings.** Colour order across the fan, small bearing → large bearing:

`violet → blue → cyan → green → yellow → amber → orange → red`

i.e. **violet is deviated most, red least** — physically correct, and the tracer must
reproduce that ordering rather than an arbitrary rainbow ramp.

Per-hue angular budget (measured band centres, degrees from the violet edge at 10°):

| Hue | Offset from violet edge | Width |
|---|---|---|
| Violet | 0.5° | 2° |
| Blue | 4° | 3° |
| Cyan | 7.5° | 2.5° |
| Green | 10° | 2° |
| Yellow | 11° | 1.5° |
| Orange | 14.5° | 3° |
| Red | 17° | 3° |

### 5.2 Two things a naive rainbow gets wrong

1. **There is no vivid green band.** Green sits at 19–20° with saturation of only 0.22–0.31
   — the most desaturated point in the entire fan, because the neighbouring bands overlap
   there. A gradient-ramp implementation will produce a bright pure green stripe that the
   reference does not have. This falls out for free if you integrate real CIE CMFs over
   overlapping wavelength samples.
2. **Hue separation does not start at the prism.** At R = 45–80 px the fan is neutral grey
   (`#606467`, `#66686B`, sat < 0.10); hues are only distinguishable beyond **R ≈ 120 px
   (≈ 4× the beam FWHM)** and only clean beyond R ≈ 250 px. This is the finite beam width
   smearing the spectrum, and it is what makes the effect read as real optics.

### 5.3 Radial brightness — the fan does not obey 1/R

Peak value along the fan axis:

| R px | 45 | 60 | 80 | 100 | 150 | 250 |
|---|---|---|---|---|---|---|
| Peak /765 | 0.43 | 0.42 | 0.42 | 0.45 | 0.43 | 0.37 |

Only ~14 % dimming over 200 px, where energy conservation on a widening wedge would predict
~5×. The reference is drawing a near-constant-brightness wedge. Peak fan brightness is
**≈ 0.48 of the white beam's core** at the same exposure.

Recommendation: use physical per-sample intensity (`1/spectralSamples`) in the tracer as the
contract requires, but give the spectral beam shader a gain that keeps peak fan luminance
near 0.45–0.50 of the white core at typical playing distances. Falling off as `1/R` would
make the fan invisible by the time it reaches the receptors, which is not what the reference
looks like.

### 5.4 Secondary fan and residual beam

A full 360° arc scan at R = 140 px around the prism finds **three** outputs, not one:

| Bearing span | Width | Content | Peak /765 |
|---|---|---|---|
| 12°–30° | 18° | **Primary fan**, violet→red | 0.42 |
| 94°–108° | 14° | **Secondary fan, hue order REVERSED** (red at 96°, violet at 106°) | 0.26 |
| 109°–117° | 8° | **Neutral grey residual beam**, `#4F5055` | 0.32 |

The secondary fan and the residual beam are adjacent and read together as "a grey beam with
a rainbow edge". The residual is **narrower than a normal beam** (8° at R = 140 = 19 px vs
the beam's 31 px FWHM) and carries no fringe. Together they are the visual signature that
makes the prism read as glass rather than as a rainbow emitter — reproduce them.

---

## 6. Optics sprites and the selection UI

### 6.1 Mirror

PCA on the thresholded rod (`ref_030`, selected mirror at px (608.5, 518.7)):

| Quantity | px | u |
|---|---|---|
| Length (visible core) | 62 | **109** |
| Length (incl. glow) | 74 | 130 |
| Thickness | 8.1 | **14.3** |
| Cap | full semicircle at each end | |

Recommend **length 110 u, thickness 14 u, capsule (fully rounded) ends.**

Appearance: a light-grey capsule with a **bright specular line running its full length**,
offset toward the side the light strikes. The specular line's brightest pixels reach 255
(one of the only clipped features on the board). Body reads `#8F9AA6`-ish where unlit,
near-white where lit. There is a soft ~4 px glow around the rod.

### 6.2 Prism

Vertex positions (`ref_030`): px (193.5, 358.0), (192.0, 399.5), (230.5, 373.5).

| Quantity | px | u |
|---|---|---|
| Side length | 40.1 / 41.5 / 46.4, mean **42.7** | **75** |
| Circumradius | 24.6 | 43 |

Recommend **equilateral, side 75 u**, apex direction = the optic's `angle`. Note the
inventory icon draws the prism apex **up**, while on the board apex direction follows the
angle; angle 0 puts the apex at +x.

Appearance: a **1.5–2 px near-white outline** (`#B9C4CE`-ish) with an almost transparent
fill. The fill is barely brighter than whatever is behind it (measured interior vs adjacent
background: +8 to +14 /255). One faint internal line is visible across the body — the light
path inside the glass. When lit, the entry face brightens to near the beam's own core
luminance while the exit face carries the fan's colour. There is no solid tinted body: the
prism is drawn as glass, not as a filled triangle.

### 6.3 Protractor ring and angle readout

Measured on two independent selections (`ref_010` centre (147.7, 277.0); `ref_030` centre
(608.6, 513.6)). Both give the same geometry.

| Element | px | u |
|---|---|---|
| Ring radius | **38.0** | **67** |
| Ring stroke | 1 (hairline) | 1.8 |
| Ring colour | warm pale, peak ≈ `#8A7A78` | |
| Ring opacity | ≈ 0.30 | |
| **Tick marks** | **none** — the ring is a plain circle | |
| Handle disc diameter | 9.5 | 16.7 |
| Handle disc fill | `#FFFFFF` | |
| Handle disc outline | ~1.5 px dark ring, plus a faint white halo | |
| Handle position | on the ring circumference, at the optic's angle | |

**Angle readout:**

| Property | Value |
|---|---|
| Position | horizontally centred on the ring centre, **8 px (14 u) above the ring's top** — i.e. at ring-centre y − 46 px |
| Format | one decimal place plus a degree sign: `20.0°`, `19.0°`, `277.1°` |
| Cap height | ~4 px (0.79 % frame H) |
| Colour | ≈ `#9A9298` |

### 6.4 The angle convention — CONTRACT CONFLICT

Direct test on the `ref_030` mirror: PCA gives a rod axis of `(0.1191, 0.9929)`.

| Convention | Computed | Displayed |
|---|---|---|
| **Degrees CCW from +x, y-up** (`angle * 180/π`) | **276.8°** | **277.1°** |
| Degrees clockwise-from-up | 173.2° / 353.2° | — |

The readout is **plain `degrees(angle)` in the exact convention `ARCHITECTURE.md` §3 already
uses internally** (radians CCW from +x, normalised to `[0, 2π)`). It is **not**
clockwise-from-up. `ARCHITECTURE.md` §3's claim that "the HUD displays degrees
clockwise-from-up to match the reference protractor readout" is wrong; see §10.

The conversion in `ui/hud.js` should be `(angle * 180 / Math.PI).toFixed(1) + '°'` and
nothing more.

---

## 7. Receptors

Geometry measured on all three receptors of `ref_001`.

| Element | px | u |
|---|---|---|
| Ring stroke centreline radius | **16.5** | **29.0** |
| Ring outer edge radius | 20 | 35 |
| Ring stroke width (FWHM) | 4.5 | 7.9 |
| Ring diameter (centreline) | 33 | 58 |
| Pole width | 3 | 5.3 |
| Pole top | y = 534 | ring-centre − 44 px |
| **Pole height above ring centre** | **44** | **77.5** |
| Pole bottom | y = 580, i.e. **the pole passes through the ring's centre and ends 2 px below it** | |
| Flag attachment | at the pole top | |
| Flag horizontal extent | 28 (to the right of the pole) | 49.3 |
| Flag vertical extent | 13 | 22.9 |
| Flag shape | pennant: straight top edge, **wavy/scalloped lower edge**, tapering to a point at the free end | |

The ring is a **neon torus**: a thin bright stroke with a symmetric glow either side, black
interior when unlit. It reads as a glowing circle standing on the floor with a golf-style
flag rising from its centre.

### What changes when a receptor is satisfied

Measured `ref_001` (unlit) → `ref_030` (lit):

1. **Ring stroke brightness ×2.0–2.2** and desaturates toward white (blue `#26549C` →
   `#43AAF9`).
2. **The ring's interior fills** with a soft radial disc of the receptor hue at ≈ 0.28 of
   the ring brightness. When unlit the interior is `#011D44`; when lit, `#2252A6`…`#2F76C8`.
3. **The flag brightens ×2.4** and saturates (`#183A7A` → `#4696E7`).
4. **The pole picks up the hue** (`#7A8FAD` → `#AFC5F6`) and glows.
5. Bloom radius roughly doubles; the wall below picks up ~21 % more light purely from that
   bloom.

Ring stroke and flag transition together — no measurable stagger at 4 fps, so the whole
receptor state change is under 250 ms.

---

## 8. Cursors

The native cursor is never visible. Four distinct sprites appear, all in the same style:
a **solid blue body** (`#2131C7`, peak `#5669F8`) inside a **~2 px pure-white outline**,
with a soft dark drop shadow. These are the **Kenney cursor pack** shapes (CC0), which
`ARCHITECTURE.md` §2 already lists under `assets/cursors/`.

| State | Sprite | Bbox px | Appears when |
|---|---|---|---|
| **Arrow** | classic pointer, tip at top-left | 18 × 30 (`ref_001` x 511–528, y 408–437) | Idle over the board or over empty space; also over the top-right button row. Hotspot at the tip. |
| **Open hand** | flat palm, five fingers spread | ~24 × 30 (`ref_005`) | Hovering a dock tile or a placed optic that can be picked up. Hotspot centre-palm. |
| **Closed hand** | fist with four knuckle bumps | ~22 × 22 (`ref_015`) | While dragging an optic (`f_0057`–`f_0062` show it held through the whole drag). Hotspot centre. |
| **Pointing hand** | index finger raised | 20 × 30 (`ref_034`) | Hovering the protractor drag handle (`ref_030`) and the `FREE PLAY` button (`ref_034`). Hotspot at the fingertip. |

Cursor size is 18–24 px wide in a 720 px frame = **2.5–3.3 % of frame width**. At 1× that is
a 24 × 32 CSS cursor. Scale the sprites so they hold that ratio at any viewport.

---

## 9. Motion timeline

Reconstructed from all 150 dense frames (4 fps, Δt = 0.25 s). Times are seconds from
`f_0001`. Anything sub-250 ms is bounded, not measured — noted where that applies.

### 9.1 Whole-clip event log

| t (s) | Frames | Event |
|---|---|---|
| 0.00 | f001 | Clip opens with the emitter beam already running, `USED 0`, hint line showing, inventory `MIRROR 4 / PRISM 1`. **No beam-appearance animation is captured** — see §10. |
| 1.50–4.00 | f007–f017 | Cursor travels to the dock; board mean 29.0 → 30.7 as mirror 1 is placed and the beam re-routes. |
| 5.00–6.00 | f021–f025 | Mirror 1 rotation drag. |
| 6.50–7.50 | f027–f031 | **Mirror 2 rotation drag**, clearly resolved: at f027 the reflected segment leaves at ~35° below horizontal, at f028 it is horizontal, at f029/f031 it is fine-tuned. The protractor ring is on screen throughout and the **beam re-traces every single frame** — there is no debounce, no latency, no ghost. |
| 10.75–11.25 | f044–f045 | Mirror 3 placed (diff 7.35, 7.83). |
| 14.00–16.25 | f057–f066 | **Prism placed and dragged.** `MIRROR 1 / PRISM 0` after. |
| 17.25–19.75 | f070–f080 | Prism repositioning; the whole rainbow fan follows the drag live at full quality. |
| 20.75 | f084 | Green flag brightens (51.6 → 76.7) as the fan first grazes the green receptor. |
| 22.75–23.50 | f092–f095 | **Green then blue latch on.** Green ring 101 → 171 between f092 and f093 (one frame ≤ 250 ms). Blue ring 68 → 121 between f094 and f095. |
| 25.00–26.25 | f101–f106 | Blue and green drop out again during a re-adjustment; orange comes up (46 → 94). |
| 26.50–27.00 | f107–f108 | Blue and green come back. |
| 27.50–27.75 | f111–f112 | **Orange latches (107.8 → 148.8).** All three now lit. |
| 28.75–29.75 | f116–f120 | Steady state, all three lit, values flat at blue 127 / green 173 / orange 148. |
| 30.00 | f121 | A one-frame global luminance dip (board mean 55 → 39.8, beam core 224 → 139) with no other change. **Almost certainly a screen-capture exposure artifact, not a game effect** — see §10. |
| **31.00** | **f125** | **SOLVE BURST.** See §9.2. |
| 31.25 | f126 | Burst gone; **all three receptors have faded out completely** (blue ring 128 → 0.4, green 174 → 11.7, orange 148 → 13.0). |
| 31.50 | f127 | Hold. |
| **31.75** | **f128** | **SOLVED panel appears at 1.12× scale.** |
| 32.00 | f129 | Panel at 1.04×. |
| 32.25 | f130 | Panel settled at 1.00×. |
| 33.25 | f134 | Steady. |
| 33.50–37.25 | f135–f150 | Video outro: global fade to 30 % then the Instagram card. **Not a game state.** |

### 9.2 Solve sequence, in detail

**t = 31.00 (f125) — the burst.** Each satisfied receptor emits **expanding concentric ring
shockwaves**. At this single captured instant, three rings per receptor are visible at radii
of **26 px, 44 px and 100 px** (46, 77 and 176 u) from the ring centre. Each shockwave is a
thin 2–3 px stroke in the receptor's own colour at roughly half alpha, plus a broad diffuse
glow of the same hue filling the space between them. Since three rings are simultaneously
airborne with radii spanning 26 → 100 px and the whole thing is gone one frame (250 ms)
later, the emission is staggered: **rings spawn ~90 ms apart and each expands to ~180 u and
fades over ~400 ms.**

**t = 31.25 (f126) — receptors extinguish.** Measured ring luminance collapses from
128/174/148 to 0.4/11.7/12.3 and flag luminance from 96/143/116 to 3.9/57/71. Verified
independently in `ref_034`, where the receptors are simply absent. The receptors **fade
out** after the burst; they do not stay lit. Duration ≤ 250 ms.

**t = 31.75 → 32.25 (f128 → f130) — panel scale-in.** Measured panel width:

| Frame | t | Panel px width | Scale |
|---|---|---|---|
| f127 | 31.50 | absent | — |
| f128 | 31.75 | 281 | 1.124 |
| f129 | 32.00 | 260 | 1.040 |
| f130 | 32.25 | 250 | 1.000 |

A **back-out overshoot**, settling in **≤ 0.5 s** (real duration is likely 350–450 ms; the
4 fps sampling can only bound it). Implement as
`cubic-bezier(0.34, 1.56, 0.64, 1)` over 400 ms from `scale(0.9)` with the peak clipped —
or more faithfully, an explicit spring reaching 1.12× at ~40 % of the way through.

Text brightness inside the panel lags the panel: the `SOLVED` glyph peak reads 204 at f127
(pre-panel background), 254 at f128 and after. Subtitle and button reach full opacity by
f128 as well. So text fades in over roughly the same window, front-loaded.

**The board is NOT dimmed behind the panel.** Beam luminance at px (400, 134) — far outside
the panel — reads 222.7, 222.7, 224.8, 139.0, 231.9, …, 222.5, 222.5, 222.4, 222.4 across
f118–f134. Aside from the f121 artifact it never changes. There is no scrim, no blur, no
backdrop-filter. The panel is a fully opaque `#07050A` card with a 1 px `#201C1D` border
sitting flat on top. See §10.2 — this is worth improving on.

### 9.3 SOLVED panel — exact contents and layout

Measured in `ref_034`.

| Element | px | Relative |
|---|---|---|
| Panel box | x 233–487, y 279–413 | 254 × 134 px = 0.3528 W × 0.1931 H |
| Panel centre | (360, 346) | horizontally centred on the frame; vertically centred on the **frame** (347), not the board (338) |
| Panel fill | `#07050A`, opaque | |
| Panel border | 1 px `#201C1D` | |
| Panel corner radius | ~2 px | |
| Top padding → `SOLVED` cap top | 32 px | 0.239 of panel height |
| `SOLVED` | cap y 311–333 (23 px), x 285–435 (150 px), centred x = 360 | 6 glyphs, advance 27 px, tracking +0.34 em |
| Gap `SOLVED` baseline → subtitle cap top | 20 px | |
| Subtitle | `5 PIECES USED · PAR 5`, cap y 353–357 (5 px), x 306–412 (106 px), centred x = 359 | middot separator, spaced |
| Gap subtitle → button top | 14 px | |
| `FREE PLAY` button | x 325–395 (71 px), y 371–390 (**20 px**), centred x = 360 | **solid white fill `#F5F4F6`** with dark label |
| Button bottom → panel bottom | 23 px | |

Content is exactly three items, all centred: the word, the score line, one primary action.
No level-select link, no next-level button, no star rating.

### 9.4 Optic placement animation

`f_0057` (t = 14.00) catches a prism mid-placement: **both the prism sprite and its
protractor ring are drawn at ~0.73 scale** (ring radius ≈ 28 px vs the settled 38 px) and at
reduced opacity, with **no angle readout yet**. By `f_0058` (t = 14.25) everything is at
full size, full opacity, with the readout showing `19.0°`.

So: on placement, the optic **and** its protractor scale in from ~0.7 → 1.0 with an ease-out
in **≤ 250 ms** (author it at 150 ms), and the angle readout fades in ~100 ms behind them.
Nothing pops in at full size.

### 9.5 Rotation drag

Frames f027–f031 and f062–f066 show continuous rotation. Every intermediate frame has a
fully valid, fully re-traced beam path — including the prism's complete rainbow fan, which
follows the drag at full sample count with no degradation. The protractor ring, handle and
readout are all live. There is **no motion blur, no trail and no interpolation of the beam**;
the trace is simply recomputed each frame.

### 9.6 Receptor lighting

Every latch measured (green f092→f093, blue f094→f095, orange f111→f112) completes inside a
single 250 ms sample. There is a visible but sub-frame transition — the state change is not
instantaneous, since intermediate values appear at the edges of drags (e.g. green at 76.7
in f084 while grazed, versus 51.6 unlit and 171 latched). Implement as an **~180 ms ease-out
ramp** on the receptor's lit intensity, driven by received in-band intensity rather than a
hard boolean.

---

## 10. Gaps

### 10.1 Things a naive implementation will miss

1. **The beam's warm/cool fringe is handed and flips at every mirror** (§4.2). Almost every
   implementation will make the beam symmetric, or put the amber on a fixed screen side.
   Getting this right requires carrying a signed transverse vector through the trace. It is
   the single most distinctive thing about the reference beam.
2. **The beam core never clips to white** (§4.6). Peak 0.78–0.89, and only ~400 pixels per
   frame exceed 250. Clipping destroys the fringe and makes the beam read as a polygon.
3. **The white beam has zero distance attenuation** (§4.4) but **mirrors attenuate 10 % per
   bounce** (§4.5). Both, not one or the other.
4. **The mortar lines are lighter than the brick faces**, not darker (§2.2). Nearly every
   procedural brick shader gets this backwards.
5. **Each wall slab is lit top-left with a rim highlight on its far edge** (§2.2). Flat-filled
   walls will look like cardboard.
6. **There is no vivid green in the rainbow** (§5.2). Green is the *least* saturated point in
   the fan, at 0.22–0.31.
7. **Hue separation starts ~120 px from the prism, not at the prism** (§5.2). Near the prism
   the fan is neutral grey.
8. **The prism emits three things, not one** (§5.4): the primary fan, a weaker fan with
   reversed hue order, and a narrow neutral residual beam. Only rendering the primary makes
   the prism read as a rainbow generator rather than as glass.
9. **The prism is drawn as glass, not as a filled triangle** (§6.2) — outline plus an almost
   transparent fill plus one internal path line.
10. **Receptors extinguish after the solve burst** (§9.2). They do not stay lit under the
    SOLVED panel.
11. **The solve burst is three staggered expanding rings per receptor**, not a single flash
    (§9.2).
12. **The SOLVED panel overshoots to 1.12× and settles back** (§9.2).
13. **The protractor ring has no tick marks** (§6.3) — a plain hairline circle, 30 % opacity.
    The temptation to add degree ticks should be resisted; the reference's restraint is what
    makes it read as an instrument rather than a widget.
14. **The angle readout sits 8 px above the ring, centred on the ring's centre** (§6.3), not
    beside the handle.
15. **The count badge straddles the dock tile's corner**, deliberately breaking the outline
    (§1.4).
16. **Tracking scales inversely with size**: +0.47 em at 7 px, +0.21 em at 18 px (§3).
17. **The emitter slit is brighter than the beam it emits** (§4.4) — 0.88 versus 0.78.
18. **The board is 9 px above the frame's vertical centre** (§1.1), and the title block's
    15 px left inset is mirrored exactly by the button row's 15 px right inset (§1.4).
19. **The optic and its protractor scale in together on placement** (§9.4).
20. **Grain lives only inside the beam core** (§4.3) — the empty board has a measured
    standard deviation of exactly 0.0. No global film grain, no vignette, no global
    chromatic aberration (wall edges show no colour split).

### 10.2 Where the reference is weak — beat it here

1. **No light spills onto the walls.** Measured to zero (§4.7). A beam grazing a brick wall
   leaves the brick exactly as bright as if the board were empty; what reads as glow is only
   bloom compositing. Adding real proximity lighting — per-wall-pixel accumulation from
   nearby beam segments, tinted by the segment's wavelength — is the single biggest
   available upgrade, and it is cheap: a handful of segment-to-pixel distance evaluations in
   the wall fragment shader. The spectrum sweeping across brick and painting it in sequence
   would be the money shot the reference never gets.
2. **The board is not dimmed behind the SOLVED panel** (§9.2). An opaque black card sits
   flat on a bright board with no separation. A short backdrop dim to ~0.55 plus a small
   blur would give the panel somewhere to sit without hiding the solution the player just
   built.
3. **The prism's fan brightness is essentially constant with distance** (§5.3) — 14 % dimming
   over 200 px where physics says ~5×. We can do better than both: physical falloff plus a
   distance-compensating exposure so the fan stays legible at the receptors while still
   visibly spreading its energy.
4. **The film grain is effectively invisible** at 1.2 % RMS post-compression (§4.3) and only
   exists inside beams. A subtle whole-frame grain would tie the brick, the black and the
   beams into one image; right now the black background is mathematically flat, which reads
   as a clean vector render rather than a photographed scene.
5. **Nothing happens to the walls when the beam is blocked or moved.** No dust motes in the
   beam, no volumetric scatter, no falloff of the ambient light. A very light volumetric
   haze — even 2 % — would give the beams a sense of occupying air.
6. **The residual grey beam from the prism is undifferentiated.** It is a flat 0.32-luminance
   stripe. Making it visibly a Fresnel reflection (weaker, slightly tinted, with a real
   angular relationship to the entry face) would sell the glass.
7. **The mirror sprite is a bare capsule.** No frame, no mount, no back face. There is room
   for a real optical-bench look — a silvered front face and a darker substrate behind it —
   without adding visual noise.
8. **The `SOLVED` panel offers one action.** With a par system already on screen, a
   next-level affordance and a "beat par" state cost nothing and close the loop.
9. **The hint line and the USED/PAR readout fight for the same 9 px strip** (§1.4) and the
   hint is drawn over the brick, which makes it hard to read (measured contrast: `#634A48`
   text on a `#815751` wall). Two lines, or a hint that clears the wall, would be better.
10. **Receptor spacing is irregular** (98.6 u then 87.2 u, §1.3) with no apparent reason.
    Snap to the grid.

### 10.3 Contract conflicts to resolve before building

| # | `ARCHITECTURE.md` says | Measurement says | Recommendation |
|---|---|---|---|
| 1 | §3 Outer wall ring is **30 u** thick, interior `[30, 970]` | **38.7 u**, interior `[38.7, 961.3]`, on six independently measured walls | Change to **40 u**, interior `[40, 960]`. A 30 u wall is visibly thinner than the reference. |
| 2 | §3 "The HUD displays degrees **clockwise-from-up** to match the reference protractor readout" | Readout is **plain `degrees(angle)` CCW from +x**: computed 276.8° against a displayed 277.1° | Delete the clockwise-from-up conversion. `ui/hud.js` should print `(angle * 180 / Math.PI).toFixed(1) + '°'`. |
| 3 | §4 example `emitter: { x: 30, y: 175, dir: 0 }` — x = 30 puts the emitter mouth inside the wall | Reference emitter mouth at **x ≈ 120 u**, housing spanning x 81–118 u, floating ~42 u clear of the wall's inner face | Emitters are free-standing housings placed in the interior, not wall fixtures. Update the example. |
| 4 | §3 "Optics snap to **25-unit** half-cells" | Not verifiable from the footage — drags are continuous and no snapping is observable at 4 fps | No conflict, but note that the beam is 54.6 u wide (FWHM), so a 25 u snap is finer than half a beam width. Fine. |
| 5 | §6 "Rotation snaps to 5° with a magnet at 15° multiples" | Observed readouts are `20.0°`, `19.0°`, `277.1°` | `19.0°` and `277.1°` are **not** multiples of 5°. Either the reference has no rotation snap, or Shift was held. Recommend keeping the snap as specified but confirm the readout shows the snapped value. |
| 6 | §4 receptor colours include `red/yellow/cyan/violet` | Only **blue, green, orange** appear in the footage | No conflict; the extra bands are unmeasured. Blue/green/orange values are in §2.3. |

### 10.4 What the footage does not show

Recorded so no one mistakes absence for evidence:

- **No beam start-up animation.** `f_0001` already has the beam at full brightness.
- **No level transition.** The clip never leaves level 13.
- **No `LEVELS`, `HINT`, `RESET` or `SOUND` panel is ever opened.** Their hover, active and
  toggled-off states are unmeasured.
- **No multiplayer.** No remote cursors, no name labels, no second player.
- **No invalid-placement feedback.** Every placement in the clip is legal.
- **No undo/redo.**
- **No audio information** — the extraction is silent.
- **Hover states** on buttons, dock tiles and placed optics are not distinguishable in any
  frame.
