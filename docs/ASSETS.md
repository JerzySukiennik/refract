# Assets

All CC0. Attribution kept in `assets/cursors/KENNEY-LICENSE.txt` and `assets/audio/CREDITS.txt`.

## Cursors — Kenney Cursor Pack (kenney.nl/assets/cursor-pack)

`assets/cursors/` holds the **Outline / Double** variants at 64x64 px (outlined so they
stay legible on the black board) plus the matching **SVG** for each, which is what remote
player cursors are recoloured from.

| File | Use |
|---|---|
| `pointer_b` | idle pointer, the default over the board and over DOM chrome |
| `hand_point` | hovering anything interactive |
| `hand_open` | hovering a placed optic that can be picked up |
| `hand_closed` | actively dragging or rotating |
| `cross_large` | placing an optic from the dock |
| `cursor_disabled` | invalid drop position |
| `cursor_busy` | loading |
| `pointer_a`, `pointer_c`, `hand_small_point`, `cross_small`, `dot_small`, `zoom_in` | spares |

CSS `cursor:` must scale these down — a raw 64 px cursor is oversized. Use the SVG with
an explicit width, or a pre-scaled PNG, and set a correct hotspot per cursor.

**Remote player cursors** are DOM elements, not CSS cursors: take `pointer_b.svg`, recolour
its fill to the player's assigned colour, keep the dark outline, and put the player's chosen
name in a small label to its lower-right. Interpolate toward incoming positions; never
teleport.

## Audio — Kenney CC0 packs

Seeded in `assets/audio/`: `ui_click`, `ui_hover`, `ui_switch`, `place`, `pick`,
`receptor`, `error`, `beam_on`. More may be pulled from the local CC0 packs listed in
`docs/ARCHITECTURE.md`. The beam hum, rotation ticks, receptor chimes and the solve cue
are **synthesised** in `js/audio.js`, not sampled.

## Fonts

Google Fonts, loaded in `index.html`. See `docs/REFERENCE.md` for the measured matches.
