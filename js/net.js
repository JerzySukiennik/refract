// Firebase RTDB multiplayer for REFRACT: room codes, presence, throttled shared cursors
// and last-write-wins optic ops, degrading silently to solo mode whenever the net is unavailable.

/* ------------------------------------------------------------------ config */

// The Firebase web config is a PUBLIC client identifier, not a secret. It ships inside
// every page that talks to Firebase; security comes from the RTDB rules documented in
// docs/MULTIPLAYER.md. Refract shares the `gzowos-games` database with the other games on
// this account (the Google Cloud project quota is exhausted) and keeps all of its data
// under the single top-level branch `refract/`.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAaTuELH_mToxH3hRJ4WPIVTECSH7Z8-FY',
  authDomain: 'gzowos-games.firebaseapp.com',
  databaseURL: 'https://gzowos-games-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'gzowos-games',
  storageBucket: 'gzowos-games.firebasestorage.app',
  messagingSenderId: '658227201482',
  appId: '1:658227201482:web:627b44e3c4c2988bc4bb33',
};

const SDK_VERSION = '10.12.5';
const SDK_BASE = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;

export const ROOT = 'refract';

/* --------------------------------------------------------------- constants */

// Cursor colours, assigned by join order. Saturated enough to survive the additive bloom of
// the board, distinct in hue even under a red/green deficiency, and all from the same
// "coloured arrow with a white outline" family as the reference cursor.
export const PLAYER_COLORS = [
  '#2E5BFF', // 0 - reference blue, taken by whoever seats first
  '#FF4D6D', // 1 - rose
  '#35D6A4', // 2 - mint
  '#FFB020', // 3 - amber
  '#B26BFF', // 4 - violet
  '#37C8FF', // 5 - cyan
  '#8BE23C', // 6 - lime
  '#FF7A3D', // 7 - coral
];

export const MAX_PLAYERS = PLAYER_COLORS.length;

// Room-code alphabet. Every letter that collides with a digit is dropped (B I L O S Z), so
// each dropped letter folds into exactly one digit when a player mistypes a shared code.
const CODE_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY0123456789';
const CODE_FOLD = { B: '8', I: '1', L: '1', O: '0', S: '5', Z: '2' };
export const CODE_LENGTH = 4;

const CURSOR_INTERVAL = 50;     // 20 Hz cursor writes
const OPTIC_INTERVAL = 50;      // 20 Hz coalesced drag writes, per optic
const HEARTBEAT_INTERVAL = 15000;
const SWEEP_INTERVAL = 20000;
const STALE_AFTER = 90000;      // a player this quiet is a ghost and gets swept
const CLAIM_TTL = 5000;         // a soft lock older than this is ignored
const CLAIM_REFRESH = 2000;
const LOAD_TIMEOUT = 8000;
const AUTH_TIMEOUT = 10000;

