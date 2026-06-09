# Trail-Run Climb Advisor — Guide Generator

Backend service that turns a planned Suunto route into a **profile-personalized SuuntoPlus
Guide**: it reads the route's GPX elevation, segments the climbs, and bakes
**run / power-hike / hike-with-poles** advice plus a **target-HR gauge** onto the watch as
position-triggered notifications.

This repo implements **App 1** (the Guide Generator) from
[`trailrun-climb-advisor-SPEC.md`](trailrun-climb-advisor-SPEC.md). The on-watch Live Sports
App (App 2) is out of scope here.

> The decision core (`src/core`) is pure and dependency-free by design, so it can later be
> mirrored verbatim into the watch JS app — keeping the advice identical across both (SPEC §4).

## Architecture

```
src/
  core/      Pure decision core — Minetti energetics + ADVICE() banding (no I/O)
  gpx/       GPX parse + climb segmentation (resample, smooth, hysteresis)
  guide/     guide.json builder, zod schema (SPEC §2 limits), icon + ZIP packaging
  suunto/    OAuth / Routes export / Guide Cloud API clients  (build-as-is, see [VERIFY])
  db/        SQLite store (users, tokens, profiles, guide log)
  pipeline.ts  GPX text + profile -> validated guide + ZIP  (shared by CLI and webhook)
  cli/       generate-guide — offline pipeline, no network
  server/    Fastify: /connect, /oauth/callback, /profile, /webhook/route
  web/       connect + profile-form pages
```

## Requirements

- Node 20+
- `npm install` (builds the native `better-sqlite3` addon)

## Test

```bash
npm test          # vitest — core golden cases, segmentation, guide schema, pipeline
npm run typecheck # tsc --noEmit
```

## Generate a guide offline (no Suunto account needed)

This exercises the entire science→guide pipeline locally and writes an inspectable ZIP:

```bash
npm run generate-guide fixtures/tirol-sample.gpx --name "Tirol sample"
#   options: --profile <p.json>  --out <guide.zip>  --route-id <ID>  --name <NAME>
```

Output: `guide.zip` (containing `guide.json` + `icon.png`) and a pretty-printed
`guide.guide.json`. Example console output:

```
Wrote guide.zip — 2 climb(s).
  • Climb 510m: 13% · run · HR<160
  • Climb 465m: 25% · hike · poles · HR<160
```

A sample profile lives at [`fixtures/profile.sample.json`](fixtures/profile.sample.json).

## Run the server

```bash
npm run dev       # tsx watch src/server/index.ts
```

Then open `http://localhost:3000/connect`.

### Environment variables

| Var | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port | `3000` |
| `DB_PATH` | SQLite file path | `data.db` |
| `SUUNTO_CLIENT_ID` | OAuth client id (Suunto Partner) | `""` |
| `SUUNTO_CLIENT_SECRET` | OAuth client secret | `""` |
| `SUUNTO_REDIRECT_URI` | OAuth callback URL | `http://localhost:3000/oauth/callback` |
| `SUUNTO_SUBSCRIPTION_KEY` | `Ocp-Apim-Subscription-Key` for Cloud APIs | `""` |

### Automatic flow (SPEC §5.3)

1. User opens `/connect` → links their Suunto account (OAuth) → fills the profile form.
2. User plans a route in the Suunto app.
3. Suunto's route-update webhook hits `POST /webhook/route` → the backend fetches the GPX,
   segments climbs, runs `ADVICE()`, builds the guide, and pushes it (idempotent on
   `externalId` = route id).
4. The watch syncs and the guide appears; the runner selects it before the trail-run.

## ⚠️ Unverified items — confirm before any production / live use

The four external Suunto seams were built to the spec's *documented* shapes but could **not**
be exercised without a live Suunto Partner account. They are coded as-is, with the guessed
values centralized in [`src/suunto/constants.ts`](src/suunto/constants.ts). Per SPEC §8,
verify the following before relying on them:

- [ ] **GPX `<ele>`** present on `/v2/route/{id}/export` output (the whole pipeline depends on it).
- [ ] **Guide Cloud API** endpoint paths + whether create/update is **ZIP multipart vs JSON**
      (`SuuntoplusGuideCloudAPI.pdf`). Current code assumes multipart ZIP at
      `/v2/suuntoplus/guides`.
- [ ] **OAuth** authorize/token endpoints + scopes (`apizone.suunto.com/how-to-start`), and
      the user-id field name on the token response.
- [ ] **Trail-running `activity` id** (`Activities.pdf`) — currently `TRAIL_RUN_ACTIVITY_ID = 13`.
- [ ] **Route webhook** payload shape + how to register the Route Notification Url.
- [ ] **Minetti Cr polynomial** coefficients vs the source paper (treated as a shape model).
- [ ] **Watch step/guide storage limits** for very long routes (current cap: ≤1000 steps,
      smallest climbs dropped if exceeded).

## Scientific basis

- Minetti AE et al. (2002), *Energy cost of walking and running…*, J Appl Physiol 93:1039–1046.
- Giovanelli N et al., *Do poles save energy during steep uphill walking?*
- Vertical-kilometer walk/run economy work (Ortiz, Giovanelli) for the speed-dependent crossover.

All tunable thresholds live in [`src/core/config.ts`](src/core/config.ts) with rationale.
