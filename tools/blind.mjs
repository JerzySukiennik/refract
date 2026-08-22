// Blind comparison composer. Pairs our capture with its reference frame side by side,
// randomises which side is which, strips all labels, and writes an answer key the
// critic must not read until after it has committed to a verdict.
//
//   node tools/blind.mjs --prefix=r3 --out=progress/blind/r3
//
// Produces  <out>/pair-<scene>.png   and  <out>/ANSWER-KEY.json
// The critic is given the pair images only.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SCENES, DEFAULT_SCENES } from './scenes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n, d) => { const h = args.find(a => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };

const prefix = flag('prefix', '');
const shotsDir = path.resolve(flag('shots', path.join(ROOT, 'progress/shots')));
const outDir = path.resolve(flag('out', path.join(ROOT, 'progress/blind', prefix || 'latest')));
const seed = flag('seed', crypto.randomBytes(4).toString('hex'));
const names = args.filter(a => !a.startsWith('--'));
const scenes = names.length ? names : DEFAULT_SCENES;

fs.mkdirSync(outDir, { recursive: true });

// Deterministic per-seed coin flip so a run is reproducible from its key.
const flip = (s) => (parseInt(crypto.createHash('sha256').update(seed + s).digest('hex').slice(0, 8), 16) % 2) === 0;

const ffmpeg = (a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a], { stdio: ['ignore', 'pipe', 'pipe'] });

const key = { seed, generatedAt: new Date().toISOString(), pairs: [] };

for (const name of scenes) {
  const scene = SCENES[name];
  if (!scene) { console.error(`unknown scene: ${name}`); continue; }

  const ours = path.join(shotsDir, `${prefix ? prefix + '-' : ''}${name}.png`);
  const ref = path.join(ROOT, 'reference/frames', scene.ref);
  if (!fs.existsSync(ours)) { console.error(`missing capture: ${path.relative(ROOT, ours)}`); continue; }
  if (!fs.existsSync(ref)) { console.error(`missing reference: ${path.relative(ROOT, ref)}`); continue; }

  const oursLeft = flip(name);
  const out = path.join(outDir, `pair-${name}.png`);

  // Both panels normalised to the same height, cropped identically when the scene crops,
  // then stacked with a thin neutral divider. No text is burned in — nothing may hint
  // at which side is which.
  const cropFilter = scene.crop
    ? `crop=iw*${scene.crop.w}:ih*${scene.crop.h}:iw*${scene.crop.x}:ih*${scene.crop.y},`
    : '';

  const A = oursLeft ? ours : ref;
  const B = oursLeft ? ref : ours;
  const fa = oursLeft ? '' : cropFilter;   // our capture is already cropped by shoot.mjs
  const fb = oursLeft ? cropFilter : '';

  ffmpeg([
    '-i', A, '-i', B,
    '-filter_complex',
    `[0:v]${fa}scale=-1:900:flags=lanczos,setsar=1,pad=iw+24:ih:0:0:color=0x141414[a];` +
    `[1:v]${fb}scale=-1:900:flags=lanczos,setsar=1[b];` +
    `[a][b]hstack=inputs=2,pad=iw+48:ih+48:24:24:color=0x0a0a0a[o]`,
    '-map', '[o]', '-frames:v', '1', out,
  ]);

  key.pairs.push({
    scene: name,
    file: path.relative(ROOT, out),
    left: oursLeft ? 'ours' : 'reference',
    right: oursLeft ? 'reference' : 'ours',
    referenceFrame: scene.ref,
    note: scene.note,
  });
  console.log(`pair  ${path.relative(ROOT, out)}`);
}

fs.writeFileSync(path.join(outDir, 'ANSWER-KEY.json'), JSON.stringify(key, null, 2));
console.log(`\n${key.pairs.length} pairs -> ${path.relative(ROOT, outDir)}`);
console.log(`answer key written (seed ${seed}). Do not open it before committing to a verdict.`);
