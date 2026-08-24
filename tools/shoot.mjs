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

// Puppeteer's pinned build is not always downloadable here (npm blocks the postinstall
// and the CDN provider intermittently fails), so resolve whatever real Chrome exists:
// a cached Chrome for Testing first, then the system install.
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

const executablePath = findChrome();
if (executablePath) console.log(`chrome ${executablePath.split('/').slice(-4, -3)[0] || ''}`);

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath,
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
  // Must coerce to a boolean: waitForFunction awaits whatever the predicate returns, and
  // REFRACT.ready is a Promise resolving to undefined, which would poll forever.
  await page.waitForFunction('!!(window.REFRACT && window.REFRACT.ready)', { timeout: 25000 });
  await page.evaluate(() => window.REFRACT.ready);
} catch (err) {
  console.error('FATAL: window.REFRACT.ready never resolved. The game did not boot.');
  console.error('cause: ' + (err && err.message ? err.message : String(err)));
  const probe = await page.evaluate(() => ({
    hasRefract: !!window.REFRACT,
    keys: window.REFRACT ? Object.keys(window.REFRACT) : [],
    readyType: window.REFRACT ? typeof window.REFRACT.ready : 'n/a',
  })).catch(e => ({ probeFailed: String(e) }));
  console.error('probe: ' + JSON.stringify(probe));
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
      if (op.scripted) await R.script(op.scripted);
      if (op.place) { const id = R.place(op.place); if (op.select) R.select(id); }
      if (op.drag) R.setDrag(true);
      if (op.cursor) R.setCursor(op.cursor[0], op.cursor[1]);
      if (op.modal) R.showModal(op.modal);
    }
    await R.settle();
  }, scene.ops);

  await new Promise(r => setTimeout(r, 450));

  // A fixed crop rectangle goes stale the moment a scripted scene picks a different level,
  // and it has done so twice: the one scene whose whole job was to show the protractor
  // stopped containing it, and fanDetail framed empty brick. cropAround asks the page where
  // the subject actually is and centres on it, so a level redesign cannot silently blind a
  // critic's evidence.
  let clip;
  if (scene.cropAround) {
    const c = await page.evaluate(async (what) => {
      const R = window.REFRACT;
      const gl = await import('/js/render/gl.js');
      const t = gl.boardToPixel(window.innerWidth, window.innerHeight);
      const o = what === 'selected'
        ? R.state.optics.find(x => x.id === R.state.selectedId)
        : R.state.optics.find(x => x.type === what);
      if (!o) return null;
      return { x: t.ox + o.x * t.scale, y: t.oy + o.y * t.scale };
    }, scene.cropAround).catch(() => null);
    if (c) {
      const cw = (scene.cropSpan?.w ?? 0.5) * W, ch = (scene.cropSpan?.h ?? 0.42) * H;
      const bx = scene.cropBias?.x ?? 0, by = scene.cropBias?.y ?? 0;
      clip = {
        x: Math.max(0, Math.min(W - cw, c.x - cw / 2 + bx * cw)),
        y: Math.max(0, Math.min(H - ch, c.y - ch / 2 + by * ch)),
        width: cw, height: ch,
      };
    } else {
      console.error(`  cropAround '${scene.cropAround}' found nothing in scene ${name}`);
    }
  }
  if (!clip && scene.crop) {
    clip = { x: scene.crop.x * W, y: scene.crop.y * H, width: scene.crop.w * W, height: scene.crop.h * H };
  }

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
