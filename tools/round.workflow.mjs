export const meta = {
  name: 'refract-round',
  description: 'Refract: one full improvement round — capture, blind-judge every piece, then fix every named gap',
  phases: [
    { title: 'Capture', detail: 'run the harness, produce fresh screenshots and blind pairs' },
    { title: 'Judge', detail: 'independent blind critics, one per piece, fresh context' },
    { title: 'Fix', detail: 'one builder per piece, briefed only on its own critic verdict' },
    { title: 'Verify', detail: 're-run the game and confirm nothing regressed' },
  ],
}

const ROOT = '/Users/jurek/Downloads/Claude/Projects/refract'
const R = (args && args.round) || 'rX'
const FOCUS = (args && args.focus) || null

const SHARED = `
PROJECT ROOT: ${ROOT}
ROUND: ${R}

REFRACT is a browser puzzle game: a white beam leaves an emitter, mirrors steer it, prisms
split it into a real dispersed spectrum, and three coloured receptors must each receive
their own colour. Solo plus realtime multiplayer.

Required reading before you act:
- ${ROOT}/docs/ARCHITECTURE.md    the binding module contract
- ${ROOT}/docs/ORCHESTRATOR-NOTES.md  traps verified against the reference
- ${ROOT}/docs/REFERENCE.md       measured values from the reference footage

The reference footage frames live in ${ROOT}/reference/frames/ (ref_001..ref_038.jpg) and
${ROOT}/reference/dense/ (f_0001..f_0150.jpg at 4 fps). Ignore the @STEREO.DRIFT Instagram
watermark burned into some frames — it is not part of the game.

To run the game:
  cd ${ROOT} && node tools/shoot.mjs --prefix=${R}     # deterministic screenshots
  cd ${ROOT} && python3 -m http.server 8123            # then drive it with browser tools
Both work. shoot.mjs drives window.REFRACT (see ARCHITECTURE.md section 9).
`

const CRITIC = `
YOU ARE A HARSH CRITIC. You are not here to be encouraging and you are not here to list
what works. Praise is worthless output. Your entire value is in finding the gap.

Your procedure, in this order, and you may not skip a step:

1. RUN THE REAL GAME. Do not judge from source code. Do not judge from a screenshot
   someone else took. Capture your own evidence:
     cd ${ROOT} && node tools/shoot.mjs --prefix=${R}
   and additionally drive the live game with the browser preview tools so you see it in
   motion, not only as stills. If the harness fails, fix your invocation or say plainly
   that the game does not run — never invent a judgement.

2. BLIND COMPARISON. Build the blind pairs:
     cd ${ROOT} && node tools/blind.mjs --prefix=${R}
   This writes ${ROOT}/progress/blind/${R}/pair-<scene>.png — each one places our capture
   and a reference frame of the SAME KIND side by side, left/right order randomised, no
   labels. Read the pair images for the scenes relevant to your piece.

   REFRACT IS NOT A CLONE. Our levels are our own, so the two panels show DIFFERENT
   layouts. The question is therefore NOT "which panel is the same frame". The question is:

     "One of these two screenshots comes from a polished, commercially released puzzle
      game. The other comes from an amateur build trying to look like one. Which is
      which, and what specifically gave the amateur one away?"

   Judge craft, not layout. Different wall positions are expected and are never evidence.
   Evidence is: banding in a gradient, bloom that is too tight or too wide, flat lighting,
   a beam that is a coloured rectangle instead of a lit volume, typography that is nearly
   right, spacing that is nearly right, anything that reads as "made by someone who has
   not shipped a game".

   You MUST NOT open ANSWER-KEY.json until after you have written down your guess.
   For each pair, state: "pair-<scene>: I believe the LEFT/RIGHT panel is the commercial
   game, because <specific visual reason>." Commit to it in your output text BEFORE you
   read the key. Then read the key and report whether you were right.

   Being unable to tell them apart is the good outcome. Correctly identifying ours as the
   amateur one is a failure we need to hear about, precisely and specifically.

3. NAME THE SINGLE BIGGEST GAP. Not a list of ten things. One thing: the one visual or
   behavioural difference that most gives our version away. Describe it concretely enough
   that a builder who has never seen the reference could fix it — which pixels, which
   values, which direction, how much.

4. Then, and only then, a short ranked list of the next three smaller gaps.

Rules:
- "It looks good" or "close enough" is a failed review. There is always a next gap; if
  our version genuinely wins the blind test, your job becomes finding what would make it
  better than the reference rather than merely equal to it.
- Quantify. "The bloom is too tight" is useless. "The bloom falls to half brightness
  within about 8 px of the core where the reference takes about 26 px" is useful.
- If you find the game is broken or fails to run, that IS the biggest gap. Say so first.
- Do NOT edit any source file. You are a critic. A separate builder acts on your verdict.

Return exactly this structure:
  VERDICT: ours | reference | tie      (which side the blind test identified as real)
  BLIND: your per-pair guesses and whether each was correct
  BIGGEST GAP: one paragraph, concrete and quantified
  NEXT THREE: ranked, one line each
  EVIDENCE: paths to the screenshots you captured
`

