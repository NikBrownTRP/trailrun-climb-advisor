# Climb Advisor — Watch Face Design Brief & Handover

**Artifact:** [`app2-watchface-mockup.html`](app2-watchface-mockup.html) — open it in a browser, drag the
**Gradient** / **Heart rate** sliders, or hit **Auto-climb** to watch the scene transform.

This is the **visual target** for a more graphical version of the App 2 watch screen. It is a *web
mockup* — not the watch code. Use it to lock the look; the actual watch screen is then implemented
natively in the SuuntoPlus DSL (see "What translates" below).

---

## Concept: "the living hillside"

The watch face is a **scene that reacts to the climb**, not a data readout:

- A **slope** that physically steepens as the live gradient rises.
- A **figure** on the slope whose gait + color change with the effort zone:
  - **RUN** → green **runner** (rolling, runnable grade)
  - **POWER-HIKE** → orange **hiker**, hands-on-thighs, bent into it
  - **HIKE** → red **poler**, planting sticks on the wall (poles cue appears)
- A **coach shout** that pulses with the mode: *SEND IT! / POWER UP! / DIG IN!*
- Precise stats on the edges: **grade to 0.1%** (cyan, top), **HR in whole bpm** (bottom).

**The one memorable thing:** scrub the gradient and the whole hillside tilts while the athlete
morphs run → power-hike → pole and recolours green → orange → red. The screen *is* your effort zone.

---

## States (driven by the same values main.js already emits)

| Input | Drives |
|---|---|
| `mode` (0 RUN / 1 POWER_HIKE / 2 HIKE) | figure pose, all scene colors, mode word, shout |
| `gradePct` (float) | slope tilt angle + the "0.0%" readout (rounded to 0.1) |
| `hrBpm` (int) | HR readout; turns red over threshold |
| `poles` (0/1) | "POLES UP" cue + poles on the figure |

Effort bands in the mock use the **intermediate** profile (gRun≈14.5%, gHike≈24.5%, poles≈27.5%,
HR threshold 165). On-watch the real thresholds come from `climb-advisor-core` per the user's profile.

## Palette (matches the watch's available color classes)

| Token | Hex | Use |
|---|---|---|
| RUN green | `#18d17a` | runnable zone |
| POWER-HIKE orange | `#ff8a1f` | power-hike zone |
| HIKE red | `#ff4d4d` | grind zone / over-threshold HR |
| grade cyan | `#19c2b4` | steepness |
| coach yellow | `#ffd23f` | shout-line, poles cue |
| ink | `#000` AMOLED black | background (battery-friendly) |

---

## What translates to the watch — and what doesn't

The watch runs the SuuntoPlus **uiView DSL** (Duktape **ES5**, a **partial `<canvas>`** API, max two
**64-color PNGs**, 466 px round AMOLED). So:

**Keep / translatable:**
- Black background, the **slope as a filled `<canvas>` path** rotated by the live gradient.
- The **figure as a stroked silhouette** drawn with `beginPath/moveTo/lineTo/arc/stroke` — swapped by
  `mode`, recolored by zone. (Pose joint coordinates are in the mock's `POSES` object — directly portable.)
- Color via the DSL's `c-green / c-orange / c-red / c-cyan / c-yellow` classes (or canvas `strokeStyle`
  with **hex** — color *names* don't work in canvas).
- Grade/HR text via `eval` + `script`/`keyValue` formatters (already in `t.html`).

**Drop / adapt for the mock only (won't run on watch):**
- CSS transitions/animations, web fonts, drop-shadows, the topo page chrome, the slider UI.
- The figure **idle bob** and smooth color tweens — on-watch it updates once per `evaluate()` tick (~1 Hz);
  movement should be subtle (e.g., a 2-frame stride) to respect battery + redraw cost.
- Slope angle is **exaggerated ×1.9** in the mock for legibility; tune the real exaggeration on-device.

**Open questions to decide during review:**
1. Canvas vs. two pre-rendered PNG sprites — canvas supports all 3 poses dynamically (PNG limit is 2),
   so canvas is the likely path; confirm canvas performance on a real Race/Vertical.
2. How much figure motion is worth the redraw each tick (static pose vs. tiny stride animation).
3. Whether to keep both the figure *and* the big mode word, or let the figure carry the mode and shrink the text.

---

## Suggested workflow

1. **Review / iterate the mockup** (you, or hand to Claude Design) — nail poses, proportions, layout,
   color, how much motion. It's plain HTML/CSS/SVG/JS, easy to tweak.
2. Lock the visual.
3. **I port it to the watch**: rewrite `app2/t.html` to host a `<canvas>` and add a `drawScene(ctx, mode,
   gradePct, hr, poles)` routine in `app2/main.js` (ES5), reusing the `POSES` joint data. Verify with the
   extension's `validateProject` + simulator, keeping the core-parity test green.
