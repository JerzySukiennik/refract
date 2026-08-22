// Web Audio engine for REFRACT: sample bank + synthesised beam hum, rotation ticks, receptor bells and solve cue.
// Exports: init, unlock, play, stop, setBeamEnergy, setLitCount, rotateTick, receptorChime,
// solve, setMuted, getMuted, toggleMuted, setMasterVolume, isReady, dispose.

const MANIFEST_URL = new URL('../assets/audio/manifest.json', import.meta.url);
const STORAGE_KEY = 'refract.sound';

const FALLBACK = {
  master: { gain: 0.85, fade: 0.35, voiceCap: 24, synthCap: 160 },
  buses: { sfx: 1, tone: 0.9, hum: 1, reverb: 0.55 },
  aliases: {},
  sounds: {},
  synth: {
    chord: [293.665, 440, 659.255],
    solveChord: [146.832, 293.665, 440, 659.255, 739.989, 880],
    solveStagger: [0, 0.05, 0.11, 0.17, 0.25, 0.33],
    sparkleScale: [587.33, 659.26, 739.99, 880, 1108.73, 1174.66, 1318.51, 1479.98, 1760, 2217.46],
    bell: {
      gain: 0.21,
      partials: [1, 2, 2.997, 4.235, 5.432, 6.79],
      levels: [1, 0.46, 0.3, 0.17, 0.1, 0.06],
      decays: [2.7, 2, 1.45, 0.95, 0.62, 0.45],
      strikeGain: 0.1,
      subGain: 0.16,
      send: 0.42,
    },
    tick: { gain: 0.13, baseHz: 900, octaves: 1.5, dur: 0.022, noiseGain: 0.05, send: 0.06 },
    hum: {
      gain: 0.038,
      partials: [55, 82.5, 110, 164.5],
      levels: [1, 0.5, 0.34, 0.14],
      waves: ['sine', 'sine', 'triangle', 'sine'],
      cutoff: [190, 1350],
      noiseGain: 0.35,
      noiseBand: [300, 2400],
      breathHz: 0.052,
      breathDepth: 0.13,
      driftHz: 0.071,
      send: 0.3,
    },
    sparkle: { count: 14, spread: 0.95, dur: 0.055, gain: 0.075, send: 0.5 },
    reverb: { seconds: 1.7, decay: 2.9, predelay: 0.02, damp: 0.34 },
  },
};

const A = {
  manifest: FALLBACK,
  fetching: null,
  raw: new Map(),
  buffers: new Map(),
  ctx: null,
  nodes: null,
  ready: false,
  building: false,
  muted: false,
  volume: 1,
  voices: 0,
  synthVoices: 0,
  lastPlay: new Map(),
  lastRate: new Map(),
  lastIndex: new Map(),
  energyTarget: 0,
  litTarget: 0,
  lastEnergyWrite: 0,
  lastTickHz: 0,
  suspendTimer: 0,
  seed: 0x9e3779b9,
  warned: new Set(),
  listening: false,
  stateSynced: false,
};

function safe(fn) {
  try {
    return fn();
  } catch (e) {
    return undefined;
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function rnd() {
  A.seed = (A.seed * 1664525 + 1013904223) >>> 0;
  return A.seed / 4294967296;
}

function now() {
  return A.ctx ? A.ctx.currentTime : 0;
}

function millis() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function readStoredMute() {
  const v = safe(() => window.localStorage.getItem(STORAGE_KEY));
  return v === '0';
}

function writeStoredMute(muted) {
  safe(() => window.localStorage.setItem(STORAGE_KEY, muted ? '0' : '1'));
}

function resolveName(name) {
  const m = A.manifest;
  if (m.sounds[name]) return name;
  const alias = m.aliases && m.aliases[name];
  if (alias && m.sounds[alias]) return alias;
  if (!A.warned.has(name)) {
    A.warned.add(name);
  }
  return null;
}

function decodeBuffer(ctx, data) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ok = (buf) => {
      if (!settled) {
        settled = true;
        resolve(buf);
      }
    };
    const bad = (err) => {
      if (!settled) {
        settled = true;
        reject(err || new Error('decode failed'));
      }
    };
    const p = ctx.decodeAudioData(data, ok, bad);
    if (p && typeof p.then === 'function') p.then(ok, bad);
  });
}

