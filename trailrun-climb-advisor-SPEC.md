# Trail-Run Climb Advisor — Build Specification

A reference document for building two SuuntoPlus applications that advise a trail
runner whether to **run**, **power-hike**, or **hike with poles** on climbs, based on
the climb's steepness and the runner's physiological profile and live state.

This file is the source of truth for the Suunto platform API surface and the decision
logic. **Suunto's API details below were verified against Suunto's developer docs and
are NOT reliably present in an LLM's training data — do not "correct" them from memory.**
Where something is marked **[VERIFY]**, it must be confirmed against the live SDK/docs or
hardware before relying on it.

---

## 0. The two deliverables

1. **Guide Generator (backend service)** — produces a *SuuntoPlus Guide* per planned
   route. The guide gives **pre-computed, profile-personalized** climb advice delivered as
   position-triggered notifications + a target-HR gauge. Lookahead works; live HR-based
   branching does **not** (platform limitation, see §2.3).

2. **Live Sports App (on-watch JS/HTML)** — a *SuuntoPlus Sports App* that runs during the
   activity, computes **current gradient** from altitude/distance, reads **live HR**, and
   nudges run/hike/poles in real time. Reacts to live physiology; route lookahead is
   **[VERIFY]** (may only see the gradient under the runner's feet).

The two are complementary. Build them to **share one decision module** (§4) so the advice
is consistent. v1 priority: ship the Guide Generator first (fully feasible today), then the
Sports App for live reaction.

---

## 1. Platform model (read this before writing any Suunto code)

Two distinct SuuntoPlus app types exist:

| | SuuntoPlus **Guide** | SuuntoPlus **Sports App** |
|---|---|---|
| Form | JSON config (ZIP) pushed from cloud | JS + HTML deployed to watch |
| Runs | Watch's built-in if-then engine | On-watch JS runtime (`evaluate()` loop) |
| Lookahead to route | **Yes** (you precompute & bake position triggers) | **[VERIFY]** — likely live-only |
| React to live HR | **No** (conditions are position/time/route only) | **Yes** |
| Distribution | Pushed to a user's Suunto account via Cloud API; syncs to watch | Published to SuuntoPlus Store, or side-loaded to own watch via Editor |
| Build tool | Your backend + Guide Cloud API | SuuntoPlus Editor (VS Code extension) |
| Partner Program needed | Yes (Cloud APIs + OAuth) | No to build/side-load; **yes** to publish |

You **cannot** run code inside the Suunto mobile app. Your backend is a **separate service**
registered as a Suunto Partner. Delivery to the watch is via Suunto's own sync.

### 1.1 Supported watches
Suunto 9 Peak Pro, Suunto Race, Suunto Race 2, Suunto Vertical, Suunto Vertical 2 for
Sports Apps. Guides additionally support Suunto 3/5/9 family. Target Race/Vertical lines for
trail use.

---

## 2. SuuntoPlus Guide schema (VERIFIED — authoritative)

A guide is a ZIP containing `guide.json` (required) + `icon.png` (required, 300×300 px).

### 2.1 Guide object (top level)
```json
{
  "type": "sequence",            // required, must be "sequence"
  "name": "Climb Advisor",       // required, 1–60 chars
  "description": "…",            // required, 1–256 chars
  "richText": "*markdown*",      // optional, up to 100000 chars
  "shortDescription": "Climb",   // required, 1–23 chars (shown in watch selection list)
  "owner": "Bike AI Lab",        // required, 1–64 chars
  "url": "https://…",            // required, valid URL
  "activities": [ /* trail run id */ ], // optional; see Activities.pdf [VERIFY id]
  "usage": "workout",            // required, must be "workout"
  "localDate": "2026-09-01",     // optional, yyyy-MM-dd (e.g. race date)
  "externalId": "route-12345",   // optional, echoed back in workout FIT — use route id
  "steps": [ /* Step[] */ ]       // required, 1–1000 steps
}
```

### 2.2 Steps
First step shows when the workout starts. Transitions move between steps when a condition
fires.

- **FieldsStep**: `{ "type":"fields", "id"?, "title"?(≤13 chars), "fields":[Field], "transitions"?:[Transition], "notification"?:Notification, "createManualLap"?:bool }`
- **RepeatStep**: `{ "type":"repeat", "times":N(1–100), "steps":[FieldsStep] }` (no nesting)

**Transition**: `{ "condition": Condition, "stepId"?: string }` — processed first-to-last;
first satisfied wins. If `stepId` omitted, falls through to next step in list.

**Notification**: `{ "title"?:≤13 chars, "text"?:≤54 chars }` — pops up ~20 s with
sound/vibration **even when the user is not on the guide screen**. This is your "climb
ahead" alert mechanism.

### 2.3 Conditions (VERIFIED) — **the critical limitation**
Available condition `type`s:
- `distance` (value = meters into **workout**)
- `stepDistance` (value = meters into **current step**)
- `duration` / `stepDuration` (seconds, pauses excluded)
- `location` (`latitude`, `longitude`, optional `distance` = min distance in current step,
  optional `direction` = compass degrees the user must be heading)
- `routeCompleted` / `routeExited` (require an embedded `Route` in the step)
- `manualLap`
- `or` / `and` (`conditions: [Condition]`)

> **There is NO condition on heart rate, pace, altitude, gradient, or power.** The guide
> cannot branch on live physiology. All physiological personalization is **baked at
> generation time**; on the climb the watch shows the advice text + a **target-HR gauge**
> the runner self-regulates against. Design around this — do not try to make the guide
> "decide" live.

### 2.4 Fields (VERIFIED)
Display/data fields: `text` (≤54 chars; >40 chars suppresses other fields),
`heartRate`, `speed`, `pace`, `power`, `altitude`, `distance`, `duration`, `temperature`,
`cadence`, `ascent`, `descent`, `verticalSpeed`, `ascentTime`, `descentTime`, `energy`,
plus swim fields. Most accept `window` (`workout`/`step`/`manualLap`) and `aggregate`
(`average`/`min`/`max`) and `title`.

Gauge target fields: `targetHeartRate` (`value` or `min`+`max` in BPM),
`targetSpeed`/`targetPace`/`targetPower` (m/s, m/s, watts), `targetCadence` (Hz). These
render a gauge of current-vs-target. **Use `targetHeartRate` with `min`/`max` to give the
runner their per-climb HR ceiling.**

Practical: max ~4–5 fields per screen; put the most important first. `stepDistanceCountdown`
/ `stepDurationCountdown` fields give a live "X m / s remaining" countdown within a step.

### 2.5 Embedded Route (for routeCompleted/routeExited)
```json
{ "points":[ {"latitude":60.27,"longitude":24.97,"distance":0.0}, … ],
  "distance": 1000.0, "width": 50.0 }
```
Note: points carry lat/lon/distance only — **no elevation in the embedded route object**.
Elevation comes from the source GPX (§3.1), which you analyze server-side.

---

## 3. Cloud APIs (VERIFIED in outline — confirm exact URLs/auth in the PDF/portal)

Base: `https://cloudapi.suunto.com`. All calls need `Authorization: Bearer <token>` and
`Ocp-Apim-Subscription-Key: <key>`. OAuth + partner agreement required. **[VERIFY]** exact
OAuth endpoints/scopes from `apizone.suunto.com/how-to-start`.

### 3.1 Routes API
- Export GPX: `GET /v2/route/{id}/export` with `Accept: application/gpx+xml`.
  **[VERIFY]** that the GPX includes `<ele>` elevation on track/route points — the whole
  climb-segmentation depends on it. (Strongly expected, since Suunto's own Climb Guidance is
  route-elevation-based, but confirm.)
- Listing API exists (consult the apizone spec for query params).
- **Polling is prohibited.** Subscribe to route-update notifications via **webhook** by
  setting a "Route Notification Url" in the developer portal.

### 3.2 SuuntoPlus Guide Cloud API
Operations: **create / update / list / delete** guides for an authenticated user. Full
details in `SuuntoplusGuideCloudAPI.pdf` (linked from the guide-description page).
**[VERIFY]** exact endpoint paths, request shape (ZIP upload vs JSON), and rate limits there.
Once created, the guide **flows to the watch automatically on next sync** with the Suunto
app. Watch storage is limited; oldest/unused guides are auto-evicted.

### 3.3 Workout FIT files
Post-workout FIT files (via Cloud API) contain which guide was used (match your
`externalId`) and SuuntoPlus app outputs (developer fields). Use these to **refine the
user's fitness profile** between runs (closed-loop personalization across sessions).

---

## 4. Shared decision module (`climb-advisor-core`)

Implement once, mirror in both apps (Python or TS on the backend; JS on the watch). Pure
functions, no I/O. This is the scientific heart of the product.

### 4.1 Inputs
- **Segment** (climb): `gradient` g (fraction, e.g. 0.14), `length` L (m), `vertical` V (m),
  `cumulativeAscentBefore` (m), `distanceIntoRoute` (m).
- **Profile**: `vo2max` (ml/kg/min), `thresholdHR`, `maxHR`, `restHR`, HR `zones`,
  `bodyMass` (kg), `hasPoles` (bool), `experience` (novice/intermediate/elite),
  `goal` (`training`|`race`).
- **Live** (Sports App only): `currentHR`, `currentGradient`, `elapsedTime`,
  `cumulativeAscent`.

### 4.2 Energetics basis (cite in code comments)
- **Minetti et al. (2002)** running cost vs gradient is the reference curve. Net cost of
  running Cr(i) in J·kg⁻¹·m⁻¹ is commonly fit by a 5th-order polynomial in gradient `i`
  (fraction). A widely cited form is:
  `Cr(i) ≈ 155.4 i⁵ − 30.4 i⁴ − 43.3 i³ + 46.3 i² + 19.5 i + 3.6`
  **[VERIFY coefficients]** before trusting absolute numbers; treat as a shape model.
  Walking cost Cw(i) has its own polynomial; walking becomes relatively cheaper as grade
  steepens.
- **Walk↔run crossover is speed-dependent, not a fixed grade** (Ortiz/Giovanelli, VK
  studies): below ~0.7 m·s⁻¹ walking costs less metabolic power than running; ~0.8 m·s⁻¹ is
  roughly break-even; above that running can be cheaper. So the decision hinges on **whether
  the runner can sustain a running speed above the crossover at that grade** — which scales
  with fitness.
- **Poles** (Giovanelli "Do poles save energy…"): metabolic saving only appears on **steep**
  grades (~25–35°, i.e. ~47–70%), and is modest (~2–3%). Below that the benefit is
  **offloading the legs** and **delaying fatigue**, plus maximizing vertical rate on ~15–25°.

### 4.3 Recommended algorithm
Compute an estimated sustainable uphill running speed `v_run(g, profile)`:
1. Sustainable metabolic power `P_sus` ≈ fraction of VO₂max the runner can hold for the
   climb's expected duration (e.g. ~threshold for training, higher for short race climbs).
   Convert VO₂max → power; scale by goal and by climb duration.
2. `v_run = P_sus / Cr(g)` (with Cr from §4.2). Convert to m/s.
3. **Crossover test**: if `v_run` ≥ `V_CROSS` (default 0.78 m/s, tunable) → running is
   viable; else hiking.

Then band with hysteresis and fitness/fatigue adjustment:
```
ADVICE(segment, profile):
  g = segment.gradient
  fitnessShift = f(vo2max, experience)      // steeper run-band for fitter runners
  fatigue = g_fatigue(cumulativeAscentBefore, distanceIntoRoute, goal)
  gRun   = G_RUN_MAX  + fitnessShift - fatigue   // default 0.12 (12%)
  gHike  = G_HIKE_MAX + fitnessShift - fatigue   // default 0.22 (22%)
  gPoles = G_POLES    + fitnessShift             // default 0.25 (25%)  → ~ steep

  if g < gRun and v_run(g) >= V_CROSS:  base = RUN
  elif g < gHike:                       base = POWER_HIKE (run-walk if v_run≈V_CROSS)
  else:                                 base = HIKE

  poles = profile.hasPoles and (g >= gPoles or (base==HIKE and segment.length>L_LONG))
  targetHR = hr_ceiling(profile, goal, segment)   // e.g. top of Z3 training / Z4 race
  return { mode: base, poles, targetHR }          // targetHR → guide gauge / live alert
```
All thresholds (`G_RUN_MAX`, `G_HIKE_MAX`, `G_POLES`, `V_CROSS`, `L_LONG`, zone caps) live in
a single **config object** so they're tunable without code changes. Document each with its
scientific rationale.

### 4.4 Climb segmentation (server-side, from GPX)
1. Parse GPX → array of `{lat, lon, ele, cumDist}`. Resample to even ~10–25 m spacing.
2. Smooth elevation (e.g. moving average / Savitzky–Golay) to kill barometric/DEM noise.
3. Compute per-segment grade = Δele/Δdist. Classify points as climb/flat/descent with a
   grade threshold (e.g. >3–4% = climb) and **hysteresis + minimum length** (e.g. ignore
   climbs < 30 m vertical or < 50 m length) so you don't emit dozens of micro-climbs.
4. Merge adjacent climb points into climb segments; for each compute start distance, length,
   vertical, mean & max grade.
5. Feed each segment to `ADVICE()`.

---

## 5. App 1 — Guide Generator (backend)

### 5.1 Stack (suggested)
- Runtime: **Python (FastAPI)** or **Node (Express/Fastify)**. Pick one; spec stays agnostic.
- Storage: small DB (SQLite/Postgres) for users, tokens, profiles, generated-guide log.
- Hosting: any (the user runs Railway/Render elsewhere — fine).
- Libs: GPX parsing (`gpxpy` / `@tmcw/togeojson`), geo math, OAuth client, ZIP builder.

### 5.2 Components
1. **OAuth flow** — connect a user's Suunto account; store access/refresh tokens. **[VERIFY]**
   endpoints/scopes.
2. **Profile store** — VO₂max, threshold/max HR, zones, mass, poles, goal. Capture via a
   one-page form at connect time; optionally refine from FIT files (§3.3).
3. **Route webhook receiver** — on Suunto route-update notification: fetch GPX (§3.1),
   segment (§4.4), run `ADVICE()` per climb, build guide, push (§3.2).
4. **Guide builder** — emit `guide.json` + `icon.png` ZIP. Pattern per climb:
   - A "approach" FieldsStep that **transitions on `location` (or `distance`) ~150–250 m
     before the climb start**, firing a `notification`: e.g. `title:"Climb 600m"`,
     `text:"14% • power-hike • poles up • HR<155"`.
   - A "during-climb" FieldsStep showing `targetHeartRate{min,max}`, `verticalSpeed`,
     `stepDistanceCountdown` (= climb length), and a short `text` mode reminder.
   - Transition out on `stepDistance` ≈ climb length, or `location` at climb top.
   - Set `externalId` = route id; set `activities` to trail-run id **[VERIFY]**.
5. **Guide push client** — create/update via Guide Cloud API; handle the "update existing
   guide for this route" case (idempotency on `externalId`).

### 5.3 User flow (automatic model — preferred for v1)
1. User links Suunto account once (OAuth) + fills profile form.
2. User plans a route in the Suunto app as normal.
3. Webhook → backend generates the guide → pushed to user's account.
4. Watch syncs → guide appears. User selects it before starting the trail-run sport mode.
5. On the climb: notification fires ahead of time; HR gauge guides effort.

Optional **manual model**: a thin webapp where the user picks a route, edits profile, hits
"Generate". Same backend.

### 5.4 Edge cases
- GPX without elevation → reject + tell user (or fall back to DEM lookup). **[VERIFY]** GPX ele.
- Very long routes → many climbs → watch step/storage limits; cap or merge minor climbs.
- Route edited after guide generated → regenerate (idempotent on `externalId`).

---

## 6. App 2 — Live Sports App (on-watch)

### 6.1 Build environment
- **SuuntoPlus Editor** (VS Code extension, free, no signup). Create project via
  `SuuntoPlus: Create New SuuntoPlus App`; deploy with `SuuntoPlus: Deploy to Watch`
  (USB or BLE — unpair watch from the mobile app first for BLE). Simulator can feed HR,
  power, altitude, GPS, etc. Build artifact is `.fea` (or `.dev` if using external BLE).
- **[VERIFY] the exact watch JS API surface** — manifest schema, the `onLoad()`/`evaluate()`
  callbacks, and especially **the resource accessor names** for live data (HR, altitude,
  distance, GPS, vertical speed). The structure below is a *plausible template, not
  confirmed signatures.* Read the Editor docs and these example repos before coding:
  - `github.com/hefler/SuuntoApps`
  - `github.com/isazi/skitouring`
  - `github.com/osmufe/indoor-climbing`

### 6.2 Structure (template — verify against SDK)
- `manifest` — app name, sport modes, declared data resources, UI screens.
- `app.js` — logic with lifecycle callbacks:
  - `onLoad()` — init state, read profile config (set via Suunto mobile app settings).
  - `evaluate()` — called each tick: read live resources, update gradient & advice, render.
- `view.html` (+ CSS) — the watch screen template; fields bound to JS state.

### 6.3 Live gradient computation
The watch does not (confirmed) hand you a clean grade, so derive it:
```
grade = Δaltitude / ΔhorizontalDistance
```
- Use **barometric/fused altitude** where available (Race/Vertical have baro).
- **Smooth aggressively**: altitude is noisy. Use a window over the last ~20–40 m of
  horizontal travel (not a fixed time) so grade is stable at low speed. Clamp Δdist to avoid
  divide-by-near-zero when stationary.
- Optionally also track vertical speed as a sanity cross-check.

### 6.4 Advice state machine (live)
```
state ∈ { RUN, POWER_HIKE, HIKE_POLES }
each evaluate():
  g   = smoothedGrade()
  hr  = currentHR()
  rec = ADVICE({gradient:g, …}, profile)        // §4 shared core
  // HR override: if hr above per-zone ceiling for sustained period → bias toward hiking
  if hr > profile.thresholdHR for > T_OVER seconds and state==RUN: rec.mode = POWER_HIKE
  // hysteresis: require g to cross a band edge by ε for > T_DWELL seconds before switching
  if shouldSwitch(rec, state): state = rec.mode ; notify(state)
  render(state, g, hr, rec.targetHR)
```
- **Hysteresis + dwell time** are essential — without them the advice flaps at band edges on
  rolling terrain and becomes annoying/unsafe to read.
- Render compact: mode word + arrow, current grade %, HR vs target, maybe vertical speed.
- Persist nothing critical across switches except smoothing buffers; use the app's
  persistent storage for the user's profile/zone settings.

### 6.5 Lookahead caveat
**[VERIFY]** whether a Sports App can read the *active route's upcoming* profile. If not, the
live app only reacts to the current grade (no "climb ahead in 200 m"). In that case keep
lookahead in the Guide (App 1) and use the Sports App purely for live reaction — they
coexist (up to 2 SuuntoPlus apps per sport mode).

---

## 7. Profile & zones (shared)
- HR zones from `thresholdHR` or `maxHR` (let user choose model). Default 5-zone %HRmax or
  %LTHR.
- Per-climb HR ceiling: training/aerobic run → cap ~top of Z3 / just under threshold; race →
  allow Z4, brief Z5 on short climbs. Encode as a function of `goal`, climb length, and
  position in route (more conservative late).
- VO₂max → sustainable-power conversion is approximate; expose the fraction-of-VO₂max
  assumption as a tunable so the user can calibrate from felt effort.

---

## 8. Verification checklist (do these before/while building)
- [ ] GPX export from `/v2/route/{id}/export` contains `<ele>` elevation.
- [ ] Exact Guide Cloud API endpoints/auth/request shape (`SuuntoplusGuideCloudAPI.pdf`).
- [ ] OAuth endpoints + scopes (`apizone.suunto.com/how-to-start`).
- [ ] Trail-running `activity` id (`Activities.pdf`).
- [ ] Route webhook payload shape + how to register the Route Notification Url.
- [ ] Sports App watch JS API: resource accessors, manifest schema, UI binding — from Editor
      docs + example repos.
- [ ] Whether a Sports App can read the active route (lookahead).
- [ ] Minetti Cr polynomial coefficients (and a Cw model) against the source paper.
- [ ] Watch step/guide storage limits for long routes.

## 9. Build order
1. Shared `climb-advisor-core` + unit tests (golden cases: 5%/12%/18%/25%/35% climbs ×
   novice/elite × training/race).
2. GPX parse + climb segmentation, tested on a few real Tirol GPX files.
3. Guide builder → validate JSON against §2 → push to a test account → confirm on watch.
4. OAuth + webhook wiring → end-to-end automatic flow.
5. Sports App skeleton in the Editor simulator → live gradient + HR + state machine →
   on-watch test.

## 10. References (Suunto developer docs)
- SuuntoPlus overview: https://apizone.suunto.com/suuntoplus
- Sports Apps: https://apizone.suunto.com/suuntoplus-sports-apps
- Editor: https://apizone.suunto.com/suuntoplusEditor
- **Guide schema (authoritative for §2):** https://apizone.suunto.com/suuntoplus-guide-description
- Guide Cloud API PDF: linked from the guide-description page (SuuntoplusGuideCloudAPI.pdf)
- Routes API: https://apizone.suunto.com/route-description
- FIT files: https://apizone.suunto.com/fit-description
- Getting started / OAuth: https://apizone.suunto.com/how-to-start
- FAQ: https://apizone.suunto.com/faq

### Science
- Minetti AE et al. (2002), *Energy cost of walking and running at extreme uphill and
  downhill slopes*, J Appl Physiol 93:1039–1046.
- Giovanelli N et al., *Do poles save energy during steep uphill walking?* (Eur J Appl
  Physiol).
- Vertical-kilometer walk/run economy work (Ortiz, Giovanelli et al.) for the
  speed-dependent crossover.
