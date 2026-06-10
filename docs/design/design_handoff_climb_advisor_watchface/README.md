# Handoff: Climb Advisor Watch Face — "the word climbs the hill"

## Overview
A graphical watch face for **SuuntoPlus App 2 (Climb Advisor)**. The screen is a scene that
reacts to the climb: a **slope** that steepens as the live gradient rises, with the **zone word**
(`RUN` / `POWER-HIKE` / `HIKE`) sitting on that slope and **rotating with the gradient**, recoloured
green → orange → red. Precise stats sit on the edges: grade (cyan) at the top, heart rate at the foot.

There is **no figure** — an earlier version drew a runner/hiker/poler silhouette; that was dropped.
The zone word itself is now the graphic, so one glance reads both *how steep* (the tilt) and
*what to do* (the word + colour).

## About the design files
The file in this bundle (`Climb Advisor Watch Face v2.html`) is a **design reference created in HTML/Canvas**
— a prototype showing the intended look and behaviour, **not** production code to ship. The task is to
**recreate this design on the watch** in the SuuntoPlus **uiView DSL** (Duktape **ES5**, partial
`<canvas>` API, 466 px round AMOLED), per the original brief (`original-brief.md`). Concretely: host a
`<canvas>` in `app2/t.html` and add a `drawScene(ctx, mode, gradePct, hr, poles)` routine in
`app2/main.js`. The HTML mock lays out **three states side by side** purely for review — on-watch you
render **one** scene from the live values `main.js` already emits.

The mock draws the **slope + rotated word on `<canvas>`** (directly portable) and the **stat readouts as
HTML overlays** (on-watch these come from the existing `script` / `keyValue` formatters in `t.html`, not
canvas — see "What maps to what" below).

## Fidelity
**High-fidelity.** Colours, proportions, the rotation math, and the fit/centre logic are final and exact.
Reproduce the canvas geometry faithfully; the slope/word exaggeration factor is the one knob to retune
on real hardware (see Design Tokens → `EXAG`).

---

## The scene (single dial)

Target dial: **466 px round AMOLED**, pure black background `#000` (battery-friendly; keep lit pixels
sparse). The mock renders at 460 px (400 px under 1520 px viewport) but all geometry below is expressed
as fractions of the canvas size `w`/`h`, so it scales to 466.

Three z-layers, drawn back-to-front:

1. **Background** — fill the whole canvas black.
2. **Slope** — a filled wedge whose top edge (the ridge) tilts with the gradient, plus a bright ridge line.
3. **Zone word** — the mode word, rotated parallel to the ridge, centred on the dial, in the zone colour.

Stat readouts (grade, HR, coach shout, POLES cue) sit on top, anchored to the dial edges.

### 1. Slope geometry

```
EXAG    = 1.9                       // visual exaggeration of the tilt (retune on device)
ang     = atan(gradePct / 100) * EXAG   // radians; uphill is to the RIGHT
pivotX  = w * 0.50
pivotY  = h * 0.66                   // the slope passes through (pivotX, pivotY) at the dial centre

// ridge y at any x:
slopeY(x) = pivotY - (x - pivotX) * tan(ang)
```

- **Fill**: polygon `(0, slopeY(0)) → (w, slopeY(w)) → (w, h) → (0, h)`.
  Fill with a **vertical linear gradient** of the zone RGB:
  - top stop (at `y = min(slopeY(0), slopeY(w))`): zone colour at **alpha 0.30**
  - bottom stop (at `y = h`): zone colour at **alpha 0.045**
  (A near-black tinted mass — keeps it AMOLED-friendly while reading as coloured ground.)
- **Ridge line**: stroke from `(0, slopeY(0))` to `(w, slopeY(w))`, **zone colour**, line width **3**,
  alpha **0.9**.

### 2. Zone word (the hero)