async function loadManifest() {
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error('manifest ' + res.status);
    const json = await res.json();
    A.manifest = {
      master: Object.assign({}, FALLBACK.master, json.master),
      buses: Object.assign({}, FALLBACK.buses, json.buses),
      aliases: Object.assign({}, FALLBACK.aliases, json.aliases),
      sounds: json.sounds || {},
      synth: Object.assign({}, FALLBACK.synth, json.synth || {}),
    };
    const s = A.manifest.synth;
    s.bell = Object.assign({}, FALLBACK.synth.bell, s.bell);
    s.tick = Object.assign({}, FALLBACK.synth.tick, s.tick);
    s.hum = Object.assign({}, FALLBACK.synth.hum, s.hum);
    s.sparkle = Object.assign({}, FALLBACK.synth.sparkle, s.sparkle);
    s.reverb = Object.assign({}, FALLBACK.synth.reverb, s.reverb);
  } catch (e) {
    A.manifest = FALLBACK;
  }
}

async function fetchSamples() {
  const files = new Set();
  for (const key of Object.keys(A.manifest.sounds)) {
    const def = A.manifest.sounds[key];
    if (def && def.files) for (const f of def.files) files.add(f);
  }
  const jobs = [];
  for (const file of files) {
    if (A.raw.has(file) || A.buffers.has(file)) continue;
    const url = new URL(file, MANIFEST_URL);
    jobs.push(
      fetch(url, { cache: 'force-cache' })
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((ab) => {
          if (ab) A.raw.set(file, ab);
        })
        .catch(() => {})
    );
  }
  await Promise.all(jobs);
}

function makeNoiseBuffer(ctx, seconds, brown) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = rnd() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.2;
    } else {
      d[i] = white;
    }
  }
  return buf;
}

function makeImpulse(ctx, cfg) {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * cfg.seconds));
  const pre = Math.floor(sr * cfg.predelay);
  const buf = ctx.createBuffer(2, len + pre, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.pow(1 - t, cfg.decay);
      const white = rnd() * 2 - 1;
      lp += (white - lp) * (1 - cfg.damp);
      d[pre + i] = lp * env;
    }
  }
  return buf;
}

function buildGraph() {
  const ctx = A.ctx;
  const m = A.manifest;
  const master = ctx.createGain();
  master.gain.value = A.muted ? 0 : m.master.gain * A.volume;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -7;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.22;

  const out = ctx.createGain();
  out.gain.value = 0.92;

  master.connect(limiter);
  limiter.connect(out);
  out.connect(ctx.destination);

  const sfx = ctx.createGain();
  sfx.gain.value = m.buses.sfx;
  sfx.connect(master);

  const tone = ctx.createGain();
  tone.gain.value = m.buses.tone;
  tone.connect(master);

  const hum = ctx.createGain();
  hum.gain.value = m.buses.hum;
  hum.connect(master);

  const convolver = ctx.createConvolver();
  convolver.buffer = makeImpulse(ctx, m.synth.reverb);
  const reverbReturn = ctx.createGain();
  reverbReturn.gain.value = m.buses.reverb;
  convolver.connect(reverbReturn);
  reverbReturn.connect(master);

  A.nodes = {
    master,
    limiter,
    out,
    sfx,
    tone,
    hum,
    convolver,
    reverbReturn,
    noise: makeNoiseBuffer(ctx, 3, true),
    white: makeNoiseBuffer(ctx, 1, false),
  };
  buildHum();
}

