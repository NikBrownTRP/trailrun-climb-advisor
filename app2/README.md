# App 2 — Live Sports App (on-watch)

A SuuntoPlus **Sports App** that runs during a trail run and nudges **run / power-hike /
hike-with-poles** in real time, from the gradient under-foot + live HR. It complements the
Guide (App 1): the Guide bakes route lookahead; this app reacts to live physiology (SPEC §6).

> **Status: scaffold built against researched API** (`docs/suunto-api-findings.md` Part B),
> not yet run on hardware. Spots needing on-device confirmation are tagged `VERIFY-HW`.

## Files

| File | Role |
|---|---|
| `manifest.json` | App metadata, declared input resources, outputs, user settings |
| `main.js` | Lifecycle (`onLoad`, `evaluate` @1 Hz, `getUserInterface`) — gradient smoothing, advice, HR override, hysteresis |
| `src/core.js` | **ES5 port of the backend decision core** — kept byte-for-byte behavior-identical to `../src/core` (locked by `../test/app2-core-parity.test.ts`) |
| `t.html` | Watch data screen (SuuntoPlus `uiView` DSL) |

## The core parity guarantee

`src/core.js` is the on-watch twin of the TypeScript backend core. It is **ES5** (Duktape:
no `let`/`const`/arrow/`**`/template-literals). `../test/app2-core-parity.test.ts` evaluates
this file module-free (as Duktape would) and asserts its `advise()` matches the backend's
across a 180-case grade × profile × goal × length × ascent matrix — so the live app and the
baked Guide can never silently diverge (the SPEC §4 requirement). Run it with `npm test`
from the repo root.

If you change the science in `../src/core`, port the same change here and the parity test
will confirm it.

## Open & run in the SuuntoPlus Editor

1. Install **VS Code** + the **SuuntoPlus Editor** extension (Marketplace: `Suunto.suuntoplus-editor`).
2. Open this `app2/` folder in VS Code.
3. `Cmd/Ctrl+Shift+P` → **"SuuntoPlus: Open SuuntoPlus Simulator"**. Feed a FIT or Suunto-JSON
   trail run (with altitude + HR) and watch the advice react.
4. To side-load: connect the watch (USB, or BLE after unpairing it from the Suunto mobile
   app) → **"SuuntoPlus: Deploy to Watch"**. Note: syncing the watch with the Suunto mobile
   app deletes side-loaded apps.

Targets UI2 displays `n`/`o`/`q` (9 Peak Pro, Vertical, Race/Vertical 2). Build emits one
`.fea` per display.

## Live data sources (manifest `in`)

| name | source path | notes |
|---|---|---|
| `distance` | `/Activity/Current/Distance` | m |
| `altitude` | `/Fusion/Altitude` | fused baro+GPS, m |
| `hr` | `Activity/Move/-1/HeartRate/Current` | **Hz — ×60 for bpm** (VERIFY-HW) |
| `ascent` | `/Fusion/Altitude/Ascent` | cumulative m → fatigue term |
| `navState` | `/Navigation/State` | 3 = on route, 7 = snap |
| `remainAscent` | `Navigation/Routes/NavigatedRoute/RemainAscent` | route remaining ascent, m |

Athlete profile is read from `localStorage` (keys = manifest `settings[].path`), edited in
the Suunto mobile app.

## VERIFY-HW before trusting on-trail

- **HR unit** is Hz in the docs — confirm `hr * 60` gives correct bpm in the simulator.
- **Smoothing window** (`GRADE_WINDOW_M = 30 m`) and **dwell** (`T_DWELL = 4 s`): tune on real
  rolling terrain so advice is stable but responsive.
- No **per-point route elevation** accessor exists — live lookahead is limited to scalar
  `RemainAscent`; detailed "climb ahead" stays in the Guide.
- `evaluate()` tick is ~1 Hz; confirm buffer growth stays within watch memory on long runs.
- Resource path exactness (leading slash, casing) — confirm each subscribes successfully.