const BUILDER = `
YOU ARE A BUILDER. A critic just ran the real game, compared it blind against the
reference, and named the gap. Your job is to close it.

Rules:
- Read the critic's verdict carefully. The BIGGEST GAP is your primary task. Do it fully.
  Then work down the NEXT THREE as far as you can do well.
- Only modify the files listed as yours. Everything else belongs to another builder
  working in parallel right now. If your fix genuinely requires a change outside your
  files, make the minimal change and say so loudly in your report so the verifier knows.
- Write complete files, never partial edits with elisions.
- Do not regress anything. Before you finish, run:
    cd ${ROOT} && node tools/shoot.mjs --prefix=${R}-check
  and look at the results. If the game stopped booting, you broke it — fix it before
  returning.
- Vanilla ES modules, WebGL2, no build step, no framework. GLSL ES 3.00. English code.
- Match the reference, then go past it. "Equal to the reference" is the floor.

Return: what the gap was, what you changed and why, and what you could not fix and why.
`

const PIECES = [
  {
    key: 'beam',
    scenes: 'beamDetail fresh folding',
    what: `THE WHITE BEAM: its cross-sectional profile, the blown-out core, the soft
shoulders, the chiral warm/cool fringe described in ORCHESTRATOR-NOTES.md section 1, the
animated longitudinal grain, the bloom radius and falloff, the emitter mouth, and how a
beam looks where it strikes a mirror.`,
    files: `${ROOT}/js/render/beams.js and, only if the fix truly requires it, the bloom
parameters in ${ROOT}/js/render/pipeline.js`,
  },
  {
    key: 'dispersion',
    scenes: 'fanDetail dispersion',
    what: `THE PRISM AND ITS SPECTRUM: the angular spread of the fan, the hue order across
it, whether it reads as a continuous wedge or as visible bands, how it brightens near the
prism and dims with distance, the Fresnel reflections off the prism faces described in
ORCHESTRATOR-NOTES.md section 3, and the appearance of the glass triangle itself.`,
    files: `${ROOT}/js/optics/spectrum.js, ${ROOT}/js/optics/trace.js, and the spectral
path in ${ROOT}/js/render/beams.js`,
  },
  {
    key: 'board-art',
    scenes: 'fresh hud dispersion',
    what: `THE BOARD SURFACES: the brick wall texture, its colour, its running bond, the
mortar, the bevel that makes walls read as three-dimensional, how walls pick up light from
a nearby beam, the emitter housing, and the receptor rings and flags — remembering from
ORCHESTRATOR-NOTES.md section 2 that receptors are ALWAYS emissive.`,
    files: `${ROOT}/js/render/board.js and ${ROOT}/js/render/textures.js`,
  },
  {
    key: 'hud',
    scenes: 'hud fresh solvedModal',
    what: `THE CHROME: the level title block, the top-right button row, the inventory dock
and its count badges, the USED/PAR readout, the hint line, and the SOLVED panel — its
typography, letter-spacing, weights, sizes, colours, borders and spacing, and its
animation in and out.`,
    files: `${ROOT}/index.html, ${ROOT}/css/ui.css, ${ROOT}/js/ui/hud.js, ${ROOT}/js/ui/modals.js`,
  },
  {
    key: 'selection',
    scenes: 'protractor folding',
    what: `THE SELECTION AND PLACEMENT UI: the protractor ring, its radius, stroke, opacity,
tick marks, the handle dot, the angle readout and its position, the drag ghost, the invalid
placement state, the mirror and prism sprites themselves, and the cursor art in every
state. Remember from ORCHESTRATOR-NOTES.md section 4 that the reference's angle readout is
buggy and ours should be better, not identical.`,
    files: `${ROOT}/js/render/board.js protractor and optic drawing, ${ROOT}/js/ui/cursors.js`,
  },
]

phase('Capture')

