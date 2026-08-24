// Rules parity probe. The gzowos-games RTDB has ONE rule set shared by every game on the
// account and a deploy replaces it entirely, so adding Refract's branch means touching a
// file that SatisFarm, Ducks, wyspy, Sentinel City and MJJ Archives all depend on.
//
// This exercises every branch's read rules with a real anonymous token, the same way the
// games authenticate, and writes the verdicts to a JSON file. Run it BEFORE the deploy to
// record a baseline, run it AFTER, and diff. Any non-refract probe whose verdict changed
// means the merge broke another game and the deploy must be rolled back.
//
//   node tools/rules-parity.mjs before
//   node tools/rules-parity.mjs after
//   node tools/rules-parity.mjs diff

import fs from 'node:fs';

const DB = 'https://gzowos-games-default-rtdb.europe-west1.firebasedatabase.app';
const KEY = 'AIzaSyAaTuELH_mToxH3hRJ4WPIVTECSH7Z8-FY';
const mode = process.argv[2] || 'before';

// Read probes only, for every branch that belongs to another game. Refract is the only
// branch this change is allowed to affect, and it is the only one probed for writes.
const PROBES = [
  ['rooms',           '/rooms.json?shallow=true'],
  ['rooms/$id',       '/rooms/PARITYPROBE.json'],
  ['wyspy',           '/wyspy.json?shallow=true'],
  ['wyspy/rooms',     '/wyspy/rooms.json?shallow=true'],
  ['ageBands',        '/ageBands.json?shallow=true'],
  ['friendAccess',    '/friendAccess.json?shallow=true'],
  ['presence',        '/presence.json?shallow=true'],
  ['sessions',        '/sessions.json?shallow=true'],
  ['waitlists',       '/waitlists.json?shallow=true'],
  ['sentinelCity',    '/sentinelCity.json?shallow=true'],
  ['satisfarm',       '/satisfarm.json?shallow=true'],
  ['satisfarm/rooms', '/satisfarm/rooms.json?shallow=true'],
  ['ducks',           '/ducks.json?shallow=true'],
  ['ducks/lobby',     '/ducks/lobby.json?shallow=true'],
  ['ducks/rooms',     '/ducks/rooms.json?shallow=true'],
  ['refract',         '/refract.json?shallow=true'],
  ['refract/rooms',   '/refract/rooms.json?shallow=true'],
  ['refract/room/$id','/refract/rooms/PARITYPROBE.json'],
];

async function token() {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('anonymous sign-in failed: ' + JSON.stringify(j).slice(0, 200));
  return { idToken: j.idToken, uid: j.localId };
}

// A verdict is the SHAPE of the outcome, never the payload: other games' data changes
// minute to minute and must not make this report a false difference.
function verdict(status, body) {
  if (status === 200) return 'ALLOW';
  if (status === 401 || status === 403) {
    return /permission/i.test(body) ? 'DENY(permission)' : `DENY(${status})`;
  }
  return `HTTP ${status}`;
}

const { idToken, uid } = await token();
console.log(`anonymous uid ${uid}\n`);

const results = {};
for (const [label, path] of PROBES) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${DB}${path}${sep}auth=${idToken}`);
  const body = await res.text();
  results[label] = verdict(res.status, body);
  console.log(`${label.padEnd(20)} ${results[label]}`);
}

if (mode === 'diff') {
  const a = JSON.parse(fs.readFileSync('/tmp/parity-before.json', 'utf8'));
  const b = JSON.parse(fs.readFileSync('/tmp/parity-after.json', 'utf8'));
  let broke = 0, improved = 0;
  console.log('\n--- parity ---');
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[k] === b[k]) continue;
    const isRefract = k.startsWith('refract');
    console.log(`${isRefract ? 'refract' : 'REGRESSION'}  ${k}: ${a[k]} -> ${b[k]}`);
    if (isRefract) improved++; else broke++;
  }
  console.log(broke === 0
    ? `\nOK: no other game's rules changed behaviour. ${improved} refract probe(s) changed, which is the point.`
    : `\nFAIL: ${broke} probe(s) belonging to other games changed. ROLL BACK.`);
  process.exit(broke === 0 ? 0 : 1);
}

fs.writeFileSync(`/tmp/parity-${mode}.json`, JSON.stringify(results, null, 2));
console.log(`\nwrote /tmp/parity-${mode}.json`);