```
// Fit the word to the dial, then centre it.
// 1) measure at a reference size to get the natural width:
font = "800 100px <condensed>"
w100 = measureText(mode).width
// 2) final size: fill up to 80% of the dial, but never taller than 26.5% of the dial:
size = min( w * 0.265, (w * 0.80 / w100) * 100 )

// 3) the word rises up-and-right when rotated, which pulls its visual centre LEFT.
//    Push the pivot right by that offset so the block centres on w/2:
dx  = 0.5 * size * sin(ang)
cx  = w * 0.50 + dx
cy  = slopeY(cx)                     // keep it sitting on the ridge

// 4) draw:
translate(cx, cy)
rotate(-ang)                          // counter-clockwise = uphill to the right
font      = "800 " + size + "px <condensed>"
textAlign = "center"
textBaseline = "alphabetic"
fillStyle = zoneColor
fillText(mode, 0, -size * 0.16)       // small lift so the letters sit ON the ridge, not through it
```

Notes:
- The **`dx` centring step is essential** — without it the word visibly hugs the left, more so as the
  grade steepens (`HIKE` drifted most). It is font-independent.
- `<condensed>` in the mock is **Saira Condensed 800**. On-watch use whatever bold, condensed face the
  DSL provides; the fit logic adapts to the face's metrics automatically via the `w100` measure.
- Result per state: short words (`RUN`, `HIKE`) hit the `w*0.265` height cap and go big; the long
  `POWER-HIKE` is limited by the `w*0.80` width and renders smaller — all stay inside the circle.
- Canvas `fillStyle` must be a **hex** value (colour *names* don't work in canvas on the DSL).

### 3. Stat readouts (dial edges)

All horizontally centred (`left: 50%`, centre-anchored). Positions are fractions of dial height `h`:

| Element | Anchor | Type | Colour | Notes |
|---|---|---|---|---|
| **Grade** | top, `y ≈ 0.08·h` | number + small `%` | cyan `#19c2b4`; the `%` glyph dimmer `#13988e` | `gradePct.toFixed(1)` e.g. `9.2%`. **No "GRADE" label.** |
| **POLES UP** | top, `y ≈ 0.255·h` | pill, caps | yellow `#ffd23f` | Only when `poles === 1`. Outline `rgba(255,210,63,.5)`, fill `rgba(255,210,63,.07)`. |
| **Coach shout** | bottom, `y ≈ 0.81·h` | caps, letter-spaced | yellow `#ffd23f` | `SEND IT!` / `POWER UP!` / `DIG IN!` by mode. Subordinate to the word. |
| **Heart rate** | bottom, `y ≈ 0.92·h` | ♥ glyph + number | white `#e8edf2`, or red `#ff4d4d` when `hr > 165` | **No "BPM" suffix.** Heart glyph turns red with the number when over threshold. |

Mock type sizes (at 460 px dial; scale to 466): grade **64 px** (`%` 30 px), shout **17 px**
(letter-spacing .2em), HR **44 px** (heart 24 px), POLES **13 px** (letter-spacing .22em).
Family: Saira Condensed 700 for all readouts. On-watch, render these via the existing
`script`/`keyValue` formatters and colour classes — not canvas text.

---

## States & input mapping

The scene is driven by the same values `main.js` already emits each `evaluate()` tick (~1 Hz):

| Input | Type | Drives |
|---|---|---|
| `mode` | 0 RUN / 1 POWER_HIKE / 2 HIKE | the word string, all scene colours, the shout, the figure-less zone identity |
| `gradePct` | float | slope tilt `ang`, word rotation, the `9.2%` readout (rounded to 0.1) |
| `hr` | int | HR readout; red when `> 165` |
| `poles` | 0 / 1 | the `POLES UP` pill |

Demo values shown in the mock (using the **intermediate** effort profile):

| mode | word | colour (hex) | shout | gradePct | hr | poles |
|---|---|---|---|---|---|---|
| 0 | `RUN` | `#18d17a` | `SEND IT!` | 9.2 | 148 | 0 |
| 1 | `POWER-HIKE` | `#ff8a1f` | `POWER UP!` | 19.0 | 162 | 0 |
| 2 | `HIKE` | `#ff4d4d` | `DIG IN!` | 28.5 | 171 (red) | 1 |

On-watch the real effort thresholds come from `climb-advisor-core` per the user's profile (intermediate ≈
gRun 14.5 %, gHike 24.5 %, poles 27.5 %, HR threshold 165). The mock values above are just representative
samples inside each band.

