// Capture scenes. Each mirrors a specific reference frame so blind comparisons line up.
// A scene is driven through window.REFRACT inside the page.

export const SCENES = {
  // ref_001.jpg — level loaded, untouched, single straight beam from the emitter.
  fresh: {
    ref: 'ref_001.jpg',
    note: 'Level 13 loaded, no optics placed, straight beam across the top corridor.',
    ops: [{ level: 12 }],
  },

  // ref_010.jpg — two mirrors folding the beam, third mirror selected mid-rotation.
  folding: {
    ref: 'ref_010.jpg',
    note: 'Beam folded twice, a third mirror selected showing the protractor ring.',
    ops: [
      { level: 12 },
      { place: { type: 'mirror', x: 800, y: 195, angle: Math.PI * 0.25 } },
      { place: { type: 'mirror', x: 800, y: 420, angle: Math.PI * 0.75 } },
      { place: { type: 'mirror', x: 215, y: 400, angle: Math.PI * 0.25 }, select: true },
      { drag: true },
      { cursor: [200, 430] },
    ],
  },

  // ref_020.jpg / ref_030.jpg — the prism throwing a full dispersed fan at the receptors.
  dispersion: {
    ref: 'ref_030.jpg',
    note: 'Prism in the folded beam, full rainbow fan reaching the three receptors.',
    ops: [
      { level: 12 },
      { place: { type: 'mirror', x: 800, y: 195, angle: Math.PI * 0.25 } },
      { place: { type: 'mirror', x: 800, y: 420, angle: Math.PI * 0.75 } },
      { place: { type: 'mirror', x: 215, y: 400, angle: Math.PI * 0.25 } },
      { place: { type: 'prism', x: 300, y: 545, angle: 0.35 } },
    ],
  },

  // Close crop on the prism output — judges dispersion smoothness, banding, hue order.
  fanDetail: {
    ref: 'ref_030.jpg',
    note: 'Tight crop on the prism and its fan. Banding and hue order are the test.',
    crop: { x: 0.18, y: 0.42, w: 0.66, h: 0.48 },
    ops: [
      { level: 12 },
      { place: { type: 'mirror', x: 800, y: 195, angle: Math.PI * 0.25 } },
      { place: { type: 'mirror', x: 800, y: 420, angle: Math.PI * 0.75 } },
      { place: { type: 'mirror', x: 215, y: 400, angle: Math.PI * 0.25 } },
      { place: { type: 'prism', x: 300, y: 545, angle: 0.35 } },
    ],
  },

  // Close crop on a long straight white beam — judges core, amber shoulders, grain, bloom.
  beamDetail: {
    ref: 'ref_001.jpg',
    note: 'Tight crop on the emitter and the long white beam. Core profile is the test.',
    crop: { x: 0.08, y: 0.08, w: 0.62, h: 0.24 },
    ops: [{ level: 12 }],
  },

  // The selection protractor, alone, at high zoom.
  protractor: {
    ref: 'ref_010.jpg',
    note: 'Selected mirror with protractor ring, handle dot and angle readout.',
    crop: { x: 0.06, y: 0.26, w: 0.42, h: 0.34 },
    ops: [
      { level: 12 },
      { place: { type: 'mirror', x: 215, y: 400, angle: Math.PI * 0.25 }, select: true },
      { drag: true },
      { cursor: [200, 430] },
    ],
  },

  // Receptors lit.
  solvedBoard: {
    ref: 'ref_034.jpg',
    note: 'All three receptors satisfied, before the SOLVED overlay.',
    ops: [{ level: 12 }, { solve: true }],
  },

  // The SOLVED overlay.
  solvedModal: {
    ref: 'ref_038.jpg',
    note: 'SOLVED panel over the dimmed board.',
    ops: [{ level: 12 }, { solve: true }, { modal: 'solved' }],
  },

  // HUD chrome only — typography, chips, dock.
  hud: {
    ref: 'ref_001.jpg',
    note: 'Chrome: title block, button row, inventory dock, used/par readout.',
    ops: [{ level: 12 }],
  },
};

export const DEFAULT_SCENES = [
  'fresh', 'folding', 'dispersion', 'fanDetail', 'beamDetail',
  'protractor', 'solvedBoard', 'solvedModal',
];
