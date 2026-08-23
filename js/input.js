// Pointer, touch, wheel and keyboard handling: raw events become intents against js/state.js, in board units.

import { pixelToBoard } from './render/gl.js';
import { rotateTick, haptic } from './audio.js';
import {
  state,
  addOptic,
  removeOptic,
  moveOptic,
  rotateOptic,
  selectOptic,
  setDragging,
  setCursor,
  undo,
  redo,
  reset,
  emit,
  remaining,
  getOptic,
} from './state.js';

const BOARD = 1000;
const WALL = 40;
const PLACE_SNAP = 25;
// The drawn protractor orbit. js/render/board.js draws the handle dot at its own RING_R = 67,
// so this must stay 67 or the mouse target stops sitting on the thing the player can see.
const RING_RADIUS = 67;
const HANDLE_GRAB = 26;
// A finger is not a mouse. At the measured mobile board scale of 0.2958 px/unit a 44 px
// Apple-HIG target is 148.8 units across, i.e. a 74-unit radius. A 74-unit circle centred on
// the drawn handle would reach 7 units past the optic's own centre and swallow every body
// drag, so the coarse circle is centred 95 units out instead — outward of the handle, away
// from the 55-unit mirror body. Around the handle dot that leaves 30.2 px of reach outward,
// 13.6 px inward and 20.3 px either side: a 43.8 x 40.6 px target on the visible affordance,
// against 28 px before. Landing ON 44, not past it.
const HANDLE_GRAB_COARSE = 74;
const HANDLE_CENTRE_COARSE = 95;
const WALL_CLEARANCE = 16;
const BODY_RADIUS = { mirror: 55, prism: 43 };
const GRAB_RADIUS = { mirror: 62, prism: 50 };
const OVERLAP_FACTOR = 0.6;
const MAGNET_DEG = 4;
// js/ui/hud.js arms a tile when a finger travels TAP_SLOP = 8 px or less. Anything further is
// a drag and belongs to us, so the two thresholds are deliberately the same number: there is
// no gap between them where a gesture does nothing at all.
const DOCK_DRAG_SLOP = 8;
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 8;

function radiusOf(type) {
  return BODY_RADIUS[type] || 45;
}

function grabOf(type) {
  return GRAB_RADIUS[type] || 50;
}

function circleHitsRect(cx, cy, r, rx, ry, rw, rh) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

export function isValidPlacement(type, x, y, ignoreId) {
  const level = state.level;
  if (!level) return false;
  const clear = WALL_CLEARANCE;
  if (x < WALL + clear || x > BOARD - WALL - clear) return false;
  if (y < WALL + clear || y > BOARD - WALL - clear) return false;
  for (const w of level.walls || []) {
    if (circleHitsRect(x, y, clear, w.x, w.y, w.w, w.h)) return false;
  }
  const r = radiusOf(type);
  for (const o of state.optics) {
    if (o.id === ignoreId) continue;
    const min = (r + radiusOf(o.type)) * OVERLAP_FACTOR;
    const dx = o.x - x;
    const dy = o.y - y;
    if (dx * dx + dy * dy < min * min) return false;
  }
  for (const rec of level.receptors || []) {
    const dx = rec.x - x;
    const dy = rec.y - y;
    if (dx * dx + dy * dy < 55 * 55) return false;
  }
  const em = level.emitter;
  if (em) {
    const dx = em.x - x;
    const dy = em.y - y;
    if (dx * dx + dy * dy < 55 * 55) return false;
  }
  return true;
}

function snapPos(v, free) {
  if (free) return Math.round(v * 10) / 10;
  return Math.round(v / PLACE_SNAP) * PLACE_SNAP;
}

export function snapAngle(a, free) {
  if (free) return a;
  let deg = (a * 180) / Math.PI;
  deg = ((deg % 360) + 360) % 360;
  const near15 = Math.round(deg / 15) * 15;
  let out;
  if (Math.abs(deg - near15) <= MAGNET_DEG || Math.abs(deg - near15) >= 360 - MAGNET_DEG) {
    out = near15;
  } else {
    out = Math.round(deg / 5) * 5;
  }
  return (out * Math.PI) / 180;
}