function buildHum() {
  const ctx = A.ctx;
  const cfg = A.manifest.synth.hum;
  const n = A.nodes;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cfg.cutoff[0];
  filter.Q.value = 0.7;

  const bank = ctx.createGain();
  bank.gain.value = 1;
  bank.connect(filter);

  const oscs = [];
  for (let i = 0; i < cfg.partials.length; i++) {
    const osc = ctx.createOscillator();
    osc.type = cfg.waves[i] || 'sine';
    osc.frequency.value = cfg.partials[i];
    const g = ctx.createGain();
    g.gain.value = cfg.levels[i] || 0.2;
    osc.connect(g);
    g.connect(bank);

    const drift = ctx.createOscillator();
    drift.type = 'sine';
    drift.frequency.value = cfg.driftHz * (0.6 + i * 0.37);
    const driftGain = ctx.createGain();
    driftGain.gain.value = 2.5 + i * 1.5;
    drift.connect(driftGain);
    driftGain.connect(osc.detune);

    osc.start();
    drift.start();
    oscs.push({ osc, g, drift });
  }

  const noise = ctx.createBufferSource();
  noise.buffer = n.noise;
  noise.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = cfg.noiseBand[0];
  band.Q.value = 1.1;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = cfg.noiseGain;
  noise.connect(band);
  band.connect(noiseGain);
  noiseGain.connect(filter);
  noise.start();

  const level = ctx.createGain();
  level.gain.value = 0.0001;
  filter.connect(level);
  level.connect(n.hum);

  const send = ctx.createGain();
  send.gain.value = cfg.send;
  level.connect(send);
  send.connect(n.convolver);

  const breath = ctx.createOscillator();
  breath.type = 'sine';
  breath.frequency.value = cfg.breathHz;
  const breathGain = ctx.createGain();
  breathGain.gain.value = 0.0001;
  breath.connect(breathGain);
  breathGain.connect(level.gain);
  breath.start();

  const shimmer = ctx.createOscillator();
  shimmer.type = 'sine';
  shimmer.frequency.value = A.manifest.synth.chord[1] || 440;
  const shimmerGain = ctx.createGain();
  shimmerGain.gain.value = 0.0001;
  shimmer.connect(shimmerGain);
  shimmerGain.connect(bank);
  shimmer.start();

  A.nodes.humParts = { filter, bank, oscs, band, noiseGain, level, breathGain, shimmer, shimmerGain, send };
  applyHum(true);
}

function applyHum(force) {
  const n = A.nodes;
  if (!n || !n.humParts) return;
  const t = now();
  if (!force && t - A.lastEnergyWrite < 0.05) return;
  A.lastEnergyWrite = t;

  const cfg = A.manifest.synth.hum;
  const p = n.humParts;
  const e = clamp(A.energyTarget, 0, 1);
  const lit = clamp(A.litTarget / 3, 0, 1);
  const shaped = Math.pow(e, 0.7);

  const cutoff = cfg.cutoff[0] + (cfg.cutoff[1] - cfg.cutoff[0]) * (0.25 * lit + 0.75 * shaped);
  const gain = cfg.gain * (0.1 + 0.9 * shaped) * (0.85 + 0.3 * lit);
  const band = cfg.noiseBand[0] + (cfg.noiseBand[1] - cfg.noiseBand[0]) * (0.35 + 0.65 * shaped);

  const tc = 0.35;
  safe(() => p.filter.frequency.setTargetAtTime(cutoff, t, tc));
  safe(() => p.band.frequency.setTargetAtTime(band, t, tc));
  safe(() => p.level.gain.setTargetAtTime(Math.max(0.0001, gain), t, tc));
  safe(() => p.breathGain.gain.setTargetAtTime(Math.max(0.0001, gain * cfg.breathDepth), t, tc));
  safe(() => p.shimmerGain.gain.setTargetAtTime(Math.max(0.0001, 0.05 * lit * shaped), t, 0.6));
  safe(() => p.shimmer.frequency.setTargetAtTime((A.manifest.synth.chord[1] || 440) * (1 + 0.005 * lit), t, 1.0));
}

function makeVoiceOut(bus, send, pan) {
  const ctx = A.ctx;
  const n = A.nodes;
  const gain = ctx.createGain();
  let tail = gain;
  if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    gain.connect(panner);
    tail = panner;
  }
  tail.connect(bus === 'tone' ? n.tone : n.sfx);
  if (send > 0) {
    const s = ctx.createGain();
    s.gain.value = send;
    tail.connect(s);
    s.connect(n.convolver);
  }
  return gain;
}

function panFor(opts) {
  if (!opts) return 0;
  if (typeof opts.pan === 'number') return clamp(opts.pan, -1, 1);
  if (typeof opts.panX === 'number') return clamp((opts.panX / 1000 - 0.5) * 0.55, -1, 1);
  return 0;
}

