// Dispersion measurement rig for the fan builder.
//
//   node tools/measure-fan.mjs [--prefix=x] [--angle=deg]
//
// Drives the real game to the 'dispersion' script, captures the board, works out where
// the prism's exit face is in pixels from the traced segments themselves, and writes a
// JSON probe (apex, scale, fan bearings) next to the PNG. tools/measure-fan.py then
// samples circular arcs on that PNG and reports saturation, hue span and value against
// the acceptance thresholds in REFERENCE.md 5.1-5.3.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

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
const prefix = flag('prefix', 'measure');
const rotate = flag('angle', '');
const free = flag('free', '');
const outDir = path.join(ROOT, 'progress/shots');
const W = 720;
const H = 694;

fs.mkdirSync(outDir, { recursive: true });

function findChrome() {
  if (process.env.REFRACT_CHROME) return process.env.REFRACT_CHROME;
  const cache = path.join(process.env.HOME || '', '.cache/puppeteer/chrome');
  if (fs.existsSync(cache)) {
    const builds = fs.readdirSync(cache)
      .map(d => path.join(cache, d, 'chrome-mac-x64',
        'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
      .filter(p => fs.existsSync(p))
      .sort();
    if (builds.length) return builds[builds.length - 1];
  }
  const system = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (fs.existsSync(system)) return system;
  return undefined;
}

const PORT = 8637 + Math.floor(Math.random() * 300);
const server = await serve(PORT);
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: findChrome(),
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
await page.waitForFunction('!!(window.REFRACT && window.REFRACT.ready)', { timeout: 25000 });
await page.evaluate(() => window.REFRACT.ready);

const probe = await page.evaluate(async (rotDeg, freeAngle) => {
  const R = window.REFRACT;
  R.clearOptics();
  R.showModal(null);
  R.setDrag(false);
  R.select(null);
  if (freeAngle !== '') {
    // FAR-FIELD RIG. The scripted dispersion scene aims its fan straight into three lit
    // receptors, and a lit receptor's bloom disc is far brighter than the fan: every arc
    // sample past R ~ 120 reference px reads the disc, not the wedge, which is why an arc
    // scan of that scene reports value 1.000 and hue 200 all the way round. Level 4 has a
    // long horizontal emitter run and all three receptors down in the bottom-right corner,
    // so a prism dropped on the run with the fan thrown up-right leaves them dark and the
    // wedge crosses several hundred pixels of black board.
    R.setLevel(4);
    await R.frames(2);
    R.clearOptics();
    R.place({ type: 'prism', x: 420, y: 200, angle: Number(freeAngle) * Math.PI / 180 });
    await R.settle();
  } else {
  await R.script('dispersion');
  if (rotDeg !== '') {
    // Re-place the whole solution rather than swapping one optic: removeOptic leaves the
    // old prism on the board in this build, which quietly produced a two-prism star.
    const placed = R.state.optics.map((o) => ({ type: o.type, x: o.x, y: o.y, angle: o.angle }));
    R.clearOptics();
    for (const o of placed) {
      R.place(o.type === 'prism' ? { ...o, angle: Number(rotDeg) * Math.PI / 180 } : o);
    }
  }
  await R.settle();
  }

  const gl = await import('/js/render/gl.js');
  const t = gl.getTransform();
  const segs = R.state.trace.segments;

  // The fan's rays are the spectral segments that leave the glass: nm set, not inside.
  // Only the FIRST exit generation counts; later ones have bounced off other optics and
  // start somewhere else entirely, which would drag the apex off the prism.
  const exits = segs.filter((s) => s.nm && !s.inside);
  const g0 = exits.reduce((m, s) => Math.min(m, s.generation), Infinity);
  const out = exits.filter((s) => s.generation === g0);
  let ax = 0;
  let ay = 0;
  for (const s of out) { ax += s.ax; ay += s.ay; }
  ax /= Math.max(1, out.length);
  ay /= Math.max(1, out.length);

  const bearings = out.map((s) => {
    const d = Math.atan2(s.by - s.ay, s.bx - s.ax);
    return { nm: s.nm, deg: (d * 180 / Math.PI + 360) % 360, i: s.intensity };
  });

  // A point on the emitter's own beam, for the fan-to-white-core ratio in REFERENCE.md 5.3.
  const white = segs.find((w) => !w.nm && w.generation === 0);
  const whiteMid = white ? [(white.ax + white.bx) * 0.5, (white.ay + white.by) * 0.5] : null;
  const whiteDir = white ? Math.atan2(white.by - white.ay, white.bx - white.ax) : 0;

  const prism = R.state.optics.find((o) => o.type === 'prism')
    || (R.state.level.fixed || []).find((o) => o.type === 'prism');

  return {
    scale: t.scale,
    ox: t.ox,
    oy: t.oy,
    apexBoard: [ax, ay],
    apexPx: [t.ox + ax * t.scale, t.oy + ay * t.scale],
    prism: prism ? { x: prism.x, y: prism.y, angle: prism.angle } : null,
    whitePx: whiteMid ? [t.ox + whiteMid[0] * t.scale, t.oy + whiteMid[1] * t.scale] : null,
    whiteDir,
    outCount: out.length,
    segments: segs.length,
    bearings,
    fps: Math.round(R.fps || 0),
  };
}, rotate, free);

await new Promise(r => setTimeout(r, 400));
const png = path.join(outDir, `${prefix}-fan.png`);
await page.screenshot({ path: png, captureBeyondViewport: false });
fs.writeFileSync(path.join(outDir, `${prefix}-fan.json`), JSON.stringify(probe, null, 2));

await browser.close();
server.close();

console.log(`png    ${path.relative(ROOT, png)}`);
console.log(`apex   board (${probe.apexBoard[0].toFixed(1)}, ${probe.apexBoard[1].toFixed(1)})  px (${probe.apexPx[0].toFixed(1)}, ${probe.apexPx[1].toFixed(1)})`);
console.log(`scale  ${probe.scale.toFixed(4)} device-px per unit (the capture is device px)`);
console.log(`rays   ${probe.outCount} outgoing spectral of ${probe.segments} segments   fps ${probe.fps}`);
if (consoleErrors.length) {
  console.log(`CONSOLE ERRORS (${consoleErrors.length}):`);
  console.log([...new Set(consoleErrors)].slice(0, 10).join('\n'));
  process.exitCode = 1;
}
