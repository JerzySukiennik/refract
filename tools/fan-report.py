#!/usr/bin/env python3
"""Critic-equivalent arc report for the dispersion fan.

    python3 tools/fan-report.py progress/shots/disp0-fan.png

Downsamples the capture to the reference's own 720x694 frame (the capture runs at
deviceScaleFactor 2, while the probe's transform is in CSS px), then sweeps circular arcs
around the prism exit and reports exactly the quantities the dispersion critic measured:
unimodality of value, hue coverage, peak saturation, mid-fan saturation, 10%-of-peak
angular width, and near-prism neutrality.
"""
import colorsys
import json
import math
import os
import sys

from PIL import Image

REF_W, REF_H = 720, 694
REF_SCALE = 0.568

png = sys.argv[1] if len(sys.argv) > 1 else 'progress/shots/disp0-fan.png'
probe = json.load(open(os.path.splitext(png)[0] + '.json'))
img = Image.open(png).convert('RGB')
if img.size != (REF_W, REF_H):
    img = img.resize((REF_W, REF_H), Image.LANCZOS)
px = img.load()

apex = probe['apexPx']
img_per_refpx = probe['scale'] / REF_SCALE

bearings = [b['deg'] for b in probe['bearings'] if b['i'] > 1e-4]
degs = sorted(bearings)
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
lo, hi = primary[0] - 6.0, primary[-1] + 6.0


def sample(r_refpx, a, b, step=0.5):
    r = r_refpx * img_per_refpx
    out = []
    d = a
    while d <= b:
        t = math.radians(d)
        x = int(round(apex[0] + math.cos(t) * r))
        y = int(round(apex[1] + math.sin(t) * r))
        if 0 <= x < REF_W and 0 <= y < REF_H:
            c = px[x, y]
            h, s, v = colorsys.rgb_to_hsv(c[0] / 255.0, c[1] / 255.0, c[2] / 255.0)
            out.append((d, h * 360.0, s, v, c))
        d += step
    return out


print('apex px (%.1f, %.1f)  primary fan %.1f..%.1f deg' % (apex[0], apex[1], lo, hi))
print()
print('R   | peakV | clip | trough%% | satPeak | midSat | midV/pk | w10  | hueBins/12')
print('----+-------+------+---------+---------+--------+---------+------+-----------')

summary = {}
for R in (60, 80, 100, 120, 140, 160, 200, 260, 320):
    rows = sample(R, lo, hi)
    if not rows:
        continue
    peak = max(r[3] for r in rows)
    if peak <= 0.02:
        continue
    body = [r for r in rows if r[3] >= 0.10 * peak]
    # deepest interior local minimum, as a fraction of peak
    i0 = min(range(len(rows)), key=lambda i: -rows[i][3])
    lefts = [r[3] for r in rows[:i0]]
    rights = [r[3] for r in rows[i0 + 1:]]
    trough = 0.0
    for side in (lefts, rights):
        run_peak = 0.0
        best = 0.0
        seq = side if side is lefts else side
        # walk outward from the global max
        seq = list(reversed(lefts)) if side is lefts else rights
        run_min = peak
        for v in seq:
            run_min = min(run_min, v)
            if v > run_min + 1e-9:
                best = max(best, (v - run_min) / peak)
        trough = max(trough, best)
    satpeak = max(r[2] for r in rows if r[3] >= 0.5 * peak)
    mid = (body[0][0] + body[-1][0]) * 0.5 if body else 0
    midrow = min(rows, key=lambda r: abs(r[0] - mid))
    w10 = (body[-1][0] - body[0][0]) if body else 0.0
    bins = set()
    for r in rows:
        if r[3] >= 0.25 * peak and r[2] >= 0.10:
            bins.add(int(r[1] // 30) % 12)
    clip = sum(1 for r in rows if r[3] >= 0.995)
    summary[R] = (peak, trough, satpeak, midrow[2], midrow[3] / peak, w10, len(bins))
    print('%3d | %5.3f | %4d | %6.1f%% | %7.3f | %6.3f | %7.3f | %4.1f | %d %s'
          % (R, peak, clip, trough * 100, satpeak, midrow[2], midrow[3] / peak, w10,
             len(bins), sorted(bins)))

print()
print('hue walk at R=200 (bearing: hue sat val)')
rows = sample(200, lo, hi, 1.0)
if rows:
    peak = max(r[3] for r in rows)
    for r in rows:
        if r[3] >= 0.10 * peak:
            print('  %6.1f  hue %5.1f  sat %.2f  val %.2f  #%02X%02X%02X'
                  % (r[0], r[1], r[2], r[3], r[4][0], r[4][1], r[4][2]))

print()
print('near-prism neutrality (REFERENCE 5.2: sat < 0.10 out to R=120)')
for R in (45, 60, 80, 100, 120):
    rows = sample(R, lo, hi)
    if not rows:
        continue
    peak = max(r[3] for r in rows)
    body = [r for r in rows if r[3] >= 0.5 * peak]
    if not body:
        continue
    wm = sum(r[2] * r[3] for r in body) / max(sum(r[3] for r in body), 1e-6)
    print('  R=%3d  peakV %.3f  meanSat(body) %.3f  maxSat(body) %.3f'
          % (R, peak, wm, max(r[2] for r in body)))

if probe.get('whitePx'):
    wx, wy = probe['whitePx']
    n = probe['whiteDir'] + math.pi / 2
    best = 0.0
    for k in range(-40, 41):
        x = int(round(wx + math.cos(n) * k))
        y = int(round(wy + math.sin(n) * k))
        if 0 <= x < REF_W and 0 <= y < REF_H:
            best = max(best, max(px[x, y]) / 255.0)
    fan = max(summary[R][0] for R in summary if R <= 140) if summary else 0
    print()
    print('white core peak V %.3f   fan peak V %.3f   ratio %.2f (reference 0.48)'
          % (best, fan, fan / max(best, 1e-6)))

print()
print('360 sweep at R=140: lobes (REFERENCE 5.4 -> primary 0.42, secondary 0.26, residual 0.32)')
rows = sample(140, 0, 359.5)
lit = [r for r in rows if r[3] > 0.06]
runs = []
for r in lit:
    if runs and r[0] - runs[-1][-1][0] <= 1.5:
        runs[-1].append(r)
    else:
        runs.append([r])
for run in runs:
    print('  %6.1f-%6.1f  width %4.1f  peakV %.2f  minSat %.2f'
          % (run[0][0], run[-1][0], run[-1][0] - run[0][0],
             max(x[3] for x in run), min(x[2] for x in run)))