function pickVariant(name, def) {
  const files = def.files;
  if (!files || files.length === 0) return null;
  if (files.length === 1) return files[0];
  const last = A.lastIndex.get(name);
  let i = Math.floor(rnd() * files.length) % files.length;
  if (i === last) i = (i + 1 + Math.floor(rnd() * (files.length - 1))) % files.length;
  A.lastIndex.set(name, i);
  return files[i];
}

function pickRate(name, def) {
  const range = def.pitch || [1, 1];
  const lo = range[0];
  const hi = range[1];
  if (hi - lo < 0.001) return lo;
  const last = A.lastRate.get(name);
  let r = lo + rnd() * (hi - lo);
  for (let k = 0; k < 8 && last !== undefined && Math.abs(r - last) < (hi - lo) * 0.25; k++) {
    r = lo + rnd() * (hi - lo);
  }
  A.lastRate.set(name, r);
  return r;
}

function cooldownBlocked(name, def, ms) {
  const cd = ms !== undefined ? ms : def.cooldown || 0;
  if (cd <= 0) return false;
  const t = millis();
  const prev = A.lastPlay.get(name);
  if (prev !== undefined && t - prev < cd) return true;
  A.lastPlay.set(name, t);
  return false;
}

function playAccent(cfg, when, pan, gainScale) {
  const ctx = A.ctx;
  if (A.synthVoices > A.manifest.master.synthCap * 0.4) return;
  const osc = ctx.createOscillator();
  osc.type = cfg.wave || 'sine';
  const g = makeVoiceOut('sfx', 0.06, pan);
  const peak = Math.max(0.0001, cfg.gain * gainScale);
  osc.frequency.setValueAtTime(cfg.f0, when);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, cfg.f1), when + cfg.dur);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(peak, when + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, when + cfg.dur);
  osc.connect(g);
  A.synthVoices++;
  osc.onended = () => {
    A.synthVoices--;
    safe(() => g.disconnect());
  };
  osc.start(when);
  osc.stop(when + cfg.dur + 0.05);
}

function playSample(name, def, opts) {
  const file = pickVariant(name, def);
  if (!file) return;
  const buf = A.buffers.get(file);
  if (!buf) return;
  if (A.voices >= A.manifest.master.voiceCap) return;

  const ctx = A.ctx;
  const when = now() + Math.max(0, (opts && opts.delay) || 0);
  const jitter = def.jitter === undefined ? 0.12 : def.jitter;
  const varied = 1 + (rnd() - 0.5) * 2 * jitter;
  const level = Math.max(0.0001, (def.gain || 0.5) * varied * ((opts && opts.gain) || 1));
  const rate = (opts && opts.rate) || pickRate(name, def);

  const g = makeVoiceOut(def.bus || 'sfx', def.send || 0, panFor(opts));
  g.gain.value = level;

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  src.connect(g);
  A.voices++;
  src.onended = () => {
    A.voices--;
    safe(() => src.disconnect());
    safe(() => g.disconnect());
  };
  src.start(when);

  if (def.accent) playAccent(def.accent, when, panFor(opts), varied * ((opts && opts.gain) || 1));
}

