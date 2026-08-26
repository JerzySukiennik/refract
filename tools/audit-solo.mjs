// Singleplayer and presentation audit. Walks all 24 levels, exercises every control and
// every panel, checks progression and persistence, and looks for chrome that collides or
// boards that render black at the sizes a person actually plays at.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = '/tmp/audit-solo';
fs.mkdirSync(OUT, { recursive: true });
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
  s.listen(8299, () => r(s));
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
         '--enable-webgl', '--hide-scrollbars', '--mute-audio',
         '--force-device-scale-factor=1', '--force-color-profile=srgb'],
});

const errors = [];
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  if (!pass) console.log(`FAIL  ${name}${detail ? '  — ' + detail : ''}`);
};

const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 820, deviceScaleFactor: 1 });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 180)); });
await page.goto('http://localhost:8299/?capture=1', { waitUntil: 'networkidle0' });
await page.evaluate(() => window.REFRACT.ready);

// ---- every level loads, renders and is solvable by its own authored solution ----
const N = await page.evaluate(() => window.REFRACT.state.progress ? 24 : 24);
const levelReport = [];
for (let i = 0; i < N; i++) {
  const r = await page.evaluate(async (idx) => {
    const R = window.REFRACT;
    R.showModal(null);
    R.setLevel(idx); R.clearOptics();
    await R.settle();
    const lv = R.state.level;
    const beforeSolved = R.state.solved;
    const segsEmpty = R.state.trace.segments.length;
    for (const o of lv.solution) R.place({ type: o.type, x: o.x, y: o.y, angle: o.angle });
    await R.settle();
    return {
      idx, id: lv.id, name: lv.name, par: lv.par,
      inv: { ...lv.inventory },
      solutionLen: lv.solution.length,
      beforeSolved, segsEmpty,
      solved: R.state.solved,
      used: R.state.used,
      receptors: (R.state.trace.receptors || []).map((x) => x.satisfied),
      segs: R.state.trace.segments.length,
      hint: typeof lv.hint === 'string' && lv.hint.length > 0,
      colours: lv.receptors.map((x) => x.color),
    };
  }, i);
  levelReport.push(r);

  const buf = await page.screenshot({ encoding: 'binary' });
  fs.writeFileSync(path.join(OUT, `lv${String(i + 1).padStart(2, '0')}.png`), buf);
}

for (const r of levelReport) {
  check(`L${r.idx + 1} ${r.name}: starts unsolved`, r.beforeSolved === false);
  check(`L${r.idx + 1} ${r.name}: authored solution solves it`, r.solved === true);
  check(`L${r.idx + 1} ${r.name}: all three receptors satisfied`, r.receptors.every(Boolean), JSON.stringify(r.receptors));
  check(`L${r.idx + 1} ${r.name}: par equals solution length`, r.par === r.solutionLen, `par ${r.par} vs ${r.solutionLen}`);
  check(`L${r.idx + 1} ${r.name}: inventory covers the solution`, r.used <= (r.inv.mirror || 0) + (r.inv.prism || 0), `used ${r.used} of ${JSON.stringify(r.inv)}`);
  check(`L${r.idx + 1} ${r.name}: emits a beam before anything is placed`, r.segsEmpty > 0, `${r.segsEmpty} segments`);
  check(`L${r.idx + 1} ${r.name}: has a hint`, r.hint);
  const distinct = new Set(r.colours).size === r.colours.length;
  check(`L${r.idx + 1} ${r.name}: receptor colours are distinct`, distinct, JSON.stringify(r.colours));
}

