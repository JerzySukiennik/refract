// Real pointer input. Every other audit drives window.REFRACT directly, which proves the
// game logic works and proves nothing about whether a person can operate it. This one uses
// actual mouse events on actual pixels: drag a piece out of the dock, drop it, select it,
// rotate it by its handle, remove it, click the chrome.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ogg': 'audio/ogg', '.svg': 'image/svg+xml' };

const server = await new Promise((r) => {
  const s = http.createServer((q, e) => {
    const u = decodeURIComponent(q.url.split('?')[0]);
    const f = path.join(ROOT, u === '/' ? 'index.html' : u);
    fs.readFile(f, (x, b) => (x ? e.writeHead(404).end()
      : e.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream',
                           'cache-control': 'no-store' }).end(b)));
  });
  s.listen(8311, () => r(s));
});

function findChrome() {
  const c = path.join(process.env.HOME || '', '.cache/puppeteer/chrome');
  if (fs.existsSync(c)) {
    const b = fs.readdirSync(c)
      .map((d) => path.join(c, d, 'chrome-mac-x64',
        'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
      .filter((p) => fs.existsSync(p)).sort();
    if (b.length) return b[b.length - 1];
  }
  return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

const browser = await puppeteer.launch({
  headless: 'new', executablePath: findChrome(),
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=default',
         '--enable-webgl', '--hide-scrollbars', '--mute-audio', '--force-color-profile=srgb'],
});

const results = [];
const errors = [];
const check = (n, pass, d) => { results.push({ n, pass, d }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 860, deviceScaleFactor: 1 });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
await page.goto('http://localhost:8311/?capture=1', { waitUntil: 'networkidle0' });
await page.evaluate(() => window.REFRACT.ready);
await page.evaluate(async () => { window.REFRACT.setLevel(0); window.REFRACT.clearOptics(); await window.REFRACT.settle(); });

// Board units -> CSS pixels, so the test aims at the same places a player would.
const toPx = async (bx, by) => page.evaluate(async (x, y) => {
  const gl = await import('/js/render/gl.js');
  const t = gl.boardToPixel(window.innerWidth, window.innerHeight);
  return { x: t.ox + x * t.scale, y: t.oy + y * t.scale };
}, bx, by);

const dockBox = await page.evaluate(() => {
  const tiles = [...document.querySelectorAll('.dock-tile')];
  return tiles.map((t) => { const b = t.getBoundingClientRect();
    return { label: (t.textContent || '').trim(), x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
});
check('the dock has draggable tiles', dockBox.length >= 2, JSON.stringify(dockBox.map((d) => d.label)));

// ---- drag a mirror out of the dock and drop it on the board ----
const target = await toPx(300, 700);
const mirrorTile = dockBox.find((d) => /MIRROR/i.test(d.label)) || dockBox[0];
await page.mouse.move(mirrorTile.x, mirrorTile.y);
await page.mouse.down();
for (let i = 1; i <= 12; i++) {
  await page.mouse.move(
    mirrorTile.x + (target.x - mirrorTile.x) * (i / 12),
    mirrorTile.y + (target.y - mirrorTile.y) * (i / 12));
  await new Promise((r) => setTimeout(r, 16));
}
await page.mouse.up();
await page.evaluate(() => window.REFRACT.settle());

const afterDrag = await page.evaluate(() => window.REFRACT.state.optics.map((o) => ({ id: o.id, t: o.type, x: Math.round(o.x), y: Math.round(o.y) })));
check('dragging a mirror out of the dock places it', afterDrag.length === 1, JSON.stringify(afterDrag));
const near = afterDrag[0] && Math.hypot(afterDrag[0].x - 300, afterDrag[0].y - 700) < 60;
check('it lands where it was dropped', !!near, afterDrag[0] ? `${afterDrag[0].x},${afterDrag[0].y} vs 300,700` : 'nothing placed');

// ---- click it to select ----
if (afterDrag[0]) {
  const at = await toPx(afterDrag[0].x, afterDrag[0].y);
  await page.mouse.click(at.x, at.y);
  await page.evaluate(() => window.REFRACT.settle());
  const sel = await page.evaluate(() => window.REFRACT.state.selectedId);
  check('clicking a placed piece selects it', sel === afterDrag[0].id, `selected ${sel}`);

  // ---- rotate it by dragging the protractor handle ----
  const before = await page.evaluate((id) => window.REFRACT.state.optics.find((o) => o.id === id).angle, afterDrag[0].id);
  const RING = 67;
  const hFrom = await toPx(afterDrag[0].x + RING * Math.cos(before), afterDrag[0].y - RING * Math.sin(before));
  const hTo = await toPx(afterDrag[0].x + RING * Math.cos(before + 1.1), afterDrag[0].y - RING * Math.sin(before + 1.1));
  await page.mouse.move(hFrom.x, hFrom.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(hFrom.x + (hTo.x - hFrom.x) * (i / 10), hFrom.y + (hTo.y - hFrom.y) * (i / 10));
    await new Promise((r) => setTimeout(r, 20));
  }
  await page.mouse.up();
  await page.evaluate(() => window.REFRACT.settle());
  const after = await page.evaluate((id) => { const o = window.REFRACT.state.optics.find((x) => x.id === id); return o ? o.angle : null; }, afterDrag[0].id);
  check('dragging the protractor handle rotates the piece',
    after !== null && Math.abs(after - before) > 0.15, `${before?.toFixed(2)} -> ${after?.toFixed?.(2)}`);

  // ---- snapping: the angle should land on a 5 degree multiple ----
  const deg = after === null ? null : (after * 180 / Math.PI + 360) % 360;
  const off = deg === null ? null : Math.min(deg % 5, 5 - (deg % 5));
  check('rotation snaps to 5 degrees', off !== null && off < 0.35, deg === null ? 'n/a' : `${deg.toFixed(2)}deg, ${off.toFixed(2)} off`);

  // ---- drag the body to move it ----
  const from = await toPx(afterDrag[0].x, afterDrag[0].y);
  const to = await toPx(520, 620);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(from.x + (to.x - from.x) * (i / 10), from.y + (to.y - from.y) * (i / 10));
    await new Promise((r) => setTimeout(r, 18));
  }
  await page.mouse.up();
  await page.evaluate(() => window.REFRACT.settle());
  const moved = await page.evaluate((id) => { const o = window.REFRACT.state.optics.find((x) => x.id === id); return o ? { x: Math.round(o.x), y: Math.round(o.y) } : null; }, afterDrag[0].id);
  check('dragging a piece moves it', moved && Math.hypot(moved.x - 520, moved.y - 620) < 70, JSON.stringify(moved));
}

// ---- the chrome buttons actually do something ----
const chip = async (label) => page.evaluate((l) => {
  const b = [...document.querySelectorAll('.chip, button')].find((e) => new RegExp(l, 'i').test(e.textContent || ''));
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, label);

const levelsChip = await chip('LEVELS');
if (levelsChip) {
  await page.mouse.click(levelsChip.x, levelsChip.y);
  await page.evaluate(() => window.REFRACT.frames(10));
  const open = await page.evaluate(() => !!document.querySelector('.panel'));
  check('the LEVELS button opens the level picker', open);
  await page.keyboard.press('Escape');
  // The panel animates out; frames(10) lands mid-transition and reads it as still open.
  await new Promise((r) => setTimeout(r, 600));
  const closed = await page.evaluate(() => !document.querySelector('.panel'));
  check('Escape closes it', closed);
}

await page.evaluate(async () => { window.REFRACT.showModal(null); await window.REFRACT.frames(8); });
const resetChip = await chip('RESET');
if (resetChip) {
  await page.mouse.click(resetChip.x, resetChip.y);
  await page.evaluate(() => window.REFRACT.settle());
  const n = await page.evaluate(() => window.REFRACT.state.optics.filter((o) => !o.fixed).length);
  check('the RESET button clears the board', n === 0, `${n} left`);
}

// ---- keyboard ----
await page.evaluate(async () => { window.REFRACT.showModal(null); await window.REFRACT.frames(8); });
await page.evaluate(async () => { window.REFRACT.place({ type: 'mirror', x: 400, y: 400, angle: 0.3 }); await window.REFRACT.settle(); });
await page.mouse.click(40, 300);
await page.keyboard.down('Meta'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Meta');
await page.evaluate(() => window.REFRACT.settle());
const undone = await page.evaluate(() => window.REFRACT.state.optics.filter((o) => !o.fixed).length);
check('Cmd+Z undoes a placement', undone === 0, `${undone} left`);

console.log('\nCONSOLE / PAGE ERRORS:', errors.length ? '\n  ' + [...new Set(errors)].join('\n  ') : 'none');
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
server.close();
process.exitCode = failed.length ? 1 : 0;