function bell(freq, when, gainScale, pan, decayScale) {
  const ctx = A.ctx;
  const cfg = A.manifest.synth.bell;
  if (A.synthVoices > A.manifest.master.synthCap) return;

  const out = makeVoiceOut('tone', cfg.send, pan);
  out.gain.value = 1;

  const base = cfg.gain * gainScale;
  const ds = decayScale || 1;
  let longest = 0;

  for (let i = 0; i < cfg.partials.length; i++) {
    const f = freq * cfg.partials[i];
    if (f > 15000) continue;
    const dur = cfg.decays[i] * ds;
    longest = Math.max(longest, dur);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    osc.detune.value = (rnd() - 0.5) * 6;
    const g = ctx.createGain();
    const peak = Math.max(0.0001, base * cfg.levels[i]);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(peak, when + 0.006 + i * 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g);
    g.connect(out);
    A.synthVoices++;
    osc.onended = () => {
      A.synthVoices--;
      safe(() => g.disconnect());
    };
    osc.start(when);
    osc.stop(when + dur + 0.05);
  }

  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = freq * 0.5;
  const subG = ctx.createGain();
  subG.gain.setValueAtTime(0.0001, when);
  subG.gain.exponentialRampToValueAtTime(Math.max(0.0001, base * cfg.subGain), when + 0.02);
  subG.gain.exponentialRampToValueAtTime(0.0001, when + 1.1 * ds);
  sub.connect(subG);
  subG.connect(out);
  sub.start(when);
  sub.stop(when + 1.2 * ds);
  sub.onended = () => safe(() => subG.disconnect());

  const strike = ctx.createBufferSource();
  strike.buffer = A.nodes.white;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = Math.min(12000, freq * 4);
  bp.Q.value = 2.2;
  const sg = ctx.createGain();
  sg.gain.setValueAtTime(Math.max(0.0001, base * cfg.strikeGain), when);
  sg.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  strike.connect(bp);
  bp.connect(sg);
  sg.connect(out);
  strike.start(when, rnd() * 0.5, 0.08);
  strike.onended = () => {
    safe(() => sg.disconnect());
    safe(() => bp.disconnect());
  };

  setTimeout(() => safe(() => out.disconnect()), (longest + 0.6) * 1000 + 200);
}

function sparkle(when, pan) {
  const ctx = A.ctx;
  const cfg = A.manifest.synth.sparkle;
  const scale = A.manifest.synth.sparkleScale;
  for (let i = 0; i < cfg.count; i++) {
    if (A.synthVoices > A.manifest.master.synthCap) break;
    const t = when + (i / cfg.count) * cfg.spread + rnd() * 0.02;
    const f = scale[Math.min(scale.length - 1, Math.floor((i / cfg.count) * scale.length + rnd() * 1.4))];
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const g = makeVoiceOut('tone', cfg.send, clamp(pan + (rnd() - 0.5) * 0.7, -1, 1));
    const peak = Math.max(0.0001, cfg.gain * (1 - i / (cfg.count * 1.6)));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + cfg.dur);
    osc.connect(g);
    A.synthVoices++;
    osc.onended = () => {
      A.synthVoices--;
      safe(() => g.disconnect());
    };
    osc.start(t);
    osc.stop(t + cfg.dur + 0.03);
  }
}

function ensureContext() {
  if (A.ctx) return true;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return false;
  const ctx = safe(() => new Ctor({ latencyHint: 'interactive' })) || safe(() => new Ctor());
  if (!ctx) return false;
  A.ctx = ctx;
  return true;
}

async function build() {
  if (A.ready || A.building) return;
  A.building = true;
  try {
    if (!ensureContext()) return;
    resumeContext();
    if (A.fetching) await A.fetching;
    buildGraph();
    const jobs = [];
    for (const [file, data] of A.raw) {
      jobs.push(
        decodeBuffer(A.ctx, data)
          .then((buf) => {
            A.buffers.set(file, buf);
          })
          .catch(() => {})
      );
    }
    A.raw.clear();
    await Promise.all(jobs);
    A.ready = true;
    applyHum(true);
  } catch (e) {
    A.ready = false;
  } finally {
    A.building = false;
  }
}

function resumeContext() {
  if (!A.ctx) return;
  if (A.ctx.state !== 'running') safe(() => A.ctx.resume());
}

function onGesture() {
  if (A.muted) {
    if (!A.ctx) return;
    resumeContext();
    return;
  }
  if (!A.ctx) {
    build().then(resumeContext);
  } else {
    resumeContext();
  }
}

function listen() {
  if (A.listening) return;
  A.listening = true;
  const evts = ['pointerdown', 'touchend', 'mousedown', 'keydown'];
  for (const e of evts) window.addEventListener(e, onGesture, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !A.muted) resumeContext();
  });
}

function syncWithState() {
  if (A.stateSynced) return;
  A.stateSynced = true;
  import('./state.js')
    .then((mod) => {
      if (!mod || typeof mod.on !== 'function' || !mod.state) return;
      const read = () => {
        const s = mod.state.sound;
        if (typeof s === 'boolean' && s === A.muted) setMuted(!s);
      };
      mod.on('change', read);
      read();
    })
    .catch(() => {});
}

