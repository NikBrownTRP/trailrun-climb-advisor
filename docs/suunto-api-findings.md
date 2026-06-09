# Suunto API — Verified Findings (researched June 2026)

Research pass to replace the spec's `[VERIFY]` guesses with confirmed facts. Each item is
tagged CONFIRMED (with source) or UNCONFIRMED. **Cloud API access requires Suunto Partner
Program enrollment** (~2-week approval); there is no open/personal tier.

---

## Part A — Cloud API (App 1, Guide Generator)

### Corrections applied to the code
| Constant / behavior | Old guess | Confirmed value | Source |
|---|---|---|---|
| `TRAIL_RUN_ACTIVITY_ID` | `13` | **`22`** (running=1, hiking=11, cycling=2) | real workout data, `github.com/tajchert/suuntool` |
| Guide Cloud endpoint | `/v2/suuntoplus/guides` | **`POST /v2/guides/files`** | `forum.suunto.com/topic/11971` |
| Guide upload encoding | multipart/form-data | **raw body, `Content-Type: application/zip`** (ZIP must contain `guide.json` or API rejects) | `forum.suunto.com/topic/11971` |
| OAuth user identifier | top-level `user` field on token JSON | **`user` claim *inside* the JWT `access_token`** — a Suunto **username string**, not numeric | `apizone.suunto.com/how-to-start` |
| Route webhook payload | `{ userId, route:{id} }` | **`{ type, username, route:{ id, description, activityIds, startPoint…, totalDistance, … } }`** (JSON) | `apizone.suunto.com/webhooks`, `/route-description` |

### Confirmed correct (no change)
- `CLOUD_API_BASE = https://cloudapi.suunto.com` — CONFIRMED (`/route-description`).
- `OAUTH_AUTHORIZE_URL = https://cloudapi-oauth.suunto.com/oauth/authorize` — CONFIRMED (`/how-to-start`).
- `OAUTH_TOKEN_URL = https://cloudapi-oauth.suunto.com/oauth/token` — CONFIRMED.
- `OAUTH_SCOPES = "workout"`, grant = authorization_code — CONFIRMED.
- `Ocp-Apim-Subscription-Key` is required on **all `cloudapi.suunto.com` data calls** but **NOT** on the OAuth token endpoint — CONFIRMED. (Our `tokenRequest` correctly omits it.)
- Route export `GET /v2/route/{id}/export` + `Accept: application/gpx+xml` — CONFIRMED (`/route-description`). Route list: `GET /v2/route`.
- Guide ZIP = `guide.json` + `icon.png` (300×300) — CONFIRMED (`/suuntoplus-guide-description`).
- Webhook registration: set a **Route Notification Url** in the developer portal (no self-service API). **Polling is explicitly prohibited** — must use the webhook.

### Still UNCONFIRMED
- Whether the exported GPX carries **per-point `<ele>`** (route object stores start/center/end altitude for sure; per-point is unconfirmed). Our parser defensively rejects GPX without `<ele>` — correct either way.
- Guide Cloud **list / update / delete** endpoint paths (only `POST /v2/guides/files` create is confirmed). Our `listGuides`/`updateGuide`/`deleteGuide` use inferred `GET`/`PUT`/`DELETE /v2/guides/files[/{id}]` — marked in code.
- Rate limits; Partner Program cost.

