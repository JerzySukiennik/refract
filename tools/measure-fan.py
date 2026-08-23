#!/usr/bin/env python3
"""Arc sampler for the dispersion fan.

    python3 tools/measure-fan.py progress/shots/measure-fan.png

Reads the sibling .json written by tools/measure-fan.mjs, samples circular arcs centred
on the prism exit, and prints saturation / hue-span / value against REFERENCE.md 5.1-5.3.
Radii are quoted in REFERENCE frame pixels (0.568 px per board unit) so the numbers line
up with the reference tables no matter what scale our capture ran at.
"""
import colorsys
import json
import math
import os
import sys

from PIL import Image

REF_SCALE = 0.568  # reference frame px per board unit

png = sys.argv[1] if len(sys.argv) > 1 else 'progress/shots/measure-fan.png'
probe = json.load(open(os.path.splitext(png)[0] + '.json'))
img = Image.open(png).convert('RGB')
W, H = img.size
px = img.load()

apex = probe['apexPx']
img_per_unit = probe['scale']
img_per_refpx = img_per_unit / REF_SCALE

bearings = [b for b in probe['bearings'] if b['i'] > 1e-4]
# Group outgoing rays into angular lobes so the primary fan can be told from the
# secondary fan and the residual.
degs = sorted(b['deg'] for b in bearings)
lobes = []
for d in degs:
    if lobes and d - lobes[-1][-1] < 8.0:
        lobes[-1].append(d)
    else:
        lobes.append([d])
if len(lobes) > 1 and (lobes[0][0] + 360.0 - lobes[-1][-1]) < 8.0:
    lobes[0] = lobes[-1] + [x + 360.0 for x in lobes[0]]
    lobes.pop()
lobes.sort(key=len, reverse=True)
primary = lobes[0]
lo, hi = primary[0] - 3.0, primary[-1] + 3.0

print('apex px (%.1f, %.1f)   %.4f img-px per board unit   %.4f per ref-px'
      % (apex[0], apex[1], img_per_unit, img_per_refpx))
print('lobes: ' + '  '.join('%.0f-%.0f deg (%d rays)' % (l[0], l[-1], len(l))
                            for l in sorted(lobes, key=lambda l: l[0])))
print('primary fan bearings %.1f..%.1f  (%.1f deg wide)' % (lo, hi, hi - lo))
print()


def sample(r_refpx, a, b, step=0.25):
    r = r_refpx * img_per_refpx
    out = []
    d = a
    while d <= b:
        t = math.radians(d)
        x = int(round(apex[0] + math.cos(t) * r))
        y = int(round(apex[1] + math.sin(t) * r))
        if 0 <= x < W and 0 <= y < H:
            c = px[x, y]
            h, s, v = colorsys.rgb_to_hsv(c[0] / 255.0, c[1] / 255.0, c[2] / 255.0)
            out.append((d, h * 360.0, s, v, c))
        d += step
    return out


def hue_span(rows):
    if len(rows) < 2:
        return 0.0
    hs = sorted(r[1] for r in rows)
    gaps = [hs[i + 1] - hs[i] for i in range(len(hs) - 1)]
    gaps.append(hs[0] + 360.0 - hs[-1])
    return 360.0 - max(gaps)


# A near-neutral pixel has no meaningful hue -- #A8ABA9 reports hue 140 purely from
# quantisation noise -- so the hue span that matters is the one measured over pixels the
# eye would actually call coloured. Both are printed: raw over the whole fan body, and
# CHROMA over pixels at or above CHROMA_MIN saturation.
CHROMA_MIN = 0.15

print('R(ref px) | peakV | minSat | hueSpan | hueSpan(sat>=%.2f) | hex at min-sat'
      % CHROMA_MIN)
print('----------+-------+--------+---------+--------------------+---------------')
rows_by_r = {}
for R in (20, 40, 60, 80, 100, 120, 140, 160, 200, 260, 340, 400):
    rows = sample(R, lo, hi)
    if not rows:
        continue
    peak = max(r[3] for r in rows)
    body = [r for r in rows if r[3] >= 0.5 * peak] or rows
    lowsat = min(body, key=lambda r: r[2])
    chroma = [r for r in body if r[2] >= CHROMA_MIN]
    cspan = hue_span(chroma)
    rows_by_r[R] = (peak, min(r[2] for r in body), cspan, hue_span(body))
    print('%9d | %5.3f | %6.3f | %7.1f | %18.1f | #%02X%02X%02X at %.1f deg'
          % (R, peak, lowsat[2], hue_span(body), cspan, lowsat[4][0], lowsat[4][1],
             lowsat[4][2], lowsat[0]))

print()
print('ACCEPTANCE (critic brief)')


def check(label, ok, got, want):
    print('  %-46s %s   got %s, want %s' % (label, 'PASS' if ok else 'FAIL', got, want))


for R in (20, 40, 60):
    if R in rows_by_r:
        s = rows_by_r[R][1]
        check('min arc saturation at R=%d < 0.10' % R, s < 0.10, '%.3f' % s, '<0.10')
for R in (60, 80):
    if R in rows_by_r:
        hs = rows_by_r[R][2]
        check('chromatic hue span at R=%d < 30 deg' % R, hs < 30.0, '%.1f' % hs, '<30')
if 260 in rows_by_r:
    s = rows_by_r[260][1]
    check('min arc saturation at R=260 < 0.35', s < 0.35, '%.3f' % s, '<0.35')

# Fan brightness against the white beam's own core (REFERENCE.md 5.3: ~0.48).
if probe.get('whitePx'):
    wx, wy = probe['whitePx']
    n = probe['whiteDir'] + math.pi / 2
    best = 0.0
    for k in range(-60, 61):
        x = int(round(wx + math.cos(n) * k))
        y = int(round(wy + math.sin(n) * k))
        if 0 <= x < W and 0 <= y < H:
            c = px[x, y]
            best = max(best, max(c) / 255.0)
    fan = max(rows_by_r[R][0] for R in rows_by_r if R <= 100)
    print()
    print('white core peak V %.3f   fan peak V %.3f   ratio %.2f (reference 0.48)'
          % (best, fan, fan / max(best, 1e-6)))

print()
print('radial peak value (REFERENCE.md 5.3 wants ~0.42-0.45, flat)')
print('  ' + '  '.join('R%d=%.2f' % (R, rows_by_r[R][0]) for R in sorted(rows_by_r)))

# Full 360 sweep to see the secondary fan and the residual (REFERENCE.md 5.4).
print()
print('360 sweep at R=140 ref px: contiguous lit lobes')
rows = sample(140, 0, 359.75)
lit = [r for r in rows if r[3] > 0.06]
runs = []
for r in lit:
    if runs and r[0] - runs[-1][-1][0] <= 1.0:
        runs[-1].append(r)
    else:
        runs.append([r])
for run in runs:
    pk = max(x[3] for x in run)
    mn = min(x[2] for x in run)
    print('  %6.1f-%6.1f deg  width %4.1f  peakV %.2f  minSat %.2f'
          % (run[0][0], run[-1][0], run[-1][0] - run[0][0], pk, mn))