const capture = await agent(`${SHARED}

YOUR JOB: get the evidence harness working and produce this round's screenshots. You are
not judging anything and you are not improving the look of the game.

1. cd ${ROOT} && node tools/shoot.mjs --prefix=${R}
   If it fails, diagnose and fix it. Common causes: the game does not boot, window.REFRACT
   is missing or has drifted from the contract in ARCHITECTURE.md section 9, a shader fails
   to compile, an asset 404s, or WebGL is unavailable in headless Chrome. Fix whichever it
   is — you may edit ${ROOT}/js/main.js to restore the debug API, and ${ROOT}/tools/*.
   Report every console error you had to fix.

2. Confirm every scene in tools/scenes.mjs produced a plausible non-black PNG. A 720x694
   image of pure black means the game rendered nothing — that is a failure, not a capture.
   Actually LOOK at the PNGs with the Read tool. Do not trust exit code zero.

3. cd ${ROOT} && node tools/blind.mjs --prefix=${R}
   Confirm the pair images exist and each shows two side-by-side panels.

4. Report: harness status, what you fixed, the list of shots written, any scene that
   could not be captured and why, and the measured segment count and frame rate.`,
  { label: 'capture', phase: 'Capture' })

log(`Capture done. Judging ${PIECES.length} pieces blind.`)

phase('Judge')

const active = FOCUS ? PIECES.filter(p => FOCUS.includes(p.key)) : PIECES

const results = await pipeline(
  active,
  (piece) => agent(`${SHARED}\n${CRITIC}

YOUR PIECE: ${piece.key}

You are judging ONLY this: ${piece.what}

The blind pairs most relevant to you are the scenes: ${piece.scenes}
(their files are ${ROOT}/progress/blind/${R}/pair-<scene>.png).

Ignore every other aspect of the game. If the audio is wrong, that is not your problem.
If the levels are boring, that is not your problem. Judge your piece, ruthlessly.`,
    { label: `critic:${piece.key}`, phase: 'Judge', schema: {
      type: 'object',
      required: ['verdict', 'biggestGap', 'nextThree', 'blindNotes', 'evidence'],
      properties: {
        verdict: { type: 'string', enum: ['ours', 'reference', 'tie'],
          description: 'which side the blind test judged to be the polished commercial game' },
        blindNotes: { type: 'string', description: 'per-pair guess and whether it was correct' },
        biggestGap: { type: 'string', description: 'one concrete quantified paragraph' },
        nextThree: { type: 'array', items: { type: 'string' }, maxItems: 3 },
        evidence: { type: 'array', items: { type: 'string' } },
        gameRuns: { type: 'boolean' },
      },
    } }),

  (critique, piece) => agent(`${SHARED}\n${BUILDER}

YOUR PIECE: ${piece.key}
YOUR FILES: ${piece.files}

The critic ran the game, compared it blind against the reference, and reported:

VERDICT: ${critique?.verdict ?? 'unknown'}
GAME RUNS: ${critique?.gameRuns ?? 'unknown'}

BLIND NOTES:
${critique?.blindNotes ?? '(none)'}

BIGGEST GAP — this is your primary task:
${critique?.biggestGap ?? '(critic produced no verdict; run the game yourself, compare it against the reference frames for your piece, and fix the worst difference you find)'}

NEXT THREE:
${(critique?.nextThree || []).map((t, i) => `${i + 1}. ${t}`).join('\n') || '(none)'}

Close the biggest gap completely, then work down the list.`,
    { label: `fix:${piece.key}`, phase: 'Fix' })
    .then(fix => ({ piece: piece.key, critique, fix }))
)

phase('Verify')

const verify = await agent(`${SHARED}

YOUR JOB: verification and integration after ${active.length} builders edited the game in
parallel. You own every file.

What the builders did this round:
${results.filter(Boolean).map(r => `### ${r.piece}\nVERDICT WAS: ${r.critique?.verdict}\nGAP: ${(r.critique?.biggestGap || '').slice(0, 400)}\nFIX REPORT: ${r.fix}`).join('\n\n')}

Do this:
1. cd ${ROOT} && node tools/test-optics.mjs && node tools/validate-levels.mjs
   Both must pass. Fix whatever broke.
2. cd ${ROOT} && node tools/shoot.mjs --prefix=${R}-final
   The console must be clean. Zero errors. LOOK at every resulting PNG with the Read tool
   and confirm the game actually renders — a black frame is a failure.
3. Drive the live game with the browser preview tools and PLAY it: place a mirror, rotate
   it, place a prism, confirm the fan appears, solve a level, confirm the SOLVED panel.
   Confirm 60 fps. Confirm no console errors during interaction.
4. Fix every regression two builders introduced by editing near each other.
5. Copy the final screenshots you consider representative into ${ROOT}/progress/shots/
   keeping the ${R}-final prefix.

Report: test results, whether the game plays end to end, what regressed and what you
fixed, the honest current state, and your own single biggest remaining gap versus the
reference across the WHOLE game.`,
  { label: 'verify', phase: 'Verify' })

return {
  round: R,
  capture,
  pieces: results.filter(Boolean).map(r => ({
    piece: r.piece,
    verdict: r.critique?.verdict,
    biggestGap: r.critique?.biggestGap,
    nextThree: r.critique?.nextThree,
    blindNotes: r.critique?.blindNotes,
  })),
  verify,
}
