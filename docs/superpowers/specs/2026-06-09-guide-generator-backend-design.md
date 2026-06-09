# Guide Generator Backend — Design

**Date:** 2026-06-09
**Source of truth:** `trailrun-climb-advisor-SPEC.md` (§1–§10)
**Scope:** App 1 — the full SuuntoPlus *Guide* Generator backend (§5), including the
shared decision core (§4), GPX parsing + climb segmentation (§4.4), guide building (§2),
OAuth, route webhook, and Guide Cloud API push.

Out of scope this session: App 2 (on-watch Live Sports App, §6).

---

## Decisions taken during brainstorming

| Decision | Choice | Rationale |
|---|---|---|
| Language / stack | **TypeScript**, Node + Fastify + better-sqlite3 | §4 requires the decision core to be shared with the watch (JS) app. A TS core mirrors to the watch with no language port, eliminating the drift risk §4 warns about. |
| `[VERIFY]` external seams | **Build as-is to the spec's documented shapes** | User chose best-effort over an adapter layer. Guessed ids/paths are centralized in `suunto/constants.ts` and marked, but no abstraction is built over them. |
| Persistence | **SQLite** via a thin query layer | Zero infra, runs anywhere (Railway/Render). Query layer keeps a later Postgres swap mechanical. |
| UI surface | **Minimal**: OAuth connect page + one-page profile form | Smallest correct surface for the automatic flow. Built via the `/frontend-design` skill. |
| Local verifiability | **CLI `generate-guide <file.gpx>` + committed sample GPX** | Proves the full pipeline offline with no Suunto credentials; doubles as the §9 step 1–3 harness. |

---

## 1. Architecture

Single TypeScript package. The scientific core (`src/core/`) is **pure, no I/O** so it can
be mirrored verbatim to the watch Sports App later (§4 consistency requirement).

```
src/
  core/         climb-advisor-core — PURE, no I/O (the §4 heart)
    config.ts       all tunable thresholds + scientific-rationale comments
    energetics.ts   Minetti Cr(i), walking cost, VO2max→power, v_run()
    advice.ts       ADVICE() banding + hysteresis + fatigue, hr_ceiling()
    types.ts        Segment, Profile, Live, Advice
  gpx/
    parse.ts        GPX → {lat,lon,ele,cumDist}[]; rejects missing <ele>
    segment.ts      resample → smooth → grade → classify → merge climbs
  guide/
    builder.ts      segments + advice → guide.json (cruise/climb step pattern)
    schema.ts       validate against §2 limits before emit
    zip.ts          guide.json + icon.png (300×300) → ZIP
  suunto/         external clients, built as-is to spec shapes
    oauth.ts        OAuth connect + token refresh
    routes.ts       GET /v2/route/{id}/export (GPX)
    guideCloud.ts   create / update / list / delete guides
    constants.ts    GUESSED ids/paths/scopes — all [VERIFY] values live here
  db/             SQLite schema + thin query layer (users, tokens, profiles, guideLog)
  server/         Fastify: /connect, /oauth/callback, /profile (GET/POST), /webhook/route
  web/            two pages (connect, profile form) — built via /frontend-design
  cli/            generate-guide <file.gpx> — offline pipeline → ZIP on disk
test/             golden cases, segmentation fixtures, schema validation
fixtures/         sample Tirol GPX
```

### Module contracts (what / how-used / depends-on)

- **core** — *what:* turns one climb `Segment` + `Profile` into `{mode, poles, targetHR}`.
  *used:* `ADVICE(segment, profile)`. *depends:* nothing (pure).
- **gpx/parse** — *what:* GPX text → resampled, distance-stamped point array; throws on
  missing elevation. *depends:* a GPX/XML parser only.
- **gpx/segment** — *what:* point array → `Segment[]` (climbs only). *depends:* core/types.
- **guide/builder** — *what:* `Segment[]` + per-segment `Advice` + `Profile` →
  `guide.json` object. *depends:* core/types, guide/schema.
- **guide/zip** — *what:* guide object + icon → ZIP buffer. *depends:* a zip lib.
- **suunto/\*** — *what:* HTTP clients to Suunto Cloud APIs. *depends:* db (tokens).
- **db** — *what:* persistence for users/tokens/profiles/guideLog. *depends:* better-sqlite3.
- **server** — *what:* HTTP wiring of the above. *depends:* all of the above.

---

## 2. Data flow

**Automatic (live):**
1. OAuth connect → store access/refresh tokens.
2. User fills profile form (VO₂max, threshold/max/rest HR, zones, mass, poles, goal).
3. Suunto route-update **webhook** → backend fetches GPX (`/v2/route/{id}/export`).
4. Segment climbs (§4.4) → run `ADVICE()` per climb.
5. Build `guide.json` + icon → ZIP → push via Guide Cloud API, **idempotent on
   `externalId` = route id** (update if a guide already exists for that route).
