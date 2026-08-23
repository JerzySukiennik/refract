// Capture scenes for the blind quality comparison.
//
// IMPORTANT: these run on OUR OWN levels. Refract is not a clone of the reference
// footage — see docs/ORCHESTRATOR-NOTES.md section 8. Scenes are matched to reference
// frames by KIND, not by layout: a long straight beam is compared against a long
// straight beam, a dispersion fan against a dispersion fan, and so on. The critic is
// asked which panel is the polished commercial game, not which panel is the same frame.
//
// `ops` are driven through window.REFRACT (docs/ARCHITECTURE.md section 9). They are
// CALIBRATED against the real levels by the capture agent each round — if a level's
// geometry changes and a scene stops showing what it is supposed to show, fix the ops
// here rather than reverting the level.

export const SCENES = {
  // A clean, untouched level: the emitter and one long unobstructed beam run.
  // Tests: beam core profile, chiral warm/cool fringe, grain, bloom, emitter mouth.
  fresh: {
    ref: 'ref_001.jpg',
    kind: 'A loaded level with a single long straight beam and nothing placed yet.',
    note: 'Beam core, shoulders, fringe chirality and bloom on a long clean run.',
    ops: [{ level: 0 }],
  },

  // Same, cropped hard onto the beam itself.
  beamDetail: {
    ref: 'ref_001.jpg',
    kind: 'Tight crop on the emitter and a long white beam.',
    note: 'Cross-section profile is the whole test. Core width, shoulder falloff, fringe.',
    crop: { x: 0.08, y: 0.08, w: 0.62, h: 0.24 },
    ops: [{ level: 0 }],
  },

  // Several mirrors folding the beam through the maze.
  // Tests: reflections, hot spots at mirror faces, wall light spill, mirror sprites.
  folding: {
    ref: 'ref_010.jpg',
    kind: 'Beam folded several times by mirrors, one mirror selected mid-rotation.',
    note: 'Reflection hot spots, mirror sprite, wall glow, protractor in context.',
    ops: [{ scripted: 'folding' }],
  },

  // A prism throwing a full dispersed fan.
  // Tests: hue order, angular spread, continuity, Fresnel residuals, glass body.
  dispersion: {
    ref: 'ref_030.jpg',
    kind: 'A prism in the beam throwing a full rainbow fan across open board.',
    note: 'The signature shot. Fan width, smoothness, hue order, prism glass.',
    ops: [{ scripted: 'dispersion' }],
  },

  // Same, cropped onto the fan.
  fanDetail: {
    ref: 'ref_030.jpg',
    kind: 'Tight crop on a prism and its fan.',
    note: 'Banding is the failure mode. Must read as one continuous wedge.',
    // Recalibrated: the prism on SWITCHBACK sits at ~0.32, 0.51 of the frame and throws
    // its fan up and to the right, so the old lower-left crop framed empty board.
    crop: { x: 0.24, y: 0.09, w: 0.48, h: 0.47 },
    ops: [{ scripted: 'dispersion' }],
  },

  // The selection protractor at high zoom.
  protractor: {
    ref: 'ref_010.jpg',
    kind: 'A selected optic with its protractor ring, handle and angle readout.',
    note: 'Ring radius, stroke, opacity, ticks, handle dot, readout typography.',
    // The scripted optic sits at board (500,500), i.e. the centre of the board, which lands
    // near the middle of the frame -- not at its left. The old window stopped at x=0.48 and
    // sliced the ring off at the crop's right edge, so the one scene whose whole job is to
    // show the protractor never actually showed it. Centred on the optic instead.
    crop: { x: 0.28, y: 0.31, w: 0.42, h: 0.34 },
    ops: [{ scripted: 'protractor' }],
  },

  // All three receptors satisfied, board still visible.
  solvedBoard: {
    ref: 'ref_034.jpg',
    kind: 'All three receptors receiving their colour, before any overlay.',
    note: 'Receptor lit state, flags, colour spill onto the board.',
    ops: [{ scripted: 'solved' }],
  },

  // The solve overlay.
  solvedModal: {
    ref: 'ref_038.jpg',
    kind: 'The solve panel over a dimmed board.',
    note: 'Panel typography, dim amount, panel border, button treatment.',
    ops: [{ scripted: 'solved' }, { modal: 'solved' }],
  },

  // Chrome only.
  hud: {
    ref: 'ref_001.jpg',
    kind: 'Full frame with the chrome visible.',
    note: 'Title block, button row, inventory dock, used/par, hint line.',
    ops: [{ level: 0 }],
  },

  // Our own additions — no reference counterpart, judged on their own merit.
  levelsGrid: {
    ref: null,
    kind: 'The level select grid.',
    note: 'Ours alone. Judged against the game\'s own visual language, not the reference.',
    ops: [{ level: 0 }, { modal: 'levels' }],
  },

  multiplayer: {
    ref: null,
    kind: 'A room with several named remote cursors on the board.',
    note: 'Ours alone. Cursor art, name labels, ownership tinting.',
    ops: [{ scripted: 'multiplayer' }],
  },
};

// Scripted setups live in the page so they can query the real level geometry instead of
// hardcoding coordinates that break whenever a level is redesigned. window.REFRACT must
// expose `script(name)` implementing each of these:
//
//   'folding'      pick a level whose solution needs 3+ mirrors, place them along the
//                  known solution, leave the last one selected and mid-drag
//   'dispersion'   pick a level with a prism, place the full solution except the final
//                  optic, so the fan is thrown across open space
//   'protractor'   place a single mirror in open board, select it, enter rotate-drag
//   'solved'       place a complete solution so every receptor is satisfied
//   'multiplayer'  inject three fake remote players with names and cursor positions
//
// Implement them by asking solver.js for a solution rather than by hardcoding numbers.

export const DEFAULT_SCENES = [
  'fresh', 'beamDetail', 'folding', 'dispersion', 'fanDetail',
  'protractor', 'solvedBoard', 'solvedModal', 'hud', 'levelsGrid',
];