function applyMasterGain(fade) {
  const n = A.nodes;
  if (!n) return;
  const target = A.muted ? 0.0001 : A.manifest.master.gain * A.volume;
  const t = now();
  const dur = fade === undefined ? A.manifest.master.fade : fade;
  safe(() => {
    n.master.gain.cancelScheduledValues(t);
    n.master.gain.setValueAtTime(Math.max(0.0001, n.master.gain.value), t);
    n.master.gain.linearRampToValueAtTime(Math.max(0.0001, target), t + Math.max(0.01, dur));
  });
  if (A.suspendTimer) {
    clearTimeout(A.suspendTimer);
    A.suspendTimer = 0;
  }
  if (A.muted) {
    A.suspendTimer = setTimeout(() => {
      A.suspendTimer = 0;
      if (A.muted && A.ctx && A.ctx.state === 'running') safe(() => A.ctx.suspend());
    }, (dur + 0.3) * 1000);
  } else {
    resumeContext();
  }
}

export function init(opts) {
  const options = opts || {};
  A.muted = options.muted !== undefined ? !!options.muted : readStoredMute();
  if (options.volume !== undefined) A.volume = clamp(options.volume, 0, 1);
  if (!A.fetching) {
    A.fetching = loadManifest()
      .then(fetchSamples)
      .catch(() => {});
  }
  listen();
  syncWithState();
  return A.fetching;
}

export function unlock() {
  onGesture();
}

export function isReady() {
  return A.ready && !!A.ctx && A.ctx.state === 'running';
}

export function play(name, opts) {
  if (A.muted) return;
  if (!A.ready) {
    onGesture();
    return;
  }
  const key = resolveName(name);
  if (!key) return;
  const def = A.manifest.sounds[key];
  const o = opts || {};
  if (cooldownBlocked(key, def, o.cooldown)) return;
  safe(() => {
    if (def.synth === 'tick') {
      tickVoice(o.angle || 0, (def.gain || 1) * (o.gain || 1), panFor(o));
    } else if (def.synth === 'bell') {
      chimeVoice(o.index || 0, o);
    } else if (def.synth === 'solve') {
      solveVoice(o);
    } else {
      playSample(key, def, o);
    }
  });
}

export function stop() {
  const n = A.nodes;
  if (!n) return;
  const t = now();
  safe(() => {
    n.master.gain.cancelScheduledValues(t);
    n.master.gain.setValueAtTime(Math.max(0.0001, n.master.gain.value), t);
    n.master.gain.linearRampToValueAtTime(0.0001, t + 0.04);
  });
  if (!A.muted) setTimeout(() => applyMasterGain(0.25), 80);
}

export function setBeamEnergy(x, litCount) {
  const v = typeof x === 'number' && isFinite(x) ? clamp(x, 0, 1) : 0;
  A.energyTarget = v;
  if (typeof litCount === 'number') A.litTarget = clamp(litCount, 0, 3);
  if (!A.ready || A.muted) return;
  safe(() => applyHum(false));
}

export function setLitCount(n) {
  A.litTarget = clamp(typeof n === 'number' ? n : 0, 0, 3);
  if (!A.ready || A.muted) return;
  safe(() => applyHum(false));
}

function tickVoice(angle, gainScale, pan) {
  const ctx = A.ctx;
  const cfg = A.manifest.synth.tick;
  if (A.synthVoices > A.manifest.master.synthCap * 0.5) return;
  const tau = Math.PI * 2;
  const norm = (((angle % tau) + tau) % tau) / tau;
  let hz = cfg.baseHz * Math.pow(2, norm * cfg.octaves);
  if (Math.abs(hz - A.lastTickHz) < 1) hz *= 1 + (rnd() - 0.5) * 0.04;
  A.lastTickHz = hz;

  const when = now();
  const dur = cfg.dur;
  const out = makeVoiceOut('sfx', cfg.send, pan);
  out.gain.value = 1;

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(hz, when);
  osc.frequency.exponentialRampToValueAtTime(hz * 0.82, when + dur);
  const g = ctx.createGain();
  const peak = Math.max(0.0001, cfg.gain * gainScale * (0.85 + rnd() * 0.3));
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(peak, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(g);
  g.connect(out);
  A.synthVoices++;
  osc.onended = () => {
    A.synthVoices--;
    safe(() => g.disconnect());
    safe(() => out.disconnect());
  };
  osc.start(when);
  osc.stop(when + dur + 0.02);

  const n = ctx.createBufferSource();
  n.buffer = A.nodes.white;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = Math.min(9000, hz * 2.2);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(Math.max(0.0001, cfg.noiseGain * gainScale), when);
  ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.012);
  n.connect(hp);
  hp.connect(ng);
  ng.connect(out);
  n.start(when, rnd() * 0.5, 0.02);
  n.onended = () => {
    safe(() => ng.disconnect());
    safe(() => hp.disconnect());
  };
}

