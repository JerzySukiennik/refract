// Measures the prism body against the board behind it, which is the test for "does this
// read as glass". Loads the dispersion scene, asks the page where the prism actually is,
// captures with and without it, and reports the interior fill over its own local ground.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
  '.ogg':'audio/ogg', '.svg':'image/svg+xml' };

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

const server = await new Promise(r => {
  const s = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    let f = path.join(ROOT, u === '/' ? 'index.html' : u);
    fs.readFile(f, (e, b) => e ? res.writeHead(404).end()
      : res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream',
                             'cache-control': 'no-store' }).end(b));
  });
  s.listen(8211, () => r(s));
});

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
await page.setViewport({ width: 720, height: 694, deviceScaleFactor: 2 });
await page.goto('http://localhost:8211/?capture=1', { waitUntil: 'networkidle0' });
await page.evaluate(() => window.REFRACT.ready);

const info = await page.evaluate(async () => {
  const R = window.REFRACT;
  R.clearOptics(); R.showModal(null);
  await R.script('dispersion');
  await R.settle();
  const p = R.state.optics.find(o => o.type === 'prism');
  const gl = await import('/js/render/gl.js');
  const t = gl.boardToPixel(window.innerWidth, window.innerHeight);
  return { prism: p ? { x: p.x, y: p.y, angle: p.angle } : null,
           optics: R.state.optics.map(o => ({ t: o.type, x: o.x, y: o.y })),
           level: R.state.level.name, transform: t };
});
console.log('level:', info.level);
console.log("prism:", info.prism);
console.log("transform:", JSON.stringify(info.transform));

await page.screenshot({ path: '/tmp/prism-with.png' });

// Remove the prism and re-shoot, so the difference isolates the glass from the beam.
await page.evaluate(async () => {
  const R = window.REFRACT;
  const p = R.state.optics.find(o => o.type === 'prism');
  if (p) R.state.optics.splice(R.state.optics.indexOf(p), 1);
  R.state.traceDirty = true;
  await R.settle();
});
await page.screenshot({ path: '/tmp/prism-without.png' });

await browser.close();
server.close();
console.log('wrote /tmp/prism-with.png and /tmp/prism-without.png');