Sources: [how-to-start](https://apizone.suunto.com/how-to-start) · [route-description](https://apizone.suunto.com/route-description) · [webhooks](https://apizone.suunto.com/webhooks) · [guide-description](https://apizone.suunto.com/suuntoplus-guide-description) · [faq](https://apizone.suunto.com/faq) · [forum 11971](https://forum.suunto.com/topic/11971/api-suunto) · [suuntool](https://github.com/tajchert/suuntool)

---

## Part B — Sports App runtime (App 2, on-watch)

Primary reference: community mirror of the SuuntoPlus Editor docs at `github.com/aabbeell/suuntopo` (`reference/suuntoplus_reference_docs.md`), corroborated by working apps (`isazi/skitouring`) and the Suunto forum.

### Runtime constraints — CRITICAL
- **JS engine: Duktape, ES5 ONLY.** No `let`/`const`, no arrow functions, no `**` (use `Math.pow`), no template literals, no default params, no `Date`, no `fetch`, no `sessionStorage`. Top-level `function` names are reserved for lifecycle callbacks — declare helpers as `var fn = function(){}`.
- Typed arrays available (`Int8Array`, `Uint8Array`, `Float32Array`). Heap/stack are tight; crashes from exhaustion are common.
- **Implication:** `src/core` (ES2022) must be **hand-ported to an ES5 twin** for the watch — it cannot be imported/copied as-is.

### Manifest (`manifest.json`)
Required: `name` (≤60B), `version` (≤4 chars), `author`, `description` (≤100B), `type` (`"feature"` no-BLE / `"device"` BLE), `usage` (`"workout"`), `modificationTime` (epoch s), `template` (`[{name:"t.html", displays?:["q",…]}]`).
Optional: `in` (≤10 input resources `{name, source, type:"subscribe"}`), `out` (≤25 outputs, ≤5 logged), `settings` (user-editable in mobile app: `{shownName, path, type:int|float|string|boolean|enum, min/max/values…}`), `variables`, `image` (≤2 PNG, ≤64 colors).
**No sport-mode filter field exists** in the Sports App manifest.

### Lifecycle (declared as top-level functions)
`onLoad(input,output)` (once) → `evaluate(input,output)` (**every ~1 s**, runs even before exercise start) → `getUserInterface(input,output)` (**MANDATORY**, returns `{template}`) → `onExerciseStart` / `onLap` / `onAutoLap` / `onExercisePause` / `onExerciseContinue` / `onExerciseEnd` → `getSummaryOutputs`. Optional `onEvent(input,output,id)` (button), `onAccelerometer`.

### Live data accessors (declare in `in`, read as `input.<name>`)
- **HR:** `Activity/Move/-1/HeartRate/Current` → **Float in Hz (×60 for bpm)**. Also `/Settings/User/MaxHR`.
- **Altitude (fused baro+GPS):** `/Fusion/Altitude` (m); ascent `/Fusion/Altitude/Ascent`; **vertical speed `/Fusion/Altitude/VerticalSpeed` (m/s)**.
- **Distance:** `/Activity/Current/Distance` (Uint32 m).
- **GPS:** `/Fusion/Location/GeoCoordinates` → `{latitude,longitude}` as int32 ×10⁷.
- **Speed:** `/Activity/Current/Speed` (m/s). **Cadence/Power** under `/Activity/Current/…`.
- **Exercise state:** `/Activity/Exercise/State` (0 Idle/1 Started/2 Paused/3 Prestart).

### Route lookahead — partial
When `/Navigation/State` is 3 (on route) or 7 (snap), available: `Navigation/Routes/NavigatedRoute/RemainAscent`, `RemainDescent`, `DistanceToDestination`, `ETA`, `ETE`, `Position`, `ClosestPoint`, plus whole-route `TotalAscent`/`TotalDescent`/`MinAltitude`/`MaxAltitude`.
**NOT available:** a per-point elevation-profile array of the route ahead. → Detailed "climb ahead" lookahead stays in the Guide (App 1); the live app uses under-foot gradient + scalar remaining ascent.

### UI binding (`t.html`)
Root `<uiView>`. Bind data with `<eval input="/path/or/Zapp/{zapp_index}/Output/<name>" outputFormat="HeartRate_Fourdigits" default="--" />`. Outputs map to `Zapp/{zapp_index}/Output/<name>`. Compile-time conditionals `<:if test="{APP_IS_DISPLAY_LARGE}">`. `<canvas>` (UI2) and `<graph>` available. CSS uses `%` + custom `%e` unit; predefined font classes (`sp-d-m`, `sp-t-m`, `f-num`…).

### Persistence / settings
`localStorage.getItem/setItem` (strings) and `localStorage.getObject/setObject` (JSON). Settings declared in manifest `settings[]` are edited in the Suunto mobile app and read via `localStorage`.

### Build / deploy
SuuntoPlus Editor (VS Code ext). Build minifies `main.js` and emits one `.fea` per display + a `.zip`. `.dev` for BLE apps. Deploy via USB or BLE (unpair from mobile app first). **Syncing the watch with the Suunto mobile app deletes side-loaded apps.** Simulator replays FIT/Suunto-JSON and injects sensor values.

### Display targets (build per display)
Active UI2: `n` 240×240 (9 Peak Pro), `o` 280×280 (Vertical), `q` 466×466 (Race / Race S / Race 2 / Vertical 2 / Ocean). UI1 (`s`/`m`/`l`) deprecated.

### Verify on real hardware
- Per-point route elevation ahead (none found — confirm no undocumented accessor).
- Exact JS heap/stack byte limits.
- `onInterval()` trigger conditions; `/Activity/Log/...` historical query params.
- App-store submission signing/vetting (vs USB sideload).

Sources: [aabbeell/suuntopo](https://github.com/aabbeell/suuntopo) · [forum 14770](https://forum.suunto.com/topic/14770/examples-explained) · [isazi/skitouring](https://github.com/isazi/skitouring) · [how-to-get-started](https://forum.suunto.com/topic/14651/how-to-get-started) · [editor docs](https://apizone.suunto.com/suuntoplusEditor)