export function rotateTick(angle, opts) {
  if (A.muted || !A.ready) return;
  const def = A.manifest.sounds.rotate_tick || { gain: 0.3, cooldown: 22 };
  const o = opts || {};
  if (cooldownBlocked('rotate_tick', def, o.cooldown)) return;
  safe(() => tickVoice(angle || 0, (def.gain || 1) * (o.gain || 1), panFor(o)));
}

function chimeVoice(index, opts) {
  const chord = A.manifest.synth.chord;
  const f = chord[((index | 0) % chord.length + chord.length) % chord.length];
  const pan = panFor(opts);
  const g = (opts && opts.gain) || 1;
  const when = now() + 0.005;
  bell(f, when, g, pan, 1);
  bell(f * 2, when + 0.012, g * 0.22, pan, 0.55);
  const def = A.manifest.sounds.receptor;
  if (def && A.buffers.size) playSample('receptor', def, { gain: 0.8 * g, pan });
}

export function receptorChime(index, opts) {
  if (A.muted || !A.ready) return;
  const def = A.manifest.sounds.receptor_chime || { cooldown: 60 };
  const o = opts || {};
  if (cooldownBlocked('receptor_chime_' + (index | 0), def, o.cooldown)) return;
  safe(() => chimeVoice(index | 0, o));
}

function solveVoice(opts) {
  const s = A.manifest.synth;
  const g = (opts && opts.gain) || 1;
  const pan = panFor(opts);
  const t0 = now() + 0.01;
  for (let i = 0; i < s.solveChord.length; i++) {
    const off = s.solveStagger[i] === undefined ? i * 0.06 : s.solveStagger[i];
    const level = g * (i === 0 ? 0.7 : 1 - i * 0.08);
    bell(s.solveChord[i], t0 + off, level, clamp(pan + (i - 2.5) * 0.09, -1, 1), 1.35);
  }
  sparkle(t0 + 0.22, pan);
  const swell = A.manifest.sounds.solve_swell;
  if (swell) playSample('solve_swell', swell, { gain: g, pan, delay: 0.02 });
}

export function solve(opts) {
  if (A.muted || !A.ready) return;
  const def = A.manifest.sounds.solve || { cooldown: 1400 };
  const o = opts || {};
  if (cooldownBlocked('solve', def, o.cooldown)) return;
  safe(() => solveVoice(o));
}

export function setMuted(muted) {
  const next = !!muted;
  if (next === A.muted && A.nodes) return;
  A.muted = next;
  writeStoredMute(next);
  if (!next && !A.ctx) {
    build().then(() => {
      applyMasterGain();
      resumeContext();
    });
    return;
  }
  applyMasterGain();
}

export function getMuted() {
  return A.muted;
}

export function toggleMuted() {
  setMuted(!A.muted);
  return A.muted;
}

export function setMasterVolume(v) {
  A.volume = clamp(typeof v === 'number' ? v : 1, 0, 1);
  applyMasterGain(0.08);
}

export function dispose() {
  if (A.suspendTimer) clearTimeout(A.suspendTimer);
  A.suspendTimer = 0;
  if (A.ctx) safe(() => A.ctx.close());
  A.ctx = null;
  A.nodes = null;
  A.ready = false;
  A.buffers.clear();
}

export default {
  init,
  unlock,
  play,
  stop,
  setBeamEnergy,
  setLitCount,
  rotateTick,
  receptorChime,
  solve,
  setMuted,
  getMuted,
  toggleMuted,
  setMasterVolume,
  isReady,
  dispose,
};