---

## Design tokens

**Colours**
```
RUN green        #18d17a   rgb(24,209,122)    runnable zone (word, slope, ridge)
POWER-HIKE orange#ff8a1f   rgb(255,138,31)    power-hike zone
HIKE red         #ff4d4d   rgb(255,77,77)     grind zone  + over-threshold HR
grade cyan       #19c2b4                      grade number
grade % dim      #13988e                      the "%" glyph only
coach yellow     #ffd23f                      shout + POLES pill
ink              #000      AMOLED black        background
HR white         #e8edf2                      heart rate (under threshold)
```

**Geometry constants**
```
EXAG          1.9          tilt exaggeration  (the one value to retune on real hardware)
HR_THRESH     165          bpm; HR turns red above this
slope pivot   (0.50·w, 0.66·h)
ridge stroke  width 3, alpha 0.9
slope fill    zone @ alpha 0.30 (top) → 0.045 (bottom), vertical gradient
word size     min(0.265·w,  (0.80·w / naturalWidth) · 100 )   // ref measure at 100px
word centre   dx = 0.5 · size · sin(ang); pivot at (0.50·w + dx, slopeY(0.50·w + dx))
word lift     -0.16 · size  (alphabetic baseline offset)
word weight   800
```

**Type (mock — Saira Condensed)**
```
grade   700 · 64px   ( % at 30px )
HR      700 · 44px   ( heart glyph 24px )
shout   700 · 17px   letter-spacing .20em
poles   700 · 13px   letter-spacing .22em
word    800 · fitted (see word size)
```

## Interactions & behaviour
- **Static per tick.** The face redraws once per `evaluate()` tick (~1 Hz) from the live values; there is
  no continuous animation. Keep redraw cost low (one filled path + one stroke + one `fillText`).
- No touch/tap interactions on this face beyond the platform's standard page navigation.
- The mock's CSS transitions, web fonts, drop-shadows, page chrome and any slider UI are **mock-only** and
  do not translate.

## What maps to what (mock → watch)
| Mock (HTML/Canvas) | Watch (uiView DSL, ES5) |
|---|---|
| `<canvas>` slope fill + ridge | filled `<canvas>` path, same `slopeY(x)` math |
| `<canvas>` rotated `fillText` word | `ctx.rotate(-ang)` + `fillText`, zone **hex** `fillStyle` |
| HTML grade / HR / shout / POLES overlays | `script` / `keyValue` formatters + `c-cyan` / `c-yellow` / `c-red` colour classes in `t.html` |
| Saira Condensed 800 | the DSL's available bold condensed face |
| `box-shadow` dial bezel, page background | n/a (drop) |

## Open questions to confirm on device
1. **Canvas vs. PNG sprites** — canvas renders all three states dynamically and is the likely path; confirm
   canvas `fillText` + rotate performance on a real Race / Vertical.
2. **`EXAG` value** — 1.9 reads well at mock size; tune the real exaggeration so `HIKE` stays inside the
   bezel without clipping and `RUN` still reads as a climb.
3. **Coach shout** — keep the small yellow shout, or let the word carry the mode alone and drop it?

## Files
- `Climb Advisor Watch Face v2.html` — the design reference (open in a browser; the three dials render on
  canvas). All math above is in its `drawScene()` and `slopeYAt()` functions and the `STATES` array.
- `original-brief.md` — the original design brief & watch-porting constraints.
```
