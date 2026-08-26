// "Does every element make sense?" — asked of the level geometry, objectively.
//
// A wall earns its place if it does one of two things: the beam actually interacts with it
// (it blocks, bounds or shapes the solution's light), or it closes off a shorter solution.
// A wall that does neither is decoration pretending to be structure, and it makes a board
// read as unfinished rather than designed.
//
// Cheap test first (does any traced segment touch the wall), solver only for the survivors.

import { LEVELS } from '../js/levels.js';
import { traceScene } from '../js/optics/trace.js';
import { solve } from '../js/solver.js';

const PAD = 26;           // a segment passing this close is still "shaped by" the wall
const BUDGET = 4000;

function segNearRect(s, r, pad) {
  const x0 = r.x - pad, y0 = r.y - pad, x1 = r.x + r.w + pad, y1 = r.y + r.h + pad;
  // Sample the segment; exact clipping is not needed to answer "does this matter".
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = s.ax + (s.bx - s.ax) * t;
    const py = s.ay + (s.by - s.ay) * t;
    if (px >= x0 && px <= x1 && py >= y0 && py <= y1) return true;
  }
  return false;
}

console.log('level                     wall                      verdict');
console.log('-'.repeat(86));

let idle = 0, total = 0;
const suspects = [];

for (const level of LEVELS) {
  const optics = (level.solution || []).map((o, i) => ({ id: `s${i}`, ...o, fixed: false }));
  const res = traceScene(level, optics, {});
  const segs = res.segments;

  for (const w of level.walls || []) {
    total++;
    const touched = segs.some((s) => segNearRect(s, w, PAD));
    if (touched) continue;

    // Untouched by the solution's light. Does it at least close a shortcut?
    const without = { ...level, walls: level.walls.filter((x) => x !== w) };
    const short = solve({ ...without, par: level.par }, { maxOptics: level.par - 1, timeBudgetMs: BUDGET });
    const opensShortcut = short.solved && traceScene(without, short.optics, {}).solved;

    const verdict = opensShortcut ? 'guards a shortcut' : (short.timedOut ? 'inconclusive' : 'DOES NOTHING');
    if (verdict === 'DOES NOTHING') { idle++; suspects.push({ level: level.name, wall: w }); }
    console.log(
      `${(level.id + ' ' + level.name).padEnd(25)} `
      + `${`${w.x},${w.y} ${w.w}x${w.h}`.padEnd(25)} ${verdict}`
    );
  }
}

console.log('-'.repeat(86));
console.log(`${total} walls, ${idle} of them do nothing at all`);
if (suspects.length) {
  console.log('\nDecoration pretending to be structure:');
  for (const s of suspects) console.log(`  ${s.level}: ${s.wall.x},${s.wall.y} ${s.wall.w}x${s.wall.h}`);
}