6. Log generation. Watch syncs on next mobile-app sync; user selects guide before the run.

**Offline (CLI — fully verifiable without credentials):**
`generate-guide route.gpx --profile profile.json` → parse → segment → advice → build →
ZIP written to disk for inspection. No network.

---

## 3. Guide structure (§2, §5.2.4)

The guide is a top-level `sequence` object (`type:"sequence"`, `usage:"workout"`,
`externalId` = route id) whose `steps` alternate:

- **Cruise step** (`FieldsStep`) — covers the flat/descent run-up to the next climb.
  A transition fires on `location` (or `distance`) **~200 m before the climb start**,
  carrying a `notification`:
  - `title`: `"Climb 600m"` (≤13 chars)
  - `text`: `"14% · power-hike · poles up · HR<155"` (≤54 chars)
- **Climb step** (`FieldsStep`) — fields: `targetHeartRate{min,max}` (the baked HR ceiling),
  `verticalSpeed`, `stepDistanceCountdown` (= climb length), and a short mode-reminder
  `text`. Transition out on `stepDistance ≈ climb length` (with a `location` fallback at the
  climb top).

The first step is the cruise step to the first climb. All physiological personalization is
**baked at generation time** — the guide cannot branch on live HR/gradient (§2.3 hard limit).

---

## 4. Decision core detail (§4)

- **config.ts** holds every tunable with a rationale comment: `G_RUN_MAX=0.12`,
  `G_HIKE_MAX=0.22`, `G_POLES=0.25`, `V_CROSS=0.78` m/s, `L_LONG`, per-zone HR caps, and the
  fraction-of-VO₂max sustainable-power assumption.
- **energetics.ts** implements the Minetti Cr(i) 5th-order polynomial **exactly as the spec
  documents it**, with a code comment marking it `[VERIFY coefficients] — shape model, not
  ground truth`. Also: walking cost, VO₂max→sustainable power, `v_run(g, profile)`.
- **advice.ts** implements the §4.3 algorithm: `v_run` + crossover test, then grade-banding
  with `fitnessShift` and `fatigue` adjustments, poles rule, and `hr_ceiling(profile, goal,
  segment)`. Hysteresis params live in config (used live by App 2 later; in the Guide the
  banding is evaluated once per climb at generation time).

---

## 5. Error handling (§5.4)

- **GPX without `<ele>`** → reject with a clear, user-facing message (no silent DEM fallback
  in v1).
- **Very long routes** → segmentation min-length / min-vertical filter drops micro-climbs;
  a hard cap keeps `steps ≤ 1000` (merge the smallest remaining climbs if exceeded, and
  `log()` what was merged — no silent truncation).
- **Route edited after generation** → regenerate; idempotent on `externalId`.
- **OAuth 401** → refresh-token retry once, then surface the error.

---

## 6. Testing (§9 build order)

1. **Core golden cases:** grades {5, 12, 18, 25, 35}% × {novice, elite} × {training, race}
   → assert `{mode, poles, targetHR}` falls in the expected band.
2. **Segmentation:** the committed fixture GPX → expected climb count and start/length/
   vertical bounds.
3. **Schema validation:** every generated guide checked against all §2 constraints
   (char limits, required fields, step count, condition/field shapes).
4. **ZIP:** archive contains exactly `guide.json` + `icon.png`, both valid.

---

## 7. Known guesses (carried as-is from spec [VERIFY] markers)

These are implemented to the documented shape and centralized where noted; they need live
SDK/portal confirmation before production use:

- Trail-run **activity id** (`Activities.pdf`) → `suunto/constants.ts`.
- **OAuth** endpoints/scopes (`apizone.suunto.com/how-to-start`) → `suunto/oauth.ts` +
  `constants.ts`.
- **Guide Cloud API** endpoint paths + request shape, ZIP-upload vs JSON
  (`SuuntoplusGuideCloudAPI.pdf`) → `suunto/guideCloud.ts`.
- **Route webhook** payload shape + Route Notification Url registration → `server/webhook`.
- **GPX `<ele>` presence** on exported routes → asserted/validated in `gpx/parse.ts`.
- **Minetti Cr polynomial** coefficients → `core/energetics.ts`.

## 8. Build order (this session)

1. Project scaffold (package.json, tsconfig, test runner).
2. `core/` + golden-case tests (verify before moving on).
3. `gpx/` parse + segment + fixture test.
4. `guide/` builder + schema + zip + validation test.
5. `cli/` generate-guide → end-to-end offline ZIP (the verifiable milestone).
6. `db/` + `suunto/` clients (built as-is, not network-tested this session).
7. `server/` wiring + `web/` two pages (via /frontend-design).