const OP_KINDS = new Set(['place', 'move', 'rotate', 'remove', 'claim', 'release']);
const BAD_KEY = /[.#$/[\]]/;

/* ------------------------------------------------------------ tiny emitter */

function createEmitter() {
  const map = new Map();
  return {
    on(evt, fn) {
      if (typeof fn !== 'function') return () => {};
      if (!map.has(evt)) map.set(evt, new Set());
      map.get(evt).add(fn);
      return () => map.get(evt)?.delete(fn);
    },
    off(evt, fn) {
      map.get(evt)?.delete(fn);
    },
    emit(evt, payload) {
      const set = map.get(evt);
      if (!set) return;
      for (const fn of Array.from(set)) {
        try {
          fn(payload);
        } catch (err) {
          console.warn(`[net] listener for "${evt}" threw`, err);
        }
      }
    },
    clear() {
      map.clear();
    },
  };
}

/* -------------------------------------------------------------- room codes */

export function normalizeRoomCode(raw) {
  if (typeof raw !== 'string') return '';
  let out = '';
  for (const ch of raw.toUpperCase()) {
    const folded = CODE_FOLD[ch] ?? ch;
    if (CODE_ALPHABET.includes(folded)) out += folded;
  }
  return out.slice(0, 12);
}

export function createRoomCode(length = CODE_LENGTH) {
  const n = Math.max(3, Math.min(12, length | 0));
  const bytes = new Uint32Array(n);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 0xffffffff);
  }
  let out = '';
  for (let i = 0; i < n; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export function isValidRoomCode(code) {
  return normalizeRoomCode(code).length >= 3;
}

// Accepts ?room=ABCD, ?r=ABCD, #ABCD and #room=ABCD from any URL.
export function roomFromLocation(href) {
  const source = href ?? (typeof location !== 'undefined' ? location.href : '');
  if (!source) return '';
  let url;
  try {
    url = new URL(source);
  } catch {
    return '';
  }
  const q = url.searchParams.get('room') || url.searchParams.get('r');
  if (q) {
    const c = normalizeRoomCode(q);
    if (c.length >= 3) return c;
  }
  const hash = url.hash.replace(/^#/, '');
  if (!hash) return '';
  const eq = hash.indexOf('=');
  const tail = eq >= 0 ? hash.slice(eq + 1) : hash;
  const c = normalizeRoomCode(tail);
  return c.length >= 3 ? c : '';
}

export function roomUrl(code, href) {
  const fallback = 'https://refract.gzowo.fun/';
  const source = href ?? (typeof location !== 'undefined' ? location.href : fallback);
  const clean = normalizeRoomCode(code);
  let url;
  try {
    url = new URL(source);
  } catch {
    return `${fallback}#${clean}`;
  }
  url.search = '';
  url.hash = clean;
  return url.toString();
}

/* ------------------------------------------------------------- SDK loading */

let sdkPromise = null;
let sdkFailed = false;
let loggedFailure = false;

function logFailureOnce(reason) {
  if (loggedFailure) return;
  loggedFailure = true;
  console.info('[net] multiplayer unavailable, staying in solo mode:', reason);
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function configLooksUsable(cfg) {
  return Boolean(
    cfg &&
    typeof cfg.apiKey === 'string' && cfg.apiKey.length > 20 && !/REPLACE|PLACEHOLDER|XXXX/i.test(cfg.apiKey) &&
    typeof cfg.databaseURL === 'string' && /^https:\/\/[^\s]+firebase/i.test(cfg.databaseURL),
  );
}

async function loadSDK() {
  if (sdkFailed) return null;
  if (sdkPromise) return sdkPromise;

  if (!configLooksUsable(FIREBASE_CONFIG)) {
    sdkFailed = true;
    logFailureOnce('FIREBASE_CONFIG is missing or a placeholder');
    return null;
  }
  if (typeof window === 'undefined') {
    sdkFailed = true;
    logFailureOnce('no browser environment');
    return null;
  }

  sdkPromise = withTimeout(
    (async () => {
      const [appMod, authMod, dbMod] = await Promise.all([
        import(`${SDK_BASE}/firebase-app.js`),
        import(`${SDK_BASE}/firebase-auth.js`),
        import(`${SDK_BASE}/firebase-database.js`),
      ]);
      const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(FIREBASE_CONFIG);
      const auth = authMod.getAuth(app);
      const db = dbMod.getDatabase(app);
      const user = await withTimeout(
        new Promise((resolve, reject) => {
          const stop = authMod.onAuthStateChanged(
            auth,
            (u) => { if (u) { stop(); resolve(u); } },
            (err) => { stop(); reject(err); },
          );
          authMod.signInAnonymously(auth).catch((err) => { stop(); reject(err); });
        }),
        AUTH_TIMEOUT,
        'anonymous sign-in',
      );
      return { app, auth, db, uid: user.uid, D: dbMod };
    })(),
    LOAD_TIMEOUT,
    'Firebase load',
  ).catch((err) => {
    sdkFailed = true;
    sdkPromise = null;
    logFailureOnce(err?.message || String(err));
    return null;
  });

  return sdkPromise;
}

export function isNetAvailable() {
  return !sdkFailed;
}

/* ----------------------------------------------------------------- helpers */

function sanitizeName(name) {
  const s = String(name ?? '').replace(/[\s\x00-\x1f]+/g, ' ').trim();
  return (s || 'PLAYER').slice(0, 16).toUpperCase();
}

function round1(v) {
  return Number.isFinite(v) ? Math.round(v * 10) / 10 : 0;
}

function round4(v) {
  return Number.isFinite(v) ? Math.round(v * 10000) / 10000 : 0;
}

function colorFor(index) {
  const n = PLAYER_COLORS.length;
  const i = Number.isFinite(index) ? ((index % n) + n) % n : 0;
  return PLAYER_COLORS[i];
}

/* ------------------------------------------------------------ solo fallback */

function createSoloHandle(roomId, name, reason) {
  const bus = createEmitter();
  let left = false;
  let seq = 0;
  return {
    mintId() { return `o${++seq}`; },
    mode: 'solo',
    ok: false,
    online: false,
    reason: reason || 'multiplayer unavailable',
    roomId: normalizeRoomCode(roomId),
    uid: 'local',
    name: sanitizeName(name),
    colorIndex: 0,
    color: PLAYER_COLORS[0],
    players: new Map(),
    optics: new Map(),
    url: '',
    on: bus.on,
    off: bus.off,
    setCursor() {},
    broadcast() {},
    claim() {},
    release() {},
    claimOf() { return null; },
    setName(next) { return sanitizeName(next); },
    setLevel() {},
    clearOptics() {},
    now() { return Date.now(); },
    leave() { if (!left) { left = true; bus.clear(); } },
  };
}

/* --------------------------------------------------------------- joinRoom */

/**
 * Join (or create) a multiplayer room.
 * Never throws and never rejects: on any failure it resolves to an inert solo handle whose
 * `ok` is false, so callers can wire multiplayer up unconditionally and ignore the outcome.
 *
 * @param {string} roomId  room code; falsy or too short creates a fresh one
 * @param {string} name    display name
 * @returns {Promise<object>} handle with leave(), setCursor(x, y), broadcast(op), on/off
 */
export async function joinRoom(roomId, name) {
  const displayName = sanitizeName(name);
  const requested = normalizeRoomCode(roomId);
  const code = requested.length >= 3 ? requested : createRoomCode();

  let sdk = null;
  try {
    sdk = await loadSDK();
  } catch (err) {
    logFailureOnce(err?.message || String(err));
  }
  if (!sdk) return createSoloHandle(code, displayName, 'Firebase unavailable');

  try {
    return await attachRoom(sdk, code, displayName);
  } catch (err) {
    logFailureOnce(err?.message || String(err));
    return createSoloHandle(code, displayName, err?.message || 'room join failed');
  }
}

/* -------------------------------------------------------------- room logic */

async function attachRoom(sdk, code, displayName) {
  const { db, uid, D } = sdk;
  const bus = createEmitter();

  const roomPath = `${ROOT}/rooms/${code}`;
  const metaRef = D.ref(db, `${roomPath}/meta`);
  const playersRef = D.ref(db, `${roomPath}/players`);
  const meRef = D.ref(db, `${roomPath}/players/${uid}`);
  const opticsRef = D.ref(db, `${roomPath}/optics`);

  let left = false;
  let online = false;
  // Declared here, not at the handle literal below, because the `.info/connected` listener
  // registered further down fires IMMEDIATELY with Firebase's cached value -- before this
  // function has reached the literal. Reading a `const handle` from that callback threw
  // "Cannot access 'handle' before initialization" out of the temporal dead zone, which
  // aborted the rest of joinRoom, so the players listener was never attached and no client
  // ever saw another. Two clients could both report a successful join into the same room
  // and sit there with an empty roster.
  let handle = null;
  let clockOffset = 0;
  const now = () => Date.now() + clockOffset;

  const players = new Map();  // uid -> { uid, name, color, colorIndex, x, y, t, self }
  const optics = new Map();   // id  -> { id, type, x, y, angle, by, ts, claim, claimTs, removed }

  const unsubs = [];
  const intervals = [];
  const track = (fn) => { if (typeof fn === 'function') unsubs.push(fn); };
  const every = (ms, fn) => { intervals.push(setInterval(fn, ms)); };

  /* ---- server clock: all timestamps are client clocks corrected by this offset ---- */
  track(D.onValue(D.ref(db, '.info/serverTimeOffset'), (snap) => {
    const v = snap.val();
    if (typeof v === 'number' && Number.isFinite(v)) clockOffset = v;
  }, () => {}));

  /* ---- seat and colour, by join order ---- */
  const existing = await D.get(playersRef).catch(() => null);
  const taken = new Set();
  if (existing?.exists()) {
    existing.forEach((child) => {
      const v = child.val();
      if (v && typeof v.ci === 'number') taken.add(v.ci);
    });
  }
  const order = [];
  for (let i = 0; i < MAX_PLAYERS; i++) if (!taken.has(i)) order.push(i);
  for (let i = 0; i < MAX_PLAYERS; i++) if (taken.has(i)) order.push(i);

  let colorIndex = -1;
  for (const candidate of order) {
    const seat = D.ref(db, `${roomPath}/seats/${candidate}`);
    try {
      const res = await D.runTransaction(seat, (current) => (
        current === null || current === uid ? uid : undefined
      ));
      if (res?.committed && res.snapshot?.val() === uid) {
        colorIndex = candidate;
        break;
      }
    } catch { /* seat contested or denied, try the next one */ }
  }
  // A full room shares a colour rather than refusing to join; the game itself has no cap.
  if (colorIndex < 0) colorIndex = order[0] ?? 0;

  const mySeatRef = D.ref(db, `${roomPath}/seats/${colorIndex}`);
  const color = colorFor(colorIndex);

  /* ---- presence ---- */
  let myName = displayName;
  const lastCursor = { x: 500, y: 500 };

  function writePresence() {
    if (left) return;
    D.update(meRef, {
      n: myName,
      ci: colorIndex,
      x: Math.round(lastCursor.x),
      y: Math.round(lastCursor.y),
      t: now(),
    }).catch(() => {});
  }

  async function armDisconnect() {
    try {
      await D.onDisconnect(meRef).remove();
      await D.onDisconnect(mySeatRef).remove();
    } catch { /* will be re-armed on the next reconnect */ }
  }

  // Stamp createdAt exactly once, so a later joiner does not rewrite the room's birthday.
  D.runTransaction(D.ref(db, `${roomPath}/meta/createdAt`), (cur) => (
    cur === null ? D.serverTimestamp() : undefined
  )).catch(() => {});

  await armDisconnect();
  writePresence();

  track(D.onValue(D.ref(db, '.info/connected'), async (snap) => {
    const connected = snap.val() === true;
    if (connected === online) return;
    online = connected;
    if (handle) handle.online = connected;
    bus.emit('status', { state: connected ? 'online' : 'offline', roomId: code });
    if (connected && !left) {
      await armDisconnect();
      writePresence();
    }
  }, () => {}));

  every(HEARTBEAT_INTERVAL, () => {
    if (left || !online) return;
    D.update(meRef, { t: now() }).catch(() => {});
  });

  // Ghost sweep: a tab killed while already offline never fires its onDisconnect, so the
  // live clients clean up for it. The rules permit removing a player that stale.
  every(SWEEP_INTERVAL, () => {
    if (left || !online) return;
    const cutoff = now() - STALE_AFTER;
    for (const p of players.values()) {
      if (p.self || p.t >= cutoff) continue;
      D.remove(D.ref(db, `${roomPath}/players/${p.uid}`)).catch(() => {});
      D.runTransaction(D.ref(db, `${roomPath}/seats/${p.colorIndex}`), (cur) => (
        cur === p.uid ? null : undefined
      )).catch(() => {});
    }
  });

  /* ---- players stream ---- */
  function readPlayer(snap) {
    const v = snap.val() || {};
    const ci = typeof v.ci === 'number' ? v.ci : 0;
    return {
      uid: snap.key,
      name: sanitizeName(v.n),
      colorIndex: ci,
      color: colorFor(ci),
      x: typeof v.x === 'number' ? v.x : 500,
      y: typeof v.y === 'number' ? v.y : 500,
      t: typeof v.t === 'number' ? v.t : 0,
      self: snap.key === uid,
    };
  }

  track(D.onChildAdded(playersRef, (snap) => {
    const p = readPlayer(snap);
    players.set(p.uid, p);
    bus.emit('player-join', p);
    bus.emit('players', players);
  }, () => {}));

  track(D.onChildChanged(playersRef, (snap) => {
    const next = readPlayer(snap);
    const prev = players.get(next.uid);
    players.set(next.uid, next);
    if (!prev || prev.x !== next.x || prev.y !== next.y) bus.emit('player-move', next);
    if (!prev || prev.name !== next.name || prev.colorIndex !== next.colorIndex) {
      bus.emit('player-update', next);
      bus.emit('players', players);
    }
  }, () => {}));

  track(D.onChildRemoved(playersRef, (snap) => {
    const p = players.get(snap.key);
    players.delete(snap.key);
    bus.emit('player-leave', p || { uid: snap.key });
    bus.emit('players', players);
  }, () => {}));

  /* ---- optics stream ---- */
  function readOptic(snap) {
    const v = snap.val() || {};
    const claimTs = typeof v.ct === 'number' ? v.ct : 0;
    const holder = typeof v.c === 'string' ? v.c : null;
    return {
      id: snap.key,
      type: v.k === 'p' ? 'prism' : 'mirror',
      x: typeof v.x === 'number' ? v.x : 0,
      y: typeof v.y === 'number' ? v.y : 0,
      angle: typeof v.a === 'number' ? v.a : 0,
      by: typeof v.b === 'string' ? v.b : '',
      ts: typeof v.ts === 'number' ? v.ts : 0,
      removed: v.d === true,
      claim: holder && now() - claimTs < CLAIM_TTL ? holder : null,
      claimTs,
    };
  }

  function ingestOptic(snap) {
    const next = readOptic(snap);
    const prev = optics.get(next.id);
    // Last-write-wins on a server-corrected clock: a stale or out-of-order echo never rolls
    // a newer state back, so two players dragging different optics can never conflict and
    // two players dragging the SAME optic simply converge on the later write.
    if (prev && next.ts < prev.ts) return;
    optics.set(next.id, next);

    const mineOnly = next.by === uid
      && (next.claim === null || next.claim === uid)
      && (!prev || prev.claim === null || prev.claim === uid);

    if (next.removed) {
      if (!mineOnly) bus.emit('optic-remove', { id: next.id, by: next.by, ts: next.ts });
    } else if (!mineOnly) {
      bus.emit('optic', { ...next, claimColor: next.claim ? (players.get(next.claim)?.color ?? null) : null });
    }
    bus.emit('optics', optics);
  }

  track(D.onChildAdded(opticsRef, ingestOptic, () => {}));
  track(D.onChildChanged(opticsRef, ingestOptic, () => {}));
  track(D.onChildRemoved(opticsRef, (snap) => {
    const prev = optics.get(snap.key);
    optics.delete(snap.key);
    if (prev?.by !== uid) bus.emit('optic-remove', { id: snap.key, by: prev?.by ?? '', ts: now() });
    bus.emit('optics', optics);
  }, () => {}));

  /* ---- level ---- */
  let lastLevel = null;
  track(D.onValue(D.ref(db, `${roomPath}/meta/level`), (snap) => {
    const v = snap.val();
    if (typeof v !== 'number' || v === lastLevel) return;
    const initial = lastLevel === null;
    lastLevel = v;
    bus.emit('level', { index: v, initial });
  }, () => {}));

  /* ---- cursor: hard-capped at 20 Hz, leading edge plus a guaranteed trailing write ---- */
  let cursorDirty = false;
  let cursorTimer = null;

  function sendCursor() {
    cursorDirty = false;
    D.update(meRef, {
      x: Math.round(lastCursor.x),
      y: Math.round(lastCursor.y),
      t: now(),
    }).catch(() => {});
  }

  function cursorTick() {
    if (left) { cursorTimer = null; return; }
    if (cursorDirty) {
      sendCursor();
      cursorTimer = setTimeout(cursorTick, CURSOR_INTERVAL);
    } else {
      cursorTimer = null;
    }
  }

  function setCursor(x, y) {
    if (left || !Number.isFinite(x) || !Number.isFinite(y)) return;
    lastCursor.x = x;
    lastCursor.y = y;
    cursorDirty = true;
    if (cursorTimer === null) {
      sendCursor();
      cursorTimer = setTimeout(cursorTick, CURSOR_INTERVAL);
    }
  }

  /* ---- optic ops: same rate limiter, per optic id ---- */
  const opTimers = new Map();   // id -> timeout driving the trailing write
  const opPending = new Map();  // id -> merged payload waiting for the next slot
  const claimTimers = new Map();
  let opSeq = 0;

  const opticRef = (id) => D.ref(db, `${roomPath}/optics/${id}`);

  function writeOptic(id, payload) {
    if (left) return;
    D.update(opticRef(id), payload).catch(() => {});
  }

  function opTick(id) {
    if (left) { opTimers.delete(id); return; }
    const tail = opPending.get(id);
    if (tail) {
      opPending.delete(id);
      tail.ts = now();
      writeOptic(id, tail);
      opTimers.set(id, setTimeout(() => opTick(id), OPTIC_INTERVAL));
    } else {
      opTimers.delete(id);
    }
  }

  function scheduleOptic(id, payload) {
    opPending.set(id, { ...(opPending.get(id) || {}), ...payload });
    if (opTimers.has(id)) return;
    const first = opPending.get(id);
    opPending.delete(id);
    writeOptic(id, first);
    opTimers.set(id, setTimeout(() => opTick(id), OPTIC_INTERVAL));
  }

  function flushOptic(id) {
    const t = opTimers.get(id);
    if (t !== undefined) { clearTimeout(t); opTimers.delete(id); }
    const tail = opPending.get(id);
    if (tail) {
      opPending.delete(id);
      tail.ts = now();
      writeOptic(id, tail);
    }
  }

  function clearClaimTimer(id) {
    const t = claimTimers.get(id);
    if (t !== undefined) { clearInterval(t); claimTimers.delete(id); }
    return t !== undefined;
  }

  function startClaim(id) {
    if (claimTimers.has(id)) return;
    writeOptic(id, { c: uid, ct: now(), ts: now() });
    claimTimers.set(id, setInterval(() => {
      if (left) return;
      writeOptic(id, { c: uid, ct: now() });
    }, CLAIM_REFRESH));
  }

  function stopClaim(id) {
    const held = clearClaimTimer(id);
    // Never clear somebody else's lock.
    if (held || optics.get(id)?.claim === uid) writeOptic(id, { c: null, ct: 0, ts: now() });
  }

  function broadcast(op) {
    if (left || !op || typeof op !== 'object') return;
    const { kind } = op;
    const id = typeof op.id === 'string' ? op.id : '';
    if (!OP_KINDS.has(kind) || !id || id.length > 40 || BAD_KEY.test(id)) return;

    switch (kind) {
      case 'place':
        flushOptic(id);
        D.set(opticRef(id), {
          k: op.type === 'prism' ? 'p' : 'm',
          x: round1(op.x),
          y: round1(op.y),
          a: round4(op.angle),
          b: uid,
          ts: now(),
        }).catch(() => {});
        break;

      case 'move':
        scheduleOptic(id, { x: round1(op.x), y: round1(op.y), b: uid, ts: now() });
        break;

      case 'rotate':
        scheduleOptic(id, { a: round4(op.angle), b: uid, ts: now() });
        break;

      case 'remove':
        flushOptic(id);
        clearClaimTimer(id);
        // A tombstone, not a delete: a stale in-flight move from another client would
        // otherwise resurrect an optic the owner has already removed.
        D.set(opticRef(id), { d: true, b: uid, ts: now() }).catch(() => {});
        break;

      case 'claim':
        startClaim(id);
        break;

      case 'release':
        flushOptic(id);
        stopClaim(id);
        break;

      default:
        break;
    }
  }

  /* ---- handle ---- */
  handle = {
    mode: 'multi',
    ok: true,
    online,
    reason: '',
    roomId: code,
    uid,
    get name() { return myName; },
    colorIndex,
    color,
    players,
    optics,
    url: roomUrl(code),
    on: bus.on,
    off: bus.off,

    setCursor,
    broadcast,

    // Collision-free optic id. Two clients minting at the same instant cannot produce the
    // same key, so simultaneous placements stay two optics instead of collapsing into one.
    mintId() { return `${uid.slice(0, 6)}-${(++opSeq).toString(36)}`; },

    claim(id) { broadcast({ kind: 'claim', id }); },
    release(id) { broadcast({ kind: 'release', id }); },

    // Live soft-lock owner for an optic, or null when it is free or held by us. The TTL is
    // evaluated on every call, so a renderer can poll this per frame and a lock left behind
    // by a crashed client fades on its own.
    claimOf(id) {
      const o = optics.get(id);
      if (!o || !o.claim || o.claim === uid || now() - o.claimTs >= CLAIM_TTL) return null;
      return { uid: o.claim, color: players.get(o.claim)?.color ?? PLAYER_COLORS[0] };
    },

    setName(next) {
      myName = sanitizeName(next);
      if (!left) D.update(meRef, { n: myName, t: now() }).catch(() => {});
      return myName;
    },

    setLevel(index) {
      if (left || !Number.isInteger(index)) return;
      for (const id of Array.from(claimTimers.keys())) clearClaimTimer(id);
      D.update(metaRef, { level: index }).catch(() => {});
      D.remove(opticsRef).catch(() => {});
    },

    clearOptics() {
      if (left) return;
      for (const id of Array.from(claimTimers.keys())) clearClaimTimer(id);
      D.remove(opticsRef).catch(() => {});
    },

    now,

    leave() {
      if (left) return;
      left = true;
      for (const t of intervals) clearInterval(t);
      intervals.length = 0;
      for (const t of opTimers.values()) clearTimeout(t);
      opTimers.clear();
      opPending.clear();
      for (const t of claimTimers.values()) clearInterval(t);
      claimTimers.clear();
      if (cursorTimer !== null) { clearTimeout(cursorTimer); cursorTimer = null; }
      for (const un of unsubs) {
        try { un(); } catch { /* already detached */ }
      }
      unsubs.length = 0;
      try { D.onDisconnect(meRef).cancel(); } catch { /* offline */ }
      try { D.onDisconnect(mySeatRef).cancel(); } catch { /* offline */ }
      D.remove(meRef).catch(() => {});
      D.runTransaction(mySeatRef, (cur) => (cur === uid ? null : undefined)).catch(() => {});
      players.clear();
      optics.clear();
      bus.emit('status', { state: 'left', roomId: code });
      bus.clear();
    },
  };

  // onDisconnect covers a closed tab, but on iOS Safari the socket often dies before the
  // last cursor write lands, so pagehide flushes it explicitly.
  if (typeof window !== 'undefined') {
    const onPageHide = () => { if (cursorDirty) sendCursor(); };
    window.addEventListener('pagehide', onPageHide);
    unsubs.push(() => window.removeEventListener('pagehide', onPageHide));
  }

  bus.emit('status', { state: 'connecting', roomId: code });
  return handle;
}
