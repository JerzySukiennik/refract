// Deterministic screenshot harness. Serves the repo, drives window.REFRACT, writes PNGs
// at the exact reference frame size so blind comparisons are apples to apples.
//
//   node tools/shoot.mjs                       all default scenes -> progress/shots/
//   node tools/shoot.mjs dispersion fanDetail  named scenes only
//   node tools/shoot.mjs --prefix=r3           prefix every filename with r3-
//   node tools/shoot.mjs --out=/tmp/x          write somewhere else
//   node tools/shoot.mjs --size=720x694        override the capture size

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { SCENES, DEFAULT_SCENES } from './scenes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.glsl': 'text/plain; charset=utf-8',
};

function serve(port) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(ROOT, url === '/' ? 'index.html' : url);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('404 ' + url); return; }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
      }).end(buf);
    });
  });
  return new Promise(r => server.listen(port, () => r(server)));
}

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const prefix = flag('prefix', '');
const outDir = path.resolve(flag('out', path.join(ROOT, 'progress/shots')));
const [W, H] = flag('size', '720x694').split('x').map(Number);
const names = args.filter(a => !a.startsWith('--'));
const scenes = names.length ? names : DEFAULT_SCENES;

fs.mkdirSync(outDir, { recursive: true });

const PORT = 8137 + Math.floor(Math.random() * 400);
const server = await serve(PORT);

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=default',
    '--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
    '--hide-scrollbars', '--mute-audio', '--force-device-scale-factor=1',
    '--force-color-profile=srgb', '--disable-lcd-text',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 });

const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('PAGEERROR ' + e.message));

await page.goto(`http://localhost:${PORT}/?capture=1`, { waitUntil: 'networkidle0', timeout: 45000 });

try {
  await page.waitForFunction('window.REFRACT && window.REFRACT.ready', { timeout: 25000 });
  await page.evaluate(() => window.REFRACT.ready);
} catch {
  console.error('FATAL: window.REFRACT.ready never resolved. The game did not boot.');
  console.error(consoleErrors.slice(0, 20).join('\n'));
  await browser.close(); server.close(); process.exit(2);
}

const written = [];

for (const name of scenes) {
  const scene = SCENES[name];
  if (!scene) { console.error(`unknown scene: ${name}`); continue; }

  await page.evaluate(async (ops) => {
    const R = window.REFRACT;
    R.clearOptics();
    R.showModal(null);
    R.setDrag(false);
    R.select(null);
    for (const op of ops) {
      if (op.level !== undefined) { R.setLevel(op.level); R.clearOptics(); }
      if (op.place) { const id = R.place(op.place); if (op.select) R.select(id); }
      if (op.drag) R.setDrag(true);
      if (op.cursor) R.setCursor(op.cursor[0], op.cursor[1]);
      if (op.solve) R.solveNow ? R.solveNow() : null;
      if (op.modal) R.showModal(op.modal);
    }
    await R.settle();
  }, scene.ops);

  await new Promise(r => setTimeout(r, 450));

  const clip = scene.crop
    ? { x: scene.crop.x * W, y: scene.crop.y * H, width: scene.crop.w * W, height: scene.crop.h * H }
    : undefined;

  const file = path.join(outDir, `${prefix ? prefix + '-' : ''}${name}.png`);
  await page.screenshot({ path: file, clip, captureBeyondViewport: false });
  written.push(path.relative(ROOT, file));
  console.log(`shot  ${path.relative(ROOT, file)}   (ref: ${scene.ref})`);
}

const perf = await page.evaluate(() => {
  const s = window.REFRACT.state;
  return {
    segments: s.trace ? s.trace.segments.length : 0,
    fps: window.REFRACT.fps ? Math.round(window.REFRACT.fps) : null,
  };
}).catch(() => ({}));

await browser.close();
server.close();

console.log('\n--- capture summary ---');
console.log(`scenes: ${written.length}   size: ${W}x${H}@2x   out: ${path.relative(ROOT, outDir)}`);
if (perf.segments !== undefined) console.log(`last scene segments: ${perf.segments}  fps: ${perf.fps ?? 'n/a'}`);
if (consoleErrors.length) {
  console.log(`\nCONSOLE ERRORS (${consoleErrors.length}):`);
  console.log([...new Set(consoleErrors)].slice(0, 25).join('\n'));
  process.exitCode = 1;
} else {
  console.log('console: clean');
}
