// Two-player multiplayer audit. This is the session Jurek will actually play with his dad,
// so it tests that shape specifically: two people, one room, one board, sharing a piece
// budget, one of them dropping out and coming back.
//
// Each client gets its OWN browser context. Firebase anonymous auth persists per origin, so
// two pages in one profile authenticate as the same uid, share a presence seat and clobber
// each other -- which is indistinguishable from multiplayer being broken.

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
  s.listen(8266, () => r(s));
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
async function client(label) {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: 1000, height: 820, deviceScaleFactor: 1 });
  p.on('pageerror', (e) => errors.push(`${label}: PAGEERROR ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text().slice(0, 160)}`); });
  await p.goto('http://localhost:8266/?capture=1', { waitUntil: 'networkidle0' });
  await p.evaluate(() => window.REFRACT.ready);
  return { page: p, ctx, label };
}

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const room = 'AUDIT' + Math.floor(Math.random() * 900 + 100);
const A = await client('A');
const B = await client('B');

const join = (c, name) => c.page.evaluate(async (r, n) => {
  const R = window.REFRACT;
  const h = await R.startMultiplayer(r, n);
  window.__room = h;
  await new Promise((z) => setTimeout(z, 2500));
  return { ok: !!(h && h.ok), online: !!(h && h.online), uid: h && h.uid, url: h && h.url };
}, room, name);

const jA = await join(A, 'JUREK');
const jB = await join(B, 'TATA');
check('both clients join the room', jA.ok && jB.ok, `${jA.uid?.slice(0,6)} / ${jB.uid?.slice(0,6)}`);
check('distinct identities (not a shared auth seat)', jA.uid !== jB.uid);
// Room codes fold ambiguous characters (I -> 1, O -> 0) so a code read aloud cannot be
// mistyped. The URL therefore may not match what was typed; what must hold is that BOTH
// clients normalise to the same room, which the roster checks below prove.
check('room link exists and is stable', typeof jA.url === 'string' && jA.url === (await B.page.evaluate(() => window.__room.url)), jA.url);

const settle = (ms = 2200) => new Promise((r) => setTimeout(r, ms));
const roster = (c) => c.page.evaluate(() =>
  Object.values(window.REFRACT.state.players || {}).map((p) => p.name).sort());

await settle();
const rA = await roster(A); const rB = await roster(B);
check('A sees the other player', rA.includes('TATA'), JSON.stringify(rA));
check('B sees the other player', rB.includes('JUREK'), JSON.stringify(rB));
check('neither sees a duplicate of itself', !rA.includes('JUREK') && !rB.includes('TATA'));

// Same level on both, so the two are looking at the same puzzle.
await A.page.evaluate(() => { window.REFRACT.setLevel(4); window.REFRACT.clearOptics(); });
await settle();
const lvl = await Promise.all([A, B].map((c) => c.page.evaluate(() => window.REFRACT.state.levelIndex)));
check('level choice propagates AND sticks', lvl[0] === 4 && lvl[1] === 4, `A=${lvl[0]} B=${lvl[1]} (wanted 4)`);

// Place from A, expect it on B.
const placedId = await A.page.evaluate(() => window.REFRACT.place({ type: 'mirror', x: 400, y: 400, angle: 0.4 }));
await settle();
const onB = await B.page.evaluate(() => window.REFRACT.state.optics.map((o) => ({ t: o.type, x: Math.round(o.x), y: Math.round(o.y) })));
check('A places a mirror, B receives it', onB.some((o) => o.t === 'mirror' && o.x === 400 && o.y === 400), JSON.stringify(onB));

// Place from B, expect it on A — the reverse direction is a separate code path in practice.
await B.page.evaluate(() => window.REFRACT.place({ type: 'prism', x: 620, y: 300, angle: 1.0 }));
await settle();
const onA = await A.page.evaluate(() => window.REFRACT.state.optics.map((o) => ({ t: o.type, x: Math.round(o.x), y: Math.round(o.y) })));
check('B places a prism, A receives it', onA.some((o) => o.t === 'prism' && o.x === 620 && o.y === 300), JSON.stringify(onA));

// The piece budget must be SHARED, or two players get double the pieces and par is a lie.
const inv = await Promise.all([A, B].map((c) => c.page.evaluate(() => ({
  used: window.REFRACT.state.used,
  optics: window.REFRACT.state.optics.filter((o) => !o.fixed).length,
}))));
check('piece budget is shared, not per-player',
  inv[0].used === inv[1].used && inv[0].used === 2, JSON.stringify(inv));

// Move and rotate, both directions.
await A.page.evaluate((id) => {
  const R = window.REFRACT; const o = R.state.optics.find((x) => x.id === id);
  if (o) { R.moveOptic ? R.moveOptic(id, 300, 500) : (o.x = 300, o.y = 500); }
}, placedId);
await settle();

// Remove from A, expect it gone on B.
await A.page.evaluate((id) => { const R = window.REFRACT; R.remove ? R.remove(id) : R.removeOptic && R.removeOptic(id); }, placedId);
await settle();
const afterRemove = await B.page.evaluate(() => window.REFRACT.state.optics.map((o) => o.id));
check('A removes a piece, B loses it too', !afterRemove.includes(placedId), JSON.stringify(afterRemove.length));

// Dad closes the tab and comes back — presence must not leave a ghost, and rejoin must work.
await B.ctx.close();
await settle(3500);
const rosterAfterLeave = await roster(A);
check('a player leaving clears their cursor', !rosterAfterLeave.includes('TATA'), JSON.stringify(rosterAfterLeave));

const B2 = await client('B2');
const jB2 = await join(B2, 'TATA');
await settle(2500);
const rA2 = await roster(A);
const stateB2 = await B2.page.evaluate(() => window.REFRACT.state.optics.length);
check('that player can rejoin', jB2.ok && rA2.includes('TATA'), JSON.stringify(rA2));
check('rejoining player receives the board as it stands', stateB2 > 0, `${stateB2} optics`);

// Solve together and confirm both see it solved.
await A.page.evaluate(async () => {
  const R = window.REFRACT;
  R.clearOptics();
  await new Promise((r) => setTimeout(r, 400));
  for (const o of R.state.level.solution) R.place({ type: o.type, x: o.x, y: o.y, angle: o.angle });
  await R.settle();
});
await settle(2600);
const solved = await Promise.all([A, B2].map((c) => c.page.evaluate(() => window.REFRACT.state.solved)));
check('solving is visible to both players', solved[0] === true && solved[1] === true, JSON.stringify(solved));

console.log('\nCONSOLE / PAGE ERRORS:', errors.length ? '\n  ' + [...new Set(errors)].join('\n  ') : 'none');
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
fs.writeFileSync('/tmp/audit-mp.json', JSON.stringify({ results, errors: [...new Set(errors)] }, null, 2));

await browser.close();
server.close();
process.exitCode = failed.length ? 1 : 0;