// Rotation is quantised to 5 degrees with a magnet at every 15, but the protractor ring is
// contractually forbidden from drawing degree ticks (ARCHITECTURE.md 11.4). The grid is
// therefore invisible, so it has to be audible and — on a phone — palpable instead.
const MAGNET_STEP_DEG = 15;
// Short enough that a fast flick still ticks once per 5-degree detent; long enough that a
// jittering pointer sitting on one detent cannot machine-gun the voice.
const DETENT_COOLDOWN_MS = 10;
const ACCENT_GAIN = 2;
const ACCENT_SEMITONES = 3;

function degOf(angle) {
  const d = ((((angle * 180) / Math.PI) % 360) + 360) % 360;
  return Math.round(d * 100) / 100;
}

function onMagnet(deg) {
  const k = deg / MAGNET_STEP_DEG;
  return Math.abs(k - Math.round(k)) < 0.02;
}

// One tick per crossed detent; the 15-degree magnets get a louder, higher accent so the
// magnet reads as magnetic rather than as an arbitrary stutter in the 5-degree stepping.
function detentFeedback(optic, deg, pointerType) {
  const magnet = onMagnet(deg);
  rotateTick(optic.angle, {
    gain: magnet ? ACCENT_GAIN : 1,
    semitones: magnet ? ACCENT_SEMITONES : 0,
    panX: optic.x,
    cooldown: magnet ? 0 : DETENT_COOLDOWN_MS,
  });
  if (pointerType === 'touch' || pointerType === 'pen') haptic(magnet ? 'detentAccent' : 'detent');
}

function opticAt(x, y) {
  let best = null;
  let bestDist = Infinity;
  for (const o of state.optics) {
    if (o.fixed) continue;
    const g = grabOf(o.type);
    const dx = o.x - x;
    const dy = o.y - y;
    const d = dx * dx + dy * dy;
    if (d < g * g && d < bestDist) {
      bestDist = d;
      best = o;
    }
  }
  return best;
}

function handleAt(x, y, coarse) {
  const id = state.selectedId;
  if (!id) return false;
  const o = getOptic(id);
  if (!o || o.fixed) return false;
  const orbit = coarse ? HANDLE_CENTRE_COARSE : RING_RADIUS;
  const hx = o.x + Math.cos(o.angle) * orbit;
  const hy = o.y - Math.sin(o.angle) * orbit;
  const dx = hx - x;
  const dy = hy - y;
  const r = coarse ? HANDLE_GRAB_COARSE : HANDLE_GRAB;
  return dx * dx + dy * dy < r * r;
}

function angleFromCentre(o, x, y) {
  return Math.atan2(-(y - o.y), x - o.x);
}

