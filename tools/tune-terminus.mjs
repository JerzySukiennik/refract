// Dev-only: search TERMINUS geometry variants for one that genuinely needs five optics.
//
// Freeing the prism (ORCHESTRATOR-NOTES 14) let it be placed anywhere, which collapsed the
// finale to three. Par must equal the true minimum, so the fix is geometry, not par. This
// proposes wall/receptor variants, asks the solver for each one's true minimum, and reports
// the ones that land on the target.

import { LEVELS } from '../js/levels.js';
import { solve } from '../js/solver.js';
import { traceScene } from '../js/optics/trace.js';

const DEG = Math.PI / 180;
const BASE = LEVELS.find((l) => l.name === 'TERMINUS');
const TARGET = Number(process.argv[2] || 5);
const BUDGET = Number(process.argv[3] || 9000);

// We only need two facts, and scanning up from k=1 is what made this time out:
//   (a) there is NO solution at TARGET-1 optics, and
//   (b) there IS one at TARGET.
function probe(level) {
  const under = solve({ ...level, par: TARGET }, { maxOptics: TARGET - 1, timeBudgetMs: BUDGET });
  const underReal = under.solved && traceScene(level, under.optics, {}).solved;
  const at = solve({ ...level, par: TARGET + 1 }, { maxOptics: TARGET, timeBudgetMs: BUDGET });
  const atReal = at.solved && traceScene(level, at.optics, {}).solved;
  return {
    shorter: underReal ? under.optics : null,
    solution: atReal ? at.optics : null,
    timedOut: under.timedOut || at.timedOut,
  };
}

const VARIANTS = [
  {
    // Colour is a structural lever, not decoration. test-optics measures the minimum
    // prism-to-receptor distance at which each band can be satisfied: blue 250, green 375,
    // cyan 400, red 550, orange 625. Baseline TERMINUS used blue/cyan/green, so a prism
    // dropped 100 u below the emitter was already far enough for all three. Demanding ORANGE
    // forces the prism at least 625 u from that receptor, which forces the beam to travel,
    // which forces mirrors -- a constraint the physics enforces rather than a wall maze.
    tag: 'far colours, open board',
    walls: [
      { x: 300, y: 80, w: 40, h: 200 },
      { x: 600, y: 560, w: 280, h: 40 },
    ],
    receptors: [
      { x: 820, y: 300, color: 'orange' },
      { x: 700, y: 780, color: 'red' },
      { x: 300, y: 860, color: 'blue' },
    ],
    emitter: { x: 500, y: 100, dir: 90 * DEG },
  },
  {
    tag: 'far colours + pillar',
    walls: [
      { x: 300, y: 80, w: 40, h: 220 },
      { x: 420, y: 420, w: 260, h: 40 },
      { x: 620, y: 620, w: 300, h: 40 },
    ],
    receptors: [
      { x: 860, y: 260, color: 'orange' },
      { x: 840, y: 880, color: 'red' },
      { x: 220, y: 800, color: 'blue' },
    ],
    emitter: { x: 500, y: 100, dir: 90 * DEG },
  },
  {
    tag: 'far colours, corner emitter',
    walls: [
      { x: 340, y: 300, w: 360, h: 40 },
      { x: 620, y: 600, w: 300, h: 40 },
    ],
    receptors: [
      { x: 860, y: 220, color: 'orange' },
      { x: 780, y: 860, color: 'red' },
      { x: 200, y: 760, color: 'blue' },
    ],
    emitter: { x: 120, y: 120, dir: 0 },
  },
];

console.log(`TERMINUS tuning - want NO solution at ${TARGET - 1}, a solution at ${TARGET}. Budget ${BUDGET} ms.\n`);

for (const v of VARIANTS) {
  const level = {
    ...BASE, walls: v.walls, receptors: v.receptors, emitter: v.emitter,
    inventory: { mirror: 4, prism: 1 }, fixed: [],
  };
  const t0 = Date.now();
  const r = probe(level);
  const ms = Date.now() - t0;
  const ok = !r.shorter && r.solution && !r.timedOut;
  console.log(`${v.tag}`);
  console.log(`   ${TARGET - 1}-optic shortcut : ${r.shorter ? 'YES - ' + fmt(r.shorter) : 'none'}`);
  console.log(`   ${TARGET}-optic solution : ${r.solution ? fmt(r.solution) : 'NOT FOUND'}`);
  console.log(`   ${r.timedOut ? 'TIMED OUT (inconclusive)' : ok ? '*** TARGET MET ***' : 'no'}   [${ms} ms]\n`);
}

function fmt(o) {
  return o.map((x) => `${x.type[0]}@${Math.round(x.x)},${Math.round(x.y)}/${Math.round(x.angle / DEG)}`).join(' ');
}