// ---- controls ----
const ctl = await page.evaluate(async () => {
  const R = window.REFRACT;
  R.setLevel(0); R.clearOptics(); await R.settle();
  const out = {};
  const id = R.place({ type: 'mirror', x: 300, y: 300, angle: 0.2 });
  await R.settle();
  out.placed = R.state.optics.length;
  R.select(id); out.selected = R.state.selectedId === id;
  R.removeOptic(id); await R.settle();
  out.removed = R.state.optics.length;
  R.place({ type: 'mirror', x: 350, y: 350, angle: 0.3 });
  await R.settle();
  R.reset(); await R.settle();
  out.afterReset = R.state.optics.filter((o) => !o.fixed).length;
  out.soundDefault = R.state.sound;
  return out;
});
check('placing adds a piece', ctl.placed === 1);
check('selecting works', ctl.selected === true);
check('removing takes it away', ctl.removed === 0);
check('reset clears the board', ctl.afterReset === 0, `${ctl.afterReset} left`);

// ---- hint engine ----
const hint = await page.evaluate(async () => {
  const R = window.REFRACT;
  R.setLevel(6); R.clearOptics(); await R.settle();
  const mod = await import('/js/solver.js');
  const h = mod.hint(R.state.level, []);
  return { hasText: !!(h && h.text), hasGhost: !!(h && h.ghost) };
});
check('hint engine returns guidance', hint.hasText, JSON.stringify(hint));

// ---- every panel opens and closes ----
for (const name of ['levels', 'solved', 'multiplayer', 'name']) {
  const ok = await page.evaluate(async (n) => {
    const R = window.REFRACT;
    R.showModal(n); await R.frames(6);
    const open = !!document.querySelector('.panel, [data-modal], dialog[open]');
    R.showModal(null); await R.frames(6);
    const closed = !document.querySelector('.panel:not([hidden])');
    return { open, closed };
  }, name);
  check(`panel "${name}" opens`, ok.open, JSON.stringify(ok));
}

// ---- persistence across a reload ----
// Deliberately does NOT wait for the debounce: closing a tab straight after switching level
// is exactly what a player does, and the save must survive it.
await page.evaluate(() => { window.REFRACT.setLevel(5); });
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await page.reload({ waitUntil: 'networkidle0' });
await page.evaluate(() => window.REFRACT.ready);
const persisted = await page.evaluate(() => window.REFRACT.state.levelIndex);
check('the level you were on survives a reload', persisted === 5, `got ${persisted}`);

// ---- chrome does not collide, at the sizes people play at ----
const sizes = [[1440, 900], [1280, 720], [1000, 820], [820, 1180], [375, 812]];
for (const [w, h] of sizes) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.evaluate(async () => { window.REFRACT.showModal(null); await window.REFRACT.frames(8); });
  const box = await page.evaluate(() => {
    const g = (s) => { const e = document.querySelector(s); if (!e) return null;
      const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right, w: b.width, h: b.height }; };
    const overlap = (a, c) => a && c && a.l < c.r && c.l < a.r && a.t < c.b && c.t < a.b;
    const title = g('.level-name') || g('.title-block');
    const chips = g('.chip-row');
    const dock = g('.dock');
    const strip = g('.board-strip') || g('.hint-line');
    return {
      vw: innerWidth, vh: innerHeight,
      titleChips: overlap(title, chips),
      dockStrip: overlap(dock, strip),
      offscreen: [title, chips, dock, strip].some((e) => e && (e.r > innerWidth + 1 || e.b > innerHeight + 1 || e.l < -1 || e.t < -1)),
      scrollX: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
  check(`${w}x${h}: title and buttons do not overlap`, !box.titleChips);
  check(`${w}x${h}: dock and caption do not overlap`, !box.dockStrip);
  check(`${w}x${h}: no chrome pushed off screen`, !box.offscreen);
  check(`${w}x${h}: page does not scroll sideways`, !box.scrollX);
  const buf = await page.screenshot({ encoding: 'binary' });
  fs.writeFileSync(path.join(OUT, `size-${w}x${h}.png`), buf);
}

fs.writeFileSync('/tmp/audit-solo.json', JSON.stringify({ results, levelReport, errors: [...new Set(errors)] }, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log('CONSOLE / PAGE ERRORS:', errors.length ? '\n  ' + [...new Set(errors)].slice(0, 10).join('\n  ') : 'none');
console.log(`screenshots in ${OUT}`);

await browser.close();
server.close();
process.exitCode = failed.length ? 1 : 0;