export function createInput(canvas, opts = {}) {
  const dock = opts.dock || document;
  let active = null;
  let shift = false;
  let enabled = true;
  let lastTapTime = 0;
  // A finger that starts on a dock tile: hud.js gets the tap, we get the drag.
  let dockTouch = null;
  let press = null;
  let pressTimer = 0;

  canvas.style.touchAction = 'none';

  function toBoard(ev) {
    const rect = canvas.getBoundingClientRect();
    return pixelToBoard(ev.clientX - rect.left, ev.clientY - rect.top);
  }

  function cursorStyle(x, y) {
    if (active) return active.kind === 'rotate' ? 'point' : 'closed';
    if (handleAt(x, y)) return 'point';
    if (opticAt(x, y)) return 'open';
    return 'arrow';
  }

  function updateHover(x, y) {
    setCursor(x, y, cursorStyle(x, y));
  }

  function beginPlace(type, ev) {
    if (remaining(type) <= 0) {
      emit('invalid', { reason: 'inventory', type });
      return;
    }
    const p = toBoard(ev);
    const x = snapPos(p.x, shift);
    const y = snapPos(p.y, shift);
    active = {
      kind: 'place',
      pointerId: ev.pointerId,
      type,
      angle: type === 'prism' ? 0 : Math.PI / 4,
      moved: false,
    };
    setDragging({
      kind: 'place',
      id: null,
      type,
      x,
      y,
      angle: active.angle,
      valid: isValidPlacement(type, x, y, null),
    });
    setCursor(p.x, p.y, 'closed');
    emit('drag:start', state.dragging);
  }

  function beginMove(optic, p, ev) {
    active = {
      kind: 'move',
      pointerId: ev.pointerId,
      id: optic.id,
      offx: optic.x - p.x,
      offy: optic.y - p.y,
      startX: optic.x,
      startY: optic.y,
      moved: false,
    };
    setDragging({
      kind: 'move',
      id: optic.id,
      type: optic.type,
      x: optic.x,
      y: optic.y,
      angle: optic.angle,
      valid: true,
    });
    emit('drag:start', state.dragging);
  }

  function beginRotate(optic, ev) {
    active = {
      kind: 'rotate',
      pointerId: ev.pointerId,
      id: optic.id,
      moved: false,
      lastDeg: degOf(optic.angle),
    };
    setDragging({
      kind: 'rotate',
      id: optic.id,
      type: optic.type,
      x: optic.x,
      y: optic.y,
      angle: optic.angle,
      valid: true,
    });
    emit('drag:start', state.dragging);
  }

  /* ---------- long press ---------- */

  // With no UNDO chip in the HUD and no keyboard, a thumb's only way to take one piece back
  // used to be RESET, which wipes the whole board. Half a second of stillness on a placed
  // optic removes exactly that optic.
  function cancelPress() {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = 0;
    press = null;
  }

  function armPress(optic, ev) {
    cancelPress();
    press = { id: optic.id, x: ev.clientX, y: ev.clientY, pointerId: ev.pointerId };
    pressTimer = setTimeout(() => {
      pressTimer = 0;
      const id = press && press.id;
      press = null;
      const o = id ? getOptic(id) : null;
      if (!o || o.fixed) return;
      if (active) {
        if (active.kind === 'move') moveOptic(active.id, active.startX, active.startY);
        active = null;
        setDragging(null);
        emit('drag:end', 'cancel');
      }
      // No buzz here: removeOptic emits optic:remove and js/main.js answers it.
      removeOptic(id);
    }, LONG_PRESS_MS);
  }

  function pressMoved(ev) {
    if (!press || ev.pointerId !== press.pointerId) return;
    if (Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > LONG_PRESS_SLOP) cancelPress();
  }

  function onPointerDown(ev) {
    if (!enabled || active) return;
    if (ev.pointerType === 'mouse' && ev.button === 2) return;
    const tile = ev.target.closest
      ? ev.target.closest('[data-optic],[data-optic-type],.dock-tile')
      : null;
    if (tile) {
      const type = tile.dataset.optic || tile.dataset.opticType || tile.dataset.type;
      if (!type) return;
      if (ev.cancelable) ev.preventDefault();
      capture(ev, tile);
      beginPlace(type, ev);
      return;
    }
    if (ev.target !== canvas) return;
    if (ev.cancelable) ev.preventDefault();
    const p = toBoard(ev);
    capture(ev, canvas);
    if (handleAt(p.x, p.y, ev.pointerType !== 'mouse')) {
      beginRotate(getOptic(state.selectedId), ev);
      return;
    }
    const hit = opticAt(p.x, p.y);
    if (hit) {
      selectOptic(hit.id);
      const now = performance.now();
      if (ev.pointerType !== 'mouse' && now - lastTapTime < 320) {
        lastTapTime = 0;
        beginRotate(hit, ev);
        return;
      }
      lastTapTime = now;
      beginMove(hit, p, ev);
      if (ev.pointerType !== 'mouse') armPress(hit, ev);
      return;
    }
    selectOptic(null);
    updateHover(p.x, p.y);
  }

  function capture(ev, el) {
    try {
      el.setPointerCapture(ev.pointerId);
    } catch (err) {
      void err;
    }
  }

  function release(ev, el) {
    try {
      el.releasePointerCapture(ev.pointerId);
    } catch (err) {
      void err;
    }
  }

  function updatePlace(ev, p) {
    const x = snapPos(p.x, ev.shiftKey || shift);
    const y = snapPos(p.y, ev.shiftKey || shift);
    const d = state.dragging;
    if (!d) return;
    d.x = x;
    d.y = y;
    d.valid = isValidPlacement(active.type, x, y, null);
    setDragging(d);
    setCursor(p.x, p.y, 'closed');
  }

  function onPointerMove(ev) {
    if (!enabled) return;
    pressMoved(ev);
    const p = toBoard(ev);
    if (!active) {
      updateHover(p.x, p.y);
      return;
    }
    if (ev.pointerId !== active.pointerId) return;
    if (active.viaDock) return;
    if (ev.cancelable) ev.preventDefault();
    active.moved = true;
    if (active.kind === 'place') {
      updatePlace(ev, p);
      return;
    }
    const optic = getOptic(active.id);
    if (!optic) {
      active = null;
      setDragging(null);
      return;
    }
    if (active.kind === 'move') {
      const x = snapPos(p.x + active.offx, ev.shiftKey || shift);
      const y = snapPos(p.y + active.offy, ev.shiftKey || shift);
      const valid = isValidPlacement(optic.type, x, y, optic.id);
      const d = state.dragging;
      d.x = x;
      d.y = y;
      d.valid = valid;
      if (valid) moveOptic(optic.id, x, y);
      setDragging(d);
      setCursor(p.x, p.y, 'closed');
      return;
    }
    if (active.kind === 'rotate') {
      const raw = angleFromCentre(optic, p.x, p.y);
      rotateOptic(optic.id, snapAngle(raw, ev.shiftKey || shift));
      const deg = degOf(optic.angle);
      if (deg !== active.lastDeg) {
        active.lastDeg = deg;
        detentFeedback(optic, deg, ev.pointerType);
      }
      const d = state.dragging;
      d.angle = optic.angle;
      setDragging(d);
      setCursor(p.x, p.y, 'point');
    }
  }

  function commitUp(ev) {
    const p = toBoard(ev);
    const drag = state.dragging;
    if (active.kind === 'place' && drag) {
      if (drag.valid) {
        const id = addOptic({ type: drag.type, x: drag.x, y: drag.y, angle: drag.angle });
        if (id) selectOptic(id);
      } else {
        emit('invalid', { reason: 'placement', type: drag.type });
      }
    } else if (active.kind === 'move' && drag && !drag.valid) {
      moveOptic(active.id, active.startX, active.startY);
      emit('invalid', { reason: 'placement', type: drag.type });
    }
    const kind = active.kind;
    active = null;
    setDragging(null);
    emit('drag:end', kind);
    updateHover(p.x, p.y);
  }

  function onPointerUp(ev) {
    cancelPress();
    if (!active || ev.pointerId !== active.pointerId) return;
    if (active.viaDock) return;
    commitUp(ev);
    release(ev, ev.target);
  }

  function onPointerCancel(ev) {
    cancelPress();
    dockTouch = null;
    if (!active || ev.pointerId !== active.pointerId) return;
    if (active.kind === 'move') moveOptic(active.id, active.startX, active.startY);
    active = null;
    setDragging(null);
    emit('drag:end', 'cancel');
  }

  /* ---------- dock drag on a coarse pointer ---------- */

  /* js/ui/hud.js stops coarse pointers at the dock in the capture phase so a thumb gets
     tap-then-tap instead of a ghost hidden under itself. That is right for a tap and wrong
     for a drag: the game's own default hint says DRAG A PIECE ONTO THE BOARD, and until now
     a finger doing exactly that produced nothing at all. These three run on window, which is
     upstream of hud's dock listener in the capture phase, so a finger that leaves the tile
     still gets a real drag — ghost included — while a finger that stays still falls through
     to hud and arms the tile as before. */

  function onCaptureDown(ev) {
    if (!enabled || active || ev.pointerType === 'mouse') return;
    const tile = ev.target && ev.target.closest ? ev.target.closest('.dock-tile') : null;
    if (!tile) return;
    const type = tile.dataset.optic || tile.dataset.opticType || tile.dataset.type;
    if (!type || remaining(type) <= 0) return;
    dockTouch = { pointerId: ev.pointerId, type, x: ev.clientX, y: ev.clientY, started: false };
  }

  function onCaptureMove(ev) {
    if (!dockTouch || ev.pointerId !== dockTouch.pointerId) return;
    if (!dockTouch.started) {
      if (Math.hypot(ev.clientX - dockTouch.x, ev.clientY - dockTouch.y) <= DOCK_DRAG_SLOP) return;
      if (active) {
        dockTouch = null;
        return;
      }
      beginPlace(dockTouch.type, ev);
      if (!active) {
        dockTouch = null;
        return;
      }
      active.viaDock = true;
      dockTouch.started = true;
      haptic('pick');
    }
    if (!active) return;
    active.moved = true;
    ev.stopPropagation();
    if (ev.cancelable) ev.preventDefault();
    updatePlace(ev, toBoard(ev));
  }

  function onCaptureUp(ev) {
    if (!dockTouch || ev.pointerId !== dockTouch.pointerId) return;
    const started = dockTouch.started;
    dockTouch = null;
    if (!started || !active || !active.viaDock) return;
    ev.stopPropagation();
    // No haptic here: commitUp either lands an optic:add or emits 'invalid', and js/main.js
    // answers both. Buzzing here as well would double every drop.
    commitUp(ev);
  }

  function onCaptureCancel(ev) {
    if (!dockTouch || ev.pointerId !== dockTouch.pointerId) return;
    const started = dockTouch.started;
    dockTouch = null;
    if (started && active && active.viaDock) {
      active = null;
      setDragging(null);
      emit('drag:end', 'cancel');
    }
  }

  function onWheel(ev) {
    if (!enabled || !state.selectedId) return;
    const p = toBoard(ev);
    const optic = getOptic(state.selectedId);
    if (!optic || optic.fixed) return;
    const g = grabOf(optic.type) + RING_RADIUS;
    const dx = optic.x - p.x;
    const dy = optic.y - p.y;
    if (dx * dx + dy * dy > g * g) return;
    ev.preventDefault();
    const dir = ev.deltaY > 0 ? -1 : 1;
    const stepDeg = ev.shiftKey ? 1 : 5;
    const deg = (optic.angle * 180) / Math.PI + dir * stepDeg;
    if (rotateOptic(optic.id, (deg * Math.PI) / 180)) {
      detentFeedback(optic, degOf(optic.angle), 'mouse');
    }
  }

  function onContextMenu(ev) {
    if (!enabled) return;
    ev.preventDefault();
    const p = toBoard(ev);
    const hit = opticAt(p.x, p.y) || (state.selectedId ? getOptic(state.selectedId) : null);
    if (hit && !hit.fixed) removeOptic(hit.id);
  }

  function typingTarget(ev) {
    const t = ev.target;
    if (!t || !t.tagName) return false;
    const tag = t.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || t.isContentEditable;
  }

  function onKeyDown(ev) {
    if (ev.key === 'Shift') shift = true;
    if (!enabled || typingTarget(ev)) return;
    const mod = ev.metaKey || ev.ctrlKey;
    const key = ev.key.toLowerCase();
    if (mod && key === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && key === 'y') {
      ev.preventDefault();
      redo();
      return;
    }
    if (key === 'escape') {
      ev.preventDefault();
      selectOptic(null);
      return;
    }
    if (key === 'backspace' || key === 'delete') {
      if (state.selectedId) {
        ev.preventDefault();
        removeOptic(state.selectedId);
      }
      return;
    }
    if (key === 'r' && !mod) {
      ev.preventDefault();
      reset();
      return;
    }
    if (key === 'arrowleft' || key === 'arrowright') {
      const optic = state.selectedId ? getOptic(state.selectedId) : null;
      if (!optic || optic.fixed) return;
      ev.preventDefault();
      const step = ev.shiftKey ? 1 : 5;
      const deg = (optic.angle * 180) / Math.PI + (key === 'arrowleft' ? step : -step);
      if (rotateOptic(optic.id, (deg * Math.PI) / 180)) {
        detentFeedback(optic, degOf(optic.angle), 'key');
      }
    }
  }

  function onKeyUp(ev) {
    if (ev.key === 'Shift') shift = false;
  }

  function onGesture(ev) {
    ev.preventDefault();
  }

  const target = dock === document ? document : dock;
  window.addEventListener('pointerdown', onCaptureDown, { capture: true, passive: true });
  window.addEventListener('pointermove', onCaptureMove, { capture: true, passive: false });
  window.addEventListener('pointerup', onCaptureUp, { capture: true, passive: false });
  window.addEventListener('pointercancel', onCaptureCancel, { capture: true, passive: true });
  target.addEventListener('pointerdown', onPointerDown, { passive: false });
  if (target !== document) canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  document.addEventListener('gesturestart', onGesture);

  return {
    setEnabled(v) {
      enabled = !!v;
      if (!enabled && active) {
        active = null;
        setDragging(null);
      }
      if (!enabled) {
        cancelPress();
        dockTouch = null;
      }
    },
    isDragging() {
      return !!active;
    },
    dispose() {
      cancelPress();
      window.removeEventListener('pointerdown', onCaptureDown, true);
      window.removeEventListener('pointermove', onCaptureMove, true);
      window.removeEventListener('pointerup', onCaptureUp, true);
      window.removeEventListener('pointercancel', onCaptureCancel, true);
      target.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('gesturestart', onGesture);
    },
  };
}
