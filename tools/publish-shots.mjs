// Converts raw capture PNGs into web-sized JPEGs for the progress page.
// Raw PNGs stay local (they are 2x and large); only the JPEGs are committed.
//   node tools/publish-shots.mjs r1-final-fresh r1-final-dispersion
//   node tools/publish-shots.mjs --all

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'progress/shots');
const OUT = path.join(ROOT, 'progress/web');
fs.mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
const all = args.includes('--all');
const names = args.filter(a => !a.startsWith('--'));

const files = (all || !names.length)
  ? fs.readdirSync(SRC).filter(f => f.endsWith('.png'))
  : names.map(n => n.endsWith('.png') ? n : n + '.png');

let written = 0;
for (const f of files) {
  const src = path.join(SRC, f);
  if (!fs.existsSync(src)) { console.error(`missing ${f}`); continue; }
  const out = path.join(OUT, f.replace(/\.png$/, '.jpg'));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src,
    '-vf', 'scale=900:-2:flags=lanczos', '-q:v', '4', out]);
  written++;
  console.log(`${path.relative(ROOT, out)}  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}
console.log(`\n${written} published to progress/web/`);
