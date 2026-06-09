# Guide Generator Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the SuuntoPlus *Guide* Generator backend (App 1): a TypeScript service that turns a planned Suunto route into a profile-personalized, schema-valid SuuntoPlus Guide.

**Architecture:** A pure, dependency-free decision core (`src/core`) drives the science. GPX parsing/segmentation (`src/gpx`) feeds climbs to it; a guide builder (`src/guide`) bakes the advice into `guide.json` + ZIP. A CLI (`src/cli`) runs the whole pipeline offline. The live integration layer (`src/db`, `src/suunto`, `src/server`, `src/web`) wires OAuth, a route webhook, and the Guide Cloud API — built to the spec's documented (some `[VERIFY]`) shapes.

**Tech Stack:** Node 20 + TypeScript (ESM), Fastify, better-sqlite3, fast-xml-parser, jszip, zod, pngjs. Tests: vitest. Run/CLI: tsx.

---

## File Structure

```
package.json, tsconfig.json, vitest.config.ts, .gitignore
src/
  core/        config.ts  types.ts  energetics.ts  advice.ts  index.ts
  gpx/         parse.ts   segment.ts
  guide/       schema.ts  builder.ts  zip.ts  icon.ts
  db/          schema.ts  store.ts
  suunto/      constants.ts  oauth.ts  routes.ts  guideCloud.ts
  pipeline.ts  (route id/GPX text + profile -> guide ZIP; shared by webhook + CLI)
  cli/         generate-guide.ts
  server/      app.ts  index.ts
  web/         connect.html  profile.html
test/
  core.advice.test.ts  gpx.segment.test.ts  guide.builder.test.ts  guide.schema.test.ts  pipeline.test.ts
fixtures/      tirol-sample.gpx  profile.sample.json
```

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "trailrun-climb-advisor",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "generate-guide": "tsx src/cli/generate-guide.ts",
    "dev": "tsx watch src/server/index.ts",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "fastify": "^4.28.1",
    "@fastify/formbody": "^7.4.0",
    "@fastify/static": "^7.0.4",
    "better-sqlite3": "^11.3.0",
    "fast-xml-parser": "^4.5.0",
    "jszip": "^3.10.1",
    "zod": "^3.23.8",
    "pngjs": "^7.0.0"
  },
  "devDependencies": {
    "typescript": "^5.6.2",
    "tsx": "^4.19.1",
    "vitest": "^2.1.1",
    "@types/node": "^20.16.5",
    "@types/better-sqlite3": "^7.6.11",
    "@types/pngjs": "^6.0.5"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
```

- [ ] **Step 4: Install and verify**

Run: `npm install && npx tsc --noEmit && npx vitest run`
Expected: install succeeds; tsc prints nothing (no src yet); vitest reports "No test files found" (exit 0 or 1 — acceptable, just confirms it runs).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts
git commit -m "chore: project scaffold (TS + vitest + deps)"
```

---

## Task 2: Core types and config

**Files:**
- Create: `src/core/types.ts`, `src/core/config.ts`

- [ ] **Step 1: Create `src/core/types.ts`**

```typescript
// Shared decision-core types (SPEC §4.1). PURE — no I/O imports here.

export type Mode = "RUN" | "POWER_HIKE" | "HIKE";
export type Experience = "novice" | "intermediate" | "elite";
export type Goal = "training" | "race";

/** One climb segment (SPEC §4.1). gradient is a fraction, e.g. 0.14 = 14%. */
export interface Segment {
  gradient: number;            // mean grade, fraction
  maxGradient?: number;        // optional max grade within the climb, fraction
  length: number;              // horizontal length, m
  vertical: number;            // elevation gain, m
  cumulativeAscentBefore: number; // m climbed earlier in the route
  distanceIntoRoute: number;   // m from route start to climb start
  startLat?: number;
  startLon?: number;
  topLat?: number;
  topLon?: number;
}

/** Runner physiological profile (SPEC §4.1, §7). */
export interface Profile {
  vo2max: number;       // ml/kg/min
  thresholdHR: number;  // bpm
  maxHR: number;        // bpm
  restHR: number;       // bpm
  bodyMass: number;     // kg
  hasPoles: boolean;
  experience: Experience;
  goal: Goal;
}

/** Output of ADVICE(). targetHR is the baked per-climb HR ceiling for the gauge. */
export interface Advice {
  mode: Mode;
  poles: boolean;
  targetHR: { min: number; max: number };
}
```

- [ ] **Step 2: Create `src/core/config.ts`**

```typescript
// All tunable thresholds in ONE place (SPEC §4.3 requirement).
// Each value carries its scientific rationale. Defaults are SPEC §4.3 values.

export interface CoreConfig {
  /** Grade ceiling for running on flat-fitness baseline (fraction). SPEC §4.3 default 0.12. */
  G_RUN_MAX: number;
  /** Grade ceiling for power-hiking; above this, hike (fraction). SPEC default 0.22. */
  G_HIKE_MAX: number;
  /** Grade at/above which poles help metabolically (fraction). SPEC default 0.25.
   *  Below this, poles only offload legs / delay fatigue (Giovanelli). */
  G_POLES: number;
  /** Walk<->run crossover speed (m/s). Below it walking is cheaper (Ortiz/Giovanelli VK). */
  V_CROSS: number;
  /** A "long" climb where poles help offload even if not steep (m). */
  L_LONG: number;
  /** Fraction of VO2max sustainable for the climb, by goal.
   *  training ~ threshold; race climbs are short -> higher. SPEC §4.3.1, §7. */
  P_SUS_FRACTION: Record<"training" | "race", number>;
  /** Steepens the run/hike bands for fitter runners (fraction added to gRun/gHike). */
  EXPERIENCE_SHIFT: Record<"novice" | "intermediate" | "elite", number>;
  /** Per-ml-O2 energy equivalent, J/ml (energetics conversion). */
  J_PER_ML_O2: number;
}

export const DEFAULT_CONFIG: CoreConfig = {
  G_RUN_MAX: 0.12,
  G_HIKE_MAX: 0.22,
  G_POLES: 0.25,
  V_CROSS: 0.78,
  L_LONG: 400,
  P_SUS_FRACTION: { training: 0.85, race: 0.92 },
  EXPERIENCE_SHIFT: { novice: 0.0, intermediate: 0.02, elite: 0.04 },
  J_PER_ML_O2: 20.9,
};
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
git add src/core/types.ts src/core/config.ts
git commit -m "feat(core): decision-core types and tunable config"
```

---

## Task 3: Energetics (Minetti curve, v_run)

**Files:**
- Create: `src/core/energetics.ts`
- Test: `test/core.advice.test.ts` (energetics section)

- [ ] **Step 1: Write the failing test** — create `test/core.advice.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { costOfRunning, sustainablePowerWkg, vRun } from "../src/core/energetics";
import { DEFAULT_CONFIG } from "../src/core/config";
import type { Profile } from "../src/core/types";

const elite: Profile = {
  vo2max: 70, thresholdHR: 170, maxHR: 190, restHR: 45, bodyMass: 65,
  hasPoles: true, experience: "elite", goal: "race",
};

describe("energetics", () => {
  it("Minetti Cr is ~3.6 J/kg/m on the flat and rises with grade", () => {
    expect(costOfRunning(0)).toBeCloseTo(3.6, 1);
    expect(costOfRunning(0.2)).toBeGreaterThan(costOfRunning(0.1));
    expect(costOfRunning(0.1)).toBeGreaterThan(costOfRunning(0));
  });

  it("sustainable power scales with VO2max and goal fraction", () => {
    const p = sustainablePowerWkg(elite, DEFAULT_CONFIG);
    // 70 ml/kg/min * 20.9 J/ml / 60 s * 0.92 race fraction ≈ 22.4 W/kg
    expect(p).toBeCloseTo(70 * 20.9 / 60 * 0.92, 1);
  });

  it("v_run decreases as grade steepens", () => {
    expect(vRun(0.05, elite, DEFAULT_CONFIG)).toBeGreaterThan(vRun(0.2, elite, DEFAULT_CONFIG));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/core.advice.test.ts`
Expected: FAIL — cannot resolve `../src/core/energetics`.

- [ ] **Step 3: Write `src/core/energetics.ts`**

```typescript
import type { Profile } from "./types";
import type { CoreConfig } from "./config";

// Minetti AE et al. (2002) net cost of running vs gradient, J·kg⁻¹·m⁻¹.
// 5th-order polynomial in gradient fraction i.
// [VERIFY coefficients] against the source paper — treat as a SHAPE model, not
// absolute ground truth (SPEC §4.2).
export function costOfRunning(i: number): number {
  return (
    155.4 * i ** 5 -
    30.4 * i ** 4 -
    43.3 * i ** 3 +
    46.3 * i ** 2 +
    19.5 * i +
    3.6
  );
}

/** Sustainable metabolic power in W/kg (SPEC §4.3 step 1).
 *  VO2max[ml/kg/min] -> W/kg via J_PER_ML_O2, scaled by goal's sustainable fraction. */
export function sustainablePowerWkg(profile: Profile, cfg: CoreConfig): number {
  const aerobicMax = (profile.vo2max * cfg.J_PER_ML_O2) / 60; // W/kg at VO2max
  return aerobicMax * cfg.P_SUS_FRACTION[profile.goal];
}

/** Estimated sustainable uphill RUNNING speed at grade g, m/s (SPEC §4.3 step 2). */
export function vRun(g: number, profile: Profile, cfg: CoreConfig): number {
  return sustainablePowerWkg(profile, cfg) / costOfRunning(g);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/core.advice.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add src/core/energetics.ts test/core.advice.test.ts
git commit -m "feat(core): Minetti energetics and v_run"
```

---

## Task 4: ADVICE() banding + HR ceiling

**Files:**
- Create: `src/core/advice.ts`, `src/core/index.ts`
- Test: append to `test/core.advice.test.ts`

- [ ] **Step 1: Append failing golden-case tests to `test/core.advice.test.ts`**

```typescript
import { advise } from "../src/core/advice";
import type { Segment } from "../src/core/types";

const novice: Profile = {
  vo2max: 42, thresholdHR: 160, maxHR: 185, restHR: 60, bodyMass: 80,
  hasPoles: true, experience: "novice", goal: "training",
};

function seg(gradient: number, length = 600): Segment {
  return {
    gradient, length, vertical: gradient * length,
    cumulativeAscentBefore: 0, distanceIntoRoute: 1000,
  };
}

describe("ADVICE golden cases (SPEC §9)", () => {
  it("gentle 5% grade: everyone runs", () => {
    expect(advise(seg(0.05), novice).mode).toBe("RUN");
    expect(advise(seg(0.05), elite).mode).toBe("RUN");
  });

  it("12% grade: novice power-hikes, elite runs (fitness shift)", () => {
    expect(advise(seg(0.12), novice).mode).toBe("POWER_HIKE");
    expect(advise(seg(0.12), elite).mode).toBe("RUN");
  });

  it("18% grade: power-hike for all", () => {
    expect(advise(seg(0.18), novice).mode).toBe("POWER_HIKE");
    expect(advise(seg(0.18), elite).mode).toBe("POWER_HIKE");
  });

  it("25% grade: novice hikes, elite still power-hikes", () => {
    expect(advise(seg(0.25), novice).mode).toBe("HIKE");
    expect(advise(seg(0.25), elite).mode).toBe("POWER_HIKE");
  });

  it("35% grade: everyone hikes with poles", () => {
    expect(advise(seg(0.35), novice).mode).toBe("HIKE");
    expect(advise(seg(0.35), elite).mode).toBe("HIKE");
    expect(advise(seg(0.35), novice).poles).toBe(true);
  });

  it("poles engage at/above G_POLES when the runner carries them", () => {
    expect(advise(seg(0.26), novice).poles).toBe(true);
    const noPoles = { ...novice, hasPoles: false };
    expect(advise(seg(0.26), noPoles).poles).toBe(false);
  });

  it("race targetHR ceiling is higher than training", () => {
    const t = advise(seg(0.18), { ...elite, goal: "training" }).targetHR.max;
    const r = advise(seg(0.18), { ...elite, goal: "race" }).targetHR.max;
    expect(r).toBeGreaterThan(t);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/core.advice.test.ts`
Expected: FAIL — cannot resolve `../src/core/advice`.

- [ ] **Step 3: Write `src/core/advice.ts`**

```typescript
import type { Advice, Profile, Segment } from "./types";
import { DEFAULT_CONFIG, type CoreConfig } from "./config";
import { vRun } from "./energetics";

/** Steepens run/hike bands for fitter runners (SPEC §4.3 fitnessShift). */
function fitnessShift(profile: Profile, cfg: CoreConfig): number {
  const expShift = cfg.EXPERIENCE_SHIFT[profile.experience];
  const vo2Shift = Math.max(-0.02, Math.min(0.02, (profile.vo2max - 50) * 0.001));
  return expShift + vo2Shift;
}

/** Late/accumulated-climb fatigue narrows the run band (SPEC §4.3 g_fatigue).
 *  Race tolerates more before fatiguing the bands than training. */
function fatigue(seg: Segment, profile: Profile): number {
  const ascentTerm = Math.min(0.04, seg.cumulativeAscentBefore / 1000 * 0.02);
  const goalFactor = profile.goal === "race" ? 0.6 : 1.0;
  return ascentTerm * goalFactor;
}

/** Per-climb HR ceiling for the gauge (SPEC §4.3 hr_ceiling, §7). */
function hrCeiling(profile: Profile, seg: Segment): { min: number; max: number } {
  const thr = profile.thresholdHR;
  if (profile.goal === "race") {
    const shortClimb = seg.length < 400;
    const max = Math.min(profile.maxHR, thr + (shortClimb ? 12 : 5));
    return { min: thr - 8, max };
  }
  // training: cap around top of Z3 / just under threshold
  return { min: thr - 20, max: thr - 5 };
}

export function advise(seg: Segment, profile: Profile, cfg: CoreConfig = DEFAULT_CONFIG): Advice {
  const g = seg.gradient;
  const shift = fitnessShift(profile, cfg);
  const fat = fatigue(seg, profile);

  const gRun = cfg.G_RUN_MAX + shift - fat;
  const gHike = cfg.G_HIKE_MAX + shift - fat;
  const gPoles = cfg.G_POLES + shift;

  let mode: Advice["mode"];
  if (g < gRun && vRun(g, profile, cfg) >= cfg.V_CROSS) mode = "RUN";
  else if (g < gHike) mode = "POWER_HIKE";
  else mode = "HIKE";

  const poles =
    profile.hasPoles && (g >= gPoles || (mode === "HIKE" && seg.length > cfg.L_LONG));

  return { mode, poles, targetHR: hrCeiling(profile, seg) };
}
```

- [ ] **Step 4: Create `src/core/index.ts`** (public surface for the rest of the app + future watch mirror)

```typescript
export * from "./types";
export * from "./config";
export * from "./energetics";
export * from "./advice";
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/core.advice.test.ts`
Expected: PASS (all energetics + golden cases green).

> If a golden case fails, adjust ONLY `src/core/config.ts` thresholds — never the test expectations — then re-run. The bands are designed so: novice gRun=0.12, elite gRun≈0.16; novice gHike=0.22, elite gHike≈0.26; novice gPoles=0.25, elite gPoles≈0.29.

- [ ] **Step 6: Commit**

```bash
git add src/core/advice.ts src/core/index.ts test/core.advice.test.ts
git commit -m "feat(core): ADVICE banding, fatigue/fitness shift, HR ceiling"
```

---

## Task 5: GPX parsing

**Files:**
- Create: `src/gpx/parse.ts`, `fixtures/tirol-sample.gpx`
- Test: `test/gpx.segment.test.ts` (parse section)

- [ ] **Step 1: Create `fixtures/tirol-sample.gpx`** (a small synthetic route: flat → 14% climb → flat → 28% climb → descent; elevations chosen to yield two climbs)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="trailrun-fixture" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Tirol sample</name><trkseg>
    <trkpt lat="47.2700" lon="11.4000"><ele>600</ele></trkpt>
    <trkpt lat="47.2710" lon="11.4000"><ele>601</ele></trkpt>
    <trkpt lat="47.2720" lon="11.4000"><ele>602</ele></trkpt>
    <trkpt lat="47.2730" lon="11.4000"><ele>618</ele></trkpt>
    <trkpt lat="47.2740" lon="11.4000"><ele>634</ele></trkpt>
    <trkpt lat="47.2750" lon="11.4000"><ele>650</ele></trkpt>
    <trkpt lat="47.2760" lon="11.4000"><ele>666</ele></trkpt>
    <trkpt lat="47.2770" lon="11.4000"><ele>667</ele></trkpt>
    <trkpt lat="47.2780" lon="11.4000"><ele>668</ele></trkpt>
    <trkpt lat="47.2790" lon="11.4000"><ele>669</ele></trkpt>
    <trkpt lat="47.2800" lon="11.4000"><ele>700</ele></trkpt>
    <trkpt lat="47.2810" lon="11.4000"><ele>731</ele></trkpt>
    <trkpt lat="47.2820" lon="11.4000"><ele>762</ele></trkpt>
    <trkpt lat="47.2830" lon="11.4000"><ele>793</ele></trkpt>
    <trkpt lat="47.2840" lon="11.4000"><ele>760</ele></trkpt>
    <trkpt lat="47.2850" lon="11.4000"><ele>720</ele></trkpt>
  </trkseg></trk>
</gpx>
```

- [ ] **Step 2: Write the failing test** — create `test/gpx.segment.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseGpx } from "../src/gpx/parse";

const gpx = readFileSync("fixtures/tirol-sample.gpx", "utf8");

describe("parseGpx", () => {
  it("returns distance-stamped points with elevation", () => {
    const pts = parseGpx(gpx);
    expect(pts.length).toBeGreaterThan(10);
    expect(pts[0].cumDist).toBe(0);
    expect(pts.at(-1)!.cumDist).toBeGreaterThan(pts[0].cumDist);
    expect(pts[0].ele).toBeCloseTo(600, 0);
  });

  it("rejects GPX without elevation (SPEC §5.4)", () => {
    const noEle = gpx.replace(/<ele>[^<]*<\/ele>/g, "");
    expect(() => parseGpx(noEle)).toThrow(/elevation/i);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/gpx.segment.test.ts`
Expected: FAIL — cannot resolve `../src/gpx/parse`.

- [ ] **Step 4: Write `src/gpx/parse.ts`**

```typescript
import { XMLParser } from "fast-xml-parser";

export interface GpxPoint {
  lat: number;
  lon: number;
  ele: number;
  cumDist: number; // m from start
}

/** Haversine distance in metres. */
function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Parse GPX text into distance-stamped points. Throws if any point lacks <ele>. */
export function parseGpx(xml: string): GpxPoint[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const doc = parser.parse(xml);

  // Accept track points (trkpt) or route points (rtept).
  const raw: any[] = [];
  const trksegs = toArray(doc?.gpx?.trk).flatMap((t: any) => toArray(t?.trkseg));
  for (const seg of trksegs) raw.push(...toArray(seg?.trkpt));
  for (const rte of toArray(doc?.gpx?.rte)) raw.push(...toArray(rte?.rtept));

  if (raw.length === 0) throw new Error("GPX contains no track or route points.");

  const pts: GpxPoint[] = [];
  let cumDist = 0;
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const ele = r?.ele;
    if (ele === undefined || ele === null || ele === "") {
      throw new Error("GPX point is missing elevation (<ele>); cannot segment climbs.");
    }
    const lat = Number(r["@_lat"]);
    const lon = Number(r["@_lon"]);
    if (i > 0) cumDist += haversine(pts[i - 1].lat, pts[i - 1].lon, lat, lon);
    pts.push({ lat, lon, ele: Number(ele), cumDist });
  }
  return pts;
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/gpx.segment.test.ts`
Expected: PASS (2 passing).

- [ ] **Step 6: Commit**

```bash
git add src/gpx/parse.ts fixtures/tirol-sample.gpx test/gpx.segment.test.ts
git commit -m "feat(gpx): GPX parsing with elevation guard"
```

---

## Task 6: Climb segmentation

**Files:**
- Create: `src/gpx/segment.ts`
- Test: append to `test/gpx.segment.test.ts`

- [ ] **Step 1: Append failing test to `test/gpx.segment.test.ts`**

```typescript
import { segmentClimbs, DEFAULT_SEGMENT_OPTS } from "../src/gpx/segment";

describe("segmentClimbs", () => {
  it("finds the two climbs in the fixture and skips flats/descents", () => {
    const climbs = segmentClimbs(parseGpx(gpx));
    expect(climbs.length).toBe(2);
    // first climb ~14-16%, second ~steeper
    expect(climbs[0].gradient).toBeGreaterThan(0.08);
    expect(climbs[1].gradient).toBeGreaterThan(climbs[0].gradient);
    // climbs are ordered and carry cumulative ascent
    expect(climbs[1].distanceIntoRoute).toBeGreaterThan(climbs[0].distanceIntoRoute);
    expect(climbs[1].cumulativeAscentBefore).toBeGreaterThan(0);
  });

  it("drops micro-climbs below the minimum vertical", () => {
    const opts = { ...DEFAULT_SEGMENT_OPTS, minVertical: 1000 };
    expect(segmentClimbs(parseGpx(gpx), opts).length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/gpx.segment.test.ts`
Expected: FAIL — cannot resolve `../src/gpx/segment`.

- [ ] **Step 3: Write `src/gpx/segment.ts`**

```typescript
import type { GpxPoint } from "./parse";
import type { Segment } from "../core/types";

export interface SegmentOpts {
  resampleSpacing: number; // m
  smoothWindow: number;    // points, odd
  climbGradeEnter: number; // fraction; start a climb above this
  climbGradeExit: number;  // fraction; end a climb below this (hysteresis)
  minVertical: number;     // m; drop climbs with less gain
  minLength: number;       // m; drop climbs shorter than this
}

export const DEFAULT_SEGMENT_OPTS: SegmentOpts = {
  resampleSpacing: 15,
  smoothWindow: 5,
  climbGradeEnter: 0.04,
  climbGradeExit: 0.02,
  minVertical: 30,
  minLength: 50,
};

/** Resample to even spacing by linear interpolation on cumDist (SPEC §4.4 step 1). */
function resample(pts: GpxPoint[], spacing: number): GpxPoint[] {
  const total = pts.at(-1)!.cumDist;
  const out: GpxPoint[] = [];
  let j = 0;
  for (let d = 0; d <= total; d += spacing) {
    while (j < pts.length - 2 && pts[j + 1].cumDist < d) j++;
    const a = pts[j], b = pts[Math.min(j + 1, pts.length - 1)];
    const span = b.cumDist - a.cumDist || 1;
    const t = Math.max(0, Math.min(1, (d - a.cumDist) / span));
    out.push({
      lat: a.lat + (b.lat - a.lat) * t,
      lon: a.lon + (b.lon - a.lon) * t,
      ele: a.ele + (b.ele - a.ele) * t,
      cumDist: d,
    });
  }
  return out;
}

/** Moving-average smooth of elevation (SPEC §4.4 step 2). */
function smoothEle(pts: GpxPoint[], window: number): GpxPoint[] {
  const half = Math.floor(window / 2);
  return pts.map((p, i) => {
    let sum = 0, n = 0;
    for (let k = i - half; k <= i + half; k++) {
      if (k >= 0 && k < pts.length) { sum += pts[k].ele; n++; }
    }
    return { ...p, ele: sum / n };
  });
}

/** Segment a point array into climb Segments (SPEC §4.4 steps 3-4). */
export function segmentClimbs(
  rawPts: GpxPoint[],
  opts: SegmentOpts = DEFAULT_SEGMENT_OPTS,
): Segment[] {
  const pts = smoothEle(resample(rawPts, opts.resampleSpacing), opts.smoothWindow);

  const climbs: Segment[] = [];
  let cumulativeAscent = 0;
  let i = 0;
  while (i < pts.length - 1) {
    const grade = localGrade(pts, i);
    if (grade <= opts.climbGradeEnter) { i++; continue; }

    // climb started at i; extend while grade stays above exit threshold
    const start = i;
    let j = i + 1;
    while (j < pts.length - 1 && localGrade(pts, j) > opts.climbGradeExit) j++;

    const a = pts[start], b = pts[j];
    const length = b.cumDist - a.cumDist;
    const vertical = b.ele - a.ele;
    const ascentBefore = cumulativeAscent;
    cumulativeAscent += Math.max(0, vertical);

    if (vertical >= opts.minVertical && length >= opts.minLength) {
      let maxGrade = 0;
      for (let k = start; k < j; k++) maxGrade = Math.max(maxGrade, localGrade(pts, k));
      climbs.push({
        gradient: vertical / length,
        maxGradient: maxGrade,
        length,
        vertical,
        cumulativeAscentBefore: ascentBefore,
        distanceIntoRoute: a.cumDist,
        startLat: a.lat, startLon: a.lon,
        topLat: b.lat, topLon: b.lon,
      });
    }
    i = j + 1;
  }
  return climbs;
}

function localGrade(pts: GpxPoint[], i: number): number {
  const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
  const dd = b.cumDist - a.cumDist;
  if (dd < 1) return 0; // clamp near-zero horizontal (SPEC §6.3 spirit)
  return (b.ele - a.ele) / dd;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/gpx.segment.test.ts`
Expected: PASS (4 passing total in this file).

- [ ] **Step 5: Commit**

```bash
git add src/gpx/segment.ts test/gpx.segment.test.ts
git commit -m "feat(gpx): climb segmentation with smoothing + hysteresis"
```

---

## Task 7: Guide schema validation

**Files:**
- Create: `src/guide/schema.ts`
- Test: `test/guide.schema.test.ts`

- [ ] **Step 1: Write the failing test** — create `test/guide.schema.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { GuideSchema } from "../src/guide/schema";

const minimal = {
  type: "sequence",
  name: "Climb Advisor",
  description: "Test guide",
  shortDescription: "Climb",
  owner: "Bike AI Lab",
  url: "https://example.com",
  usage: "workout",
  steps: [{ type: "fields", fields: [{ type: "altitude" }] }],
};

describe("GuideSchema (SPEC §2)", () => {
  it("accepts a minimal valid guide", () => {
    expect(() => GuideSchema.parse(minimal)).not.toThrow();
  });

  it("rejects shortDescription over 23 chars", () => {
    expect(() => GuideSchema.parse({ ...minimal, shortDescription: "x".repeat(24) })).toThrow();
  });

  it("rejects a notification title over 13 chars", () => {
    const bad = { ...minimal, steps: [{ type: "fields", fields: [{ type: "altitude" }],
      notification: { title: "x".repeat(14) } }] };
    expect(() => GuideSchema.parse(bad)).toThrow();
  });

  it("rejects more than 1000 steps", () => {
    const steps = Array.from({ length: 1001 }, () => ({ type: "fields", fields: [{ type: "altitude" }] }));
    expect(() => GuideSchema.parse({ ...minimal, steps })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/guide.schema.test.ts`
Expected: FAIL — cannot resolve `../src/guide/schema`.

- [ ] **Step 3: Write `src/guide/schema.ts`** (encodes SPEC §2 limits with zod)

```typescript
import { z } from "zod";

// SPEC §2.4 display + gauge field types.
const FieldType = z.enum([
  "text", "heartRate", "speed", "pace", "power", "altitude", "distance",
  "duration", "temperature", "cadence", "ascent", "descent", "verticalSpeed",
  "ascentTime", "descentTime", "energy",
  "stepDistanceCountdown", "stepDurationCountdown",
  "targetHeartRate", "targetSpeed", "targetPace", "targetPower", "targetCadence",
]);

const Field = z.object({
  type: FieldType,
  title: z.string().optional(),
  text: z.string().max(54).optional(),
  window: z.enum(["workout", "step", "manualLap"]).optional(),
  aggregate: z.enum(["average", "min", "max"]).optional(),
  value: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
}).strict();

// SPEC §2.3 conditions. Recursive for or/and.
const Condition: z.ZodType<any> = z.lazy(() =>
  z.object({
    type: z.enum([
      "distance", "stepDistance", "duration", "stepDuration",
      "location", "routeCompleted", "routeExited", "manualLap", "or", "and",
    ]),
    value: z.number().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    distance: z.number().optional(),
    direction: z.number().optional(),
    conditions: z.array(Condition).optional(),
  }).strict(),
);

const Transition = z.object({
  condition: Condition,
  stepId: z.string().optional(),
}).strict();

const Notification = z.object({
  title: z.string().max(13).optional(),
  text: z.string().max(54).optional(),
}).strict();

const FieldsStep = z.object({
  type: z.literal("fields"),
  id: z.string().optional(),
  title: z.string().max(13).optional(),
  fields: z.array(Field).min(1),
  transitions: z.array(Transition).optional(),
  notification: Notification.optional(),
  createManualLap: z.boolean().optional(),
}).strict();

const RepeatStep = z.object({
  type: z.literal("repeat"),
  times: z.number().int().min(1).max(100),
  steps: z.array(FieldsStep),
}).strict();

const Step = z.union([FieldsStep, RepeatStep]);

export const GuideSchema = z.object({
  type: z.literal("sequence"),
  name: z.string().min(1).max(60),
  description: z.string().min(1).max(256),
  richText: z.string().max(100000).optional(),
  shortDescription: z.string().min(1).max(23),
  owner: z.string().min(1).max(64),
  url: z.string().url(),
  activities: z.array(z.number()).optional(),
  usage: z.literal("workout"),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  externalId: z.string().optional(),
  steps: z.array(Step).min(1).max(1000),
}).strict();

export type Guide = z.infer<typeof GuideSchema>;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/guide.schema.test.ts`
Expected: PASS (4 passing).

- [ ] **Step 5: Commit**

```bash
git add src/guide/schema.ts test/guide.schema.test.ts
git commit -m "feat(guide): zod schema enforcing SPEC §2 guide constraints"
```

---

## Task 8: Guide builder

**Files:**
- Create: `src/guide/builder.ts`
- Test: `test/guide.builder.test.ts`

- [ ] **Step 1: Write the failing test** — create `test/guide.builder.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { buildGuide } from "../src/guide/builder";
import { GuideSchema } from "../src/guide/schema";
import { parseGpx } from "../src/gpx/parse";
import { segmentClimbs } from "../src/gpx/segment";
import { readFileSync } from "node:fs";
import type { Profile } from "../src/core/types";

const profile: Profile = {
  vo2max: 55, thresholdHR: 165, maxHR: 188, restHR: 50, bodyMass: 70,
  hasPoles: true, experience: "intermediate", goal: "training",
};
const climbs = segmentClimbs(parseGpx(readFileSync("fixtures/tirol-sample.gpx", "utf8")));

describe("buildGuide", () => {
  it("emits a schema-valid guide for the route", () => {
    const guide = buildGuide(climbs, profile, { routeId: "route-123", routeName: "Tirol sample" });
    expect(() => GuideSchema.parse(guide)).not.toThrow();
    expect(guide.externalId).toBe("route-123");
  });

  it("creates a cruise step + climb step per climb (alternating)", () => {
    const guide = buildGuide(climbs, profile, { routeId: "r", routeName: "n" });
    // one cruise (approach) step + one climb step per climb
    expect(guide.steps.length).toBe(climbs.length * 2);
    const climbStep = guide.steps[1] as any;
    expect(climbStep.fields.some((f: any) => f.type === "targetHeartRate")).toBe(true);
    expect(climbStep.fields.some((f: any) => f.type === "stepDistanceCountdown")).toBe(true);
  });

  it("the approach step carries a notification within char limits", () => {
    const guide = buildGuide(climbs, profile, { routeId: "r", routeName: "n" });
    const approach = guide.steps[0] as any;
    expect(approach.notification.title.length).toBeLessThanOrEqual(13);
    expect(approach.notification.text.length).toBeLessThanOrEqual(54);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/guide.builder.test.ts`
Expected: FAIL — cannot resolve `../src/guide/builder`.

- [ ] **Step 3: Write `src/guide/builder.ts`**

```typescript
import type { Guide } from "./schema";
import type { Profile, Segment, Advice } from "../core/types";
import { advise } from "../core/advice";
import { TRAIL_RUN_ACTIVITY_ID } from "../suunto/constants";

export interface BuildOpts {
  routeId: string;
  routeName: string;
  approachLeadMeters?: number; // notify this far before the climb (SPEC §5.2.4)
  localDate?: string;
}

const MODE_WORD: Record<Advice["mode"], string> = {
  RUN: "run",
  POWER_HIKE: "power-hike",
  HIKE: "hike",
};

/** Build a schema-valid SuuntoPlus Guide from climbs + profile (SPEC §2, §5.2.4). */
export function buildGuide(climbs: Segment[], profile: Profile, opts: BuildOpts): Guide {
  const lead = opts.approachLeadMeters ?? 200;
  const steps: Guide["steps"] = [];

  climbs.forEach((climb, idx) => {
    const adv = advise(climb, profile);
    const approachAt = Math.max(0, climb.distanceIntoRoute - lead);

    // Approach/cruise step: waits until ~lead metres before the climb, then notifies.
    steps.push({
      type: "fields",
      id: `approach-${idx}`,
      fields: [{ type: "distance" }],
      notification: {
        title: notifTitle(climb),
        text: notifText(climb, adv),
      },
      transitions: [
        // primary: location at the climb start; fallback: absolute distance into workout
        {
          condition: {
            type: "location",
            latitude: climb.startLat,
            longitude: climb.startLon,
            distance: lead,
          },
          stepId: `climb-${idx}`,
        },
        { condition: { type: "distance", value: climb.distanceIntoRoute }, stepId: `climb-${idx}` },
      ],
    });

    // During-climb step: HR gauge + countdown + mode reminder.
    steps.push({
      type: "fields",
      id: `climb-${idx}`,
      title: `Climb ${idx + 1}`.slice(0, 13),
      fields: [
        { type: "targetHeartRate", min: adv.targetHR.min, max: adv.targetHR.max },
        { type: "verticalSpeed" },
        { type: "stepDistanceCountdown" },
        { type: "text", text: climbReminder(climb, adv) },
      ],
      transitions: [
        { condition: { type: "stepDistance", value: Math.round(climb.length) } },
      ],
    });
  });

  return {
    type: "sequence",
    name: `Climb Advisor — ${opts.routeName}`.slice(0, 60),
    description: `Auto-generated climb advice for ${opts.routeName}`.slice(0, 256),
    shortDescription: "Climb".slice(0, 23),
    owner: "Bike AI Lab",
    url: "https://example.com",
    activities: [TRAIL_RUN_ACTIVITY_ID],
    usage: "workout",
    ...(opts.localDate ? { localDate: opts.localDate } : {}),
    externalId: opts.routeId,
    steps,
  };
}

function notifTitle(climb: Segment): string {
  // e.g. "Climb 600m" — distance is the climb length, rounded. ≤13 chars.
  return `Climb ${Math.round(climb.length)}m`.slice(0, 13);
}

function notifText(climb: Segment, adv: Advice): string {
  // e.g. "14% · power-hike · poles · HR<155" — ≤54 chars.
  const pct = Math.round(climb.gradient * 100);
  const poles = adv.poles ? " · poles" : "";
  return `${pct}% · ${MODE_WORD[adv.mode]}${poles} · HR<${adv.targetHR.max}`.slice(0, 54);
}

function climbReminder(climb: Segment, adv: Advice): string {
  const pct = Math.round(climb.gradient * 100);
  return `${pct}% ${MODE_WORD[adv.mode]}${adv.poles ? " +poles" : ""}`.slice(0, 54);
}
```

- [ ] **Step 4: Create `src/suunto/constants.ts`** (centralizes the guessed `[VERIFY]` values — SPEC §7)

```typescript
// GUESSED / [VERIFY] Suunto constants. Confirm against the developer portal/PDFs
// before production use (SPEC §3, §7, verification checklist §8).

// Trail-running activity id (SPEC: Activities.pdf [VERIFY]).
export const TRAIL_RUN_ACTIVITY_ID = 13; // placeholder — confirm in Activities.pdf

export const CLOUD_API_BASE = "https://cloudapi.suunto.com";

// OAuth endpoints/scopes — [VERIFY] at apizone.suunto.com/how-to-start.
export const OAUTH_AUTHORIZE_URL = "https://cloudapi-oauth.suunto.com/oauth/authorize";
export const OAUTH_TOKEN_URL = "https://cloudapi-oauth.suunto.com/oauth/token";
export const OAUTH_SCOPES = "workout"; // [VERIFY] exact scope strings
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/guide.builder.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 6: Commit**

```bash
git add src/guide/builder.ts src/suunto/constants.ts test/guide.builder.test.ts
git commit -m "feat(guide): build schema-valid guide from climbs + advice"
```

---

## Task 9: Icon + ZIP packaging

**Files:**
- Create: `src/guide/icon.ts`, `src/guide/zip.ts`
- Test: append to `test/guide.builder.test.ts`

- [ ] **Step 1: Append failing test to `test/guide.builder.test.ts`**

```typescript
import { packageGuideZip } from "../src/guide/zip";
import JSZip from "jszip";

describe("packageGuideZip", () => {
  it("produces a ZIP containing guide.json and a 300x300 icon.png", async () => {
    const guide = buildGuide(climbs, profile, { routeId: "r", routeName: "n" });
    const buf = await packageGuideZip(guide);
    const zip = await JSZip.loadAsync(buf);
    expect(zip.file("guide.json")).not.toBeNull();
    expect(zip.file("icon.png")).not.toBeNull();
    const json = JSON.parse(await zip.file("guide.json")!.async("string"));
    expect(json.type).toBe("sequence");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/guide.builder.test.ts`
Expected: FAIL — cannot resolve `../src/guide/zip`.

- [ ] **Step 3: Write `src/guide/icon.ts`** (generate a valid 300×300 PNG, SPEC §2 requires icon.png 300×300)

```typescript
import { PNG } from "pngjs";

/** Generate a simple solid-with-chevron 300x300 PNG as a Buffer. */
export function makeIcon(): Buffer {
  const size = 300;
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      // background teal; a white upward chevron near centre as a "climb" mark
      const onChevron = Math.abs(x - size / 2) <= (size / 2 - Math.abs(y - size * 0.62) * 1.2)
        && Math.abs(x - size / 2) >= (size / 2 - Math.abs(y - size * 0.62) * 1.2) - 18
        && y > size * 0.30 && y < size * 0.70;
      png.data[idx] = onChevron ? 255 : 13;
      png.data[idx + 1] = onChevron ? 255 : 148;
      png.data[idx + 2] = onChevron ? 255 : 136;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}
```

- [ ] **Step 4: Write `src/guide/zip.ts`**

```typescript
import JSZip from "jszip";
import type { Guide } from "./schema";
import { GuideSchema } from "./schema";
import { makeIcon } from "./icon";

/** Validate then package a guide as a ZIP buffer (guide.json + icon.png). SPEC §2. */
export async function packageGuideZip(guide: Guide, icon?: Buffer): Promise<Buffer> {
  GuideSchema.parse(guide); // fail loudly if we ever build an invalid guide
  const zip = new JSZip();
  zip.file("guide.json", JSON.stringify(guide, null, 2));
  zip.file("icon.png", icon ?? makeIcon());
  return zip.generateAsync({ type: "nodebuffer" });
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/guide.builder.test.ts`
Expected: PASS (4 passing in this file).

- [ ] **Step 6: Commit**

```bash
git add src/guide/icon.ts src/guide/zip.ts test/guide.builder.test.ts
git commit -m "feat(guide): icon generation + ZIP packaging"
```

---

## Task 10: Pipeline + CLI (the verifiable milestone)

**Files:**
- Create: `src/pipeline.ts`, `src/cli/generate-guide.ts`, `fixtures/profile.sample.json`
- Test: `test/pipeline.test.ts`

- [ ] **Step 1: Create `fixtures/profile.sample.json`**

```json
{
  "vo2max": 55,
  "thresholdHR": 165,
  "maxHR": 188,
  "restHR": 50,
  "bodyMass": 70,
  "hasPoles": true,
  "experience": "intermediate",
  "goal": "training"
}
```

- [ ] **Step 2: Write the failing test** — create `test/pipeline.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { generateGuideFromGpx } from "../src/pipeline";
import { GuideSchema } from "../src/guide/schema";
import JSZip from "jszip";

const gpx = readFileSync("fixtures/tirol-sample.gpx", "utf8");
const profile = JSON.parse(readFileSync("fixtures/profile.sample.json", "utf8"));

describe("generateGuideFromGpx", () => {
  it("turns GPX + profile into a schema-valid guide and ZIP", async () => {
    const { guide, zip } = await generateGuideFromGpx(gpx, profile, {
      routeId: "route-xyz", routeName: "Tirol sample",
    });
    expect(() => GuideSchema.parse(guide)).not.toThrow();
    const loaded = await JSZip.loadAsync(zip);
    expect(loaded.file("guide.json")).not.toBeNull();
  });

  it("throws a clear error on GPX without elevation", async () => {
    const noEle = gpx.replace(/<ele>[^<]*<\/ele>/g, "");
    await expect(generateGuideFromGpx(noEle, profile, { routeId: "r", routeName: "n" }))
      .rejects.toThrow(/elevation/i);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/pipeline.test.ts`
Expected: FAIL — cannot resolve `../src/pipeline`.

- [ ] **Step 4: Write `src/pipeline.ts`**

```typescript
import type { Profile } from "./core/types";
import { parseGpx } from "./gpx/parse";
import { segmentClimbs, type SegmentOpts } from "./gpx/segment";
import { buildGuide, type BuildOpts } from "./guide/builder";
import { packageGuideZip } from "./guide/zip";
import type { Guide } from "./guide/schema";

const MAX_STEPS = 1000; // SPEC §2.1 / §5.4

export interface PipelineResult {
  guide: Guide;
  zip: Buffer;
  climbCount: number;
  droppedClimbs: number;
}

/** Full offline pipeline: GPX text + profile -> validated guide + ZIP (SPEC §4.4, §5.2). */
export async function generateGuideFromGpx(
  gpxText: string,
  profile: Profile,
  build: BuildOpts,
  segOpts?: SegmentOpts,
): Promise<PipelineResult> {
  const points = parseGpx(gpxText); // throws on missing elevation (SPEC §5.4)
  let climbs = segmentClimbs(points, segOpts);

  // Cap steps (2 per climb) to the watch limit; drop the smallest climbs if needed (SPEC §5.4).
  const maxClimbs = Math.floor(MAX_STEPS / 2);
  let dropped = 0;
  if (climbs.length > maxClimbs) {
    const keep = [...climbs].sort((a, b) => b.vertical - a.vertical).slice(0, maxClimbs);
    const keepSet = new Set(keep);
    dropped = climbs.length - keep.length;
    climbs = climbs.filter((c) => keepSet.has(c)); // preserve route order
  }

  const guide = buildGuide(climbs, profile, build);
  const zip = await packageGuideZip(guide);
  return { guide, zip, climbCount: climbs.length, droppedClimbs: dropped };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/pipeline.test.ts`
Expected: PASS (2 passing).

- [ ] **Step 6: Write `src/cli/generate-guide.ts`**

```typescript
import { readFileSync, writeFileSync } from "node:fs";
import { generateGuideFromGpx } from "../pipeline";
import type { Profile } from "../core/types";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const gpxPath = process.argv[2];
  if (!gpxPath || gpxPath.startsWith("--")) {
    console.error("Usage: npm run generate-guide <route.gpx> [--profile p.json] [--out guide.zip] [--route-id ID] [--name NAME]");
    process.exit(2);
  }
  const profilePath = arg("--profile") ?? "fixtures/profile.sample.json";
  const out = arg("--out") ?? "guide.zip";
  const routeId = arg("--route-id") ?? "local-route";
  const routeName = arg("--name") ?? "Local route";

  const gpx = readFileSync(gpxPath, "utf8");
  const profile = JSON.parse(readFileSync(profilePath, "utf8")) as Profile;

  const { guide, zip, climbCount, droppedClimbs } =
    await generateGuideFromGpx(gpx, profile, { routeId, routeName });

  writeFileSync(out, zip);
  writeFileSync(out.replace(/\.zip$/, "") + ".guide.json", JSON.stringify(guide, null, 2));
  console.log(`Wrote ${out} — ${climbCount} climb(s)${droppedClimbs ? `, dropped ${droppedClimbs} minor climb(s)` : ""}.`);
  for (const s of guide.steps) {
    if ((s as any).notification) console.log(`  • ${(s as any).notification.title}: ${(s as any).notification.text}`);
  }
}

main().catch((e) => { console.error("Error:", e.message); process.exit(1); });
```

- [ ] **Step 7: Run the CLI end-to-end (the verifiable milestone)**

Run: `npm run generate-guide fixtures/tirol-sample.gpx`
Expected: prints `Wrote guide.zip — 2 climb(s).` plus two notification lines; creates `guide.zip` + `guide.guide.json`.

- [ ] **Step 8: Commit**

```bash
git add src/pipeline.ts src/cli/generate-guide.ts fixtures/profile.sample.json test/pipeline.test.ts
git commit -m "feat(cli): offline GPX->guide pipeline + generate-guide command"
```

---

## Task 11: SQLite store

**Files:**
- Create: `src/db/schema.ts`, `src/db/store.ts`

> Integration layer below is built to the spec's documented shapes (some `[VERIFY]`), per the brainstorming decision. It is NOT network-tested this session. No new vitest files; verify via `npx tsc --noEmit`.

- [ ] **Step 1: Create `src/db/schema.ts`**

```typescript
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  suunto_user_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tokens (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS guide_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  route_id TEXT NOT NULL,
  guide_external_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, route_id)
);
`;
```

- [ ] **Step 2: Create `src/db/store.ts`**

```typescript
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schema";
import type { Profile } from "../core/types";

export interface Tokens { accessToken: string; refreshToken: string; expiresAt: string; }

export class Store {
  private db: Database.Database;
  constructor(path = "data.db") {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA_SQL);
  }

  upsertUser(suuntoUserId: string): number {
    this.db.prepare(`INSERT OR IGNORE INTO users(suunto_user_id) VALUES (?)`).run(suuntoUserId);
    return this.db.prepare(`SELECT id FROM users WHERE suunto_user_id = ?`).get(suuntoUserId) as any
      ? (this.db.prepare(`SELECT id FROM users WHERE suunto_user_id = ?`).get(suuntoUserId) as any).id
      : 0;
  }

  setTokens(userId: number, t: Tokens): void {
    this.db.prepare(
      `INSERT INTO tokens(user_id, access_token, refresh_token, expires_at)
       VALUES (?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET access_token=excluded.access_token,
         refresh_token=excluded.refresh_token, expires_at=excluded.expires_at`,
    ).run(userId, t.accessToken, t.refreshToken, t.expiresAt);
  }

  getTokens(userId: number): Tokens | undefined {
    const r = this.db.prepare(`SELECT access_token, refresh_token, expires_at FROM tokens WHERE user_id=?`).get(userId) as any;
    return r ? { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: r.expires_at } : undefined;
  }

  setProfile(userId: number, p: Profile): void {
    this.db.prepare(
      `INSERT INTO profiles(user_id, json) VALUES (?,?)
       ON CONFLICT(user_id) DO UPDATE SET json=excluded.json`,
    ).run(userId, JSON.stringify(p));
  }

  getProfile(userId: number): Profile | undefined {
    const r = this.db.prepare(`SELECT json FROM profiles WHERE user_id=?`).get(userId) as any;
    return r ? (JSON.parse(r.json) as Profile) : undefined;
  }

  logGuide(userId: number, routeId: string, guideExternalId: string): void {
    this.db.prepare(
      `INSERT INTO guide_log(user_id, route_id, guide_external_id) VALUES (?,?,?)
       ON CONFLICT(user_id, route_id) DO UPDATE SET guide_external_id=excluded.guide_external_id,
         created_at=datetime('now')`,
    ).run(userId, routeId, guideExternalId);
  }
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add src/db/schema.ts src/db/store.ts
git commit -m "feat(db): SQLite store for users/tokens/profiles/guide log"
```

---

## Task 12: Suunto API clients (build-as-is)

**Files:**
- Create: `src/suunto/oauth.ts`, `src/suunto/routes.ts`, `src/suunto/guideCloud.ts`

- [ ] **Step 1: Create `src/suunto/oauth.ts`** (SPEC §3, §5.2.1 — [VERIFY] endpoints in constants)

```typescript
import { OAUTH_AUTHORIZE_URL, OAUTH_TOKEN_URL, OAUTH_SCOPES } from "./constants";

export interface OAuthEnv {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  subscriptionKey: string; // Ocp-Apim-Subscription-Key
}

export function authorizeUrl(env: OAuthEnv, state: string): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: env.clientId,
    redirect_uri: env.redirectUri,
    scope: OAUTH_SCOPES,
    state,
  });
  return `${OAUTH_AUTHORIZE_URL}?${q.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user?: string; // Suunto user id [VERIFY field name]
}

export async function exchangeCode(env: OAuthEnv, code: string): Promise<TokenResponse> {
  return tokenRequest(env, { grant_type: "authorization_code", code, redirect_uri: env.redirectUri });
}

export async function refresh(env: OAuthEnv, refreshToken: string): Promise<TokenResponse> {
  return tokenRequest(env, { grant_type: "refresh_token", refresh_token: refreshToken });
}

async function tokenRequest(env: OAuthEnv, params: Record<string, string>): Promise<TokenResponse> {
  const body = new URLSearchParams({ client_id: env.clientId, client_secret: env.clientSecret, ...params });
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`OAuth token request failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}
```

- [ ] **Step 2: Create `src/suunto/routes.ts`** (SPEC §3.1 — GPX export)

```typescript
import { CLOUD_API_BASE } from "./constants";

export interface ApiAuth { accessToken: string; subscriptionKey: string; }

/** Export a route as GPX (SPEC §3.1). Returns the raw GPX text. */
export async function exportRouteGpx(auth: ApiAuth, routeId: string): Promise<string> {
  const res = await fetch(`${CLOUD_API_BASE}/v2/route/${routeId}/export`, {
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "Ocp-Apim-Subscription-Key": auth.subscriptionKey,
      Accept: "application/gpx+xml",
    },
  });
  if (!res.ok) throw new Error(`Route export failed: ${res.status} ${await res.text()}`);
  return res.text();
}
```

- [ ] **Step 3: Create `src/suunto/guideCloud.ts`** (SPEC §3.2 — [VERIFY] exact shape; ZIP upload assumed)

```typescript
import { CLOUD_API_BASE } from "./constants";
import type { ApiAuth } from "./routes";

// [VERIFY] exact endpoint paths + whether create/update is ZIP multipart or JSON,
// from SuuntoplusGuideCloudAPI.pdf. Shapes below are best-effort per SPEC §3.2.
const GUIDES_PATH = "/v2/suuntoplus/guides";

function headers(auth: ApiAuth): Record<string, string> {
  return {
    Authorization: `Bearer ${auth.accessToken}`,
    "Ocp-Apim-Subscription-Key": auth.subscriptionKey,
  };
}

export interface GuideRef { id: string; externalId?: string; }

export async function listGuides(auth: ApiAuth): Promise<GuideRef[]> {
  const res = await fetch(`${CLOUD_API_BASE}${GUIDES_PATH}`, { headers: headers(auth) });
  if (!res.ok) throw new Error(`List guides failed: ${res.status}`);
  return (await res.json()) as GuideRef[];
}

async function uploadZip(auth: ApiAuth, url: string, method: "POST" | "PUT", zip: Buffer): Promise<GuideRef> {
  const form = new FormData();
  form.append("guide", new Blob([zip], { type: "application/zip" }), "guide.zip");
  const res = await fetch(url, { method, headers: headers(auth), body: form });
  if (!res.ok) throw new Error(`Guide ${method} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as GuideRef;
}

export function createGuide(auth: ApiAuth, zip: Buffer): Promise<GuideRef> {
  return uploadZip(auth, `${CLOUD_API_BASE}${GUIDES_PATH}`, "POST", zip);
}

export function updateGuide(auth: ApiAuth, guideId: string, zip: Buffer): Promise<GuideRef> {
  return uploadZip(auth, `${CLOUD_API_BASE}${GUIDES_PATH}/${guideId}`, "PUT", zip);
}

export async function deleteGuide(auth: ApiAuth, guideId: string): Promise<void> {
  const res = await fetch(`${CLOUD_API_BASE}${GUIDES_PATH}/${guideId}`, { method: "DELETE", headers: headers(auth) });
  if (!res.ok) throw new Error(`Delete guide failed: ${res.status}`);
}

/** Idempotent push on externalId = route id (SPEC §5.2.5, §5.4). */
export async function upsertGuideForRoute(auth: ApiAuth, externalId: string, zip: Buffer): Promise<GuideRef> {
  const existing = (await listGuides(auth)).find((g) => g.externalId === externalId);
  return existing ? updateGuide(auth, existing.id, zip) : createGuide(auth, zip);
}
```

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add src/suunto/oauth.ts src/suunto/routes.ts src/suunto/guideCloud.ts
git commit -m "feat(suunto): OAuth, route export, guide cloud clients (build-as-is)"
```

---

## Task 13: Fastify server + webhook wiring

**Files:**
- Create: `src/server/app.ts`, `src/server/index.ts`

- [ ] **Step 1: Create `src/server/app.ts`**

```typescript
import Fastify from "fastify";
import formbody from "@fastify/formbody";
import { readFileSync } from "node:fs";
import { Store } from "../db/store";
import { authorizeUrl, exchangeCode, refresh, type OAuthEnv } from "../suunto/oauth";
import { exportRouteGpx } from "../suunto/routes";
import { upsertGuideForRoute } from "../suunto/guideCloud";
import { generateGuideFromGpx } from "../pipeline";
import type { Profile } from "../core/types";

export interface ServerDeps { store: Store; oauth: OAuthEnv; subscriptionKey: string; }

export function buildApp(deps: ServerDeps) {
  const app = Fastify({ logger: true });
  app.register(formbody);

  app.get("/health", async () => ({ ok: true }));

  // --- OAuth connect ---
  app.get("/connect", async (_req, reply) => {
    reply.type("text/html").send(readFileSync("src/web/connect.html", "utf8"));
  });

  app.get("/oauth/start", async (_req, reply) => {
    reply.redirect(authorizeUrl(deps.oauth, "state-" + _req.id));
  });

  app.get<{ Querystring: { code?: string } }>("/oauth/callback", async (req, reply) => {
    const code = req.query.code;
    if (!code) return reply.code(400).send("missing code");
    const tok = await exchangeCode(deps.oauth, code);
    const userId = deps.store.upsertUser(tok.user ?? "unknown");
    deps.store.setTokens(userId, {
      accessToken: tok.access_token, refreshToken: tok.refresh_token,
      expiresAt: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
    });
    reply.redirect(`/profile?user=${userId}`);
  });

  // --- Profile form ---
  app.get<{ Querystring: { user?: string } }>("/profile", async (_req, reply) => {
    reply.type("text/html").send(readFileSync("src/web/profile.html", "utf8"));
  });

  app.post<{ Body: Record<string, string> }>("/profile", async (req, reply) => {
    const b = req.body;
    const userId = Number(b.user);
    const profile: Profile = {
      vo2max: Number(b.vo2max), thresholdHR: Number(b.thresholdHR), maxHR: Number(b.maxHR),
      restHR: Number(b.restHR), bodyMass: Number(b.bodyMass),
      hasPoles: b.hasPoles === "on" || b.hasPoles === "true",
      experience: b.experience as Profile["experience"], goal: b.goal as Profile["goal"],
    };
    deps.store.setProfile(userId, profile);
    reply.type("text/html").send("<p>Profile saved. Plan a route in the Suunto app — your guide will generate automatically.</p>");
  });

  // --- Route webhook ([VERIFY] payload shape, SPEC §3.1, §5.2.3) ---
  app.post<{ Body: { userId?: string; route?: { id?: string; name?: string } } }>(
    "/webhook/route",
    async (req, reply) => {
      const userId = Number(req.body.userId);
      const routeId = req.body.route?.id;
      const routeName = req.body.route?.name ?? "Route";
      if (!routeId) return reply.code(400).send("missing route id");

      const profile = deps.store.getProfile(userId);
      const tokens = deps.store.getTokens(userId);
      if (!profile || !tokens) return reply.code(409).send("user not set up");

      const auth = { accessToken: tokens.accessToken, subscriptionKey: deps.subscriptionKey };
      const gpx = await exportRouteGpx(auth, routeId);
      const { guide, zip } = await generateGuideFromGpx(gpx, profile, { routeId, routeName });
      await upsertGuideForRoute(auth, routeId, zip);
      deps.store.logGuide(userId, routeId, guide.externalId!);
      reply.send({ ok: true, climbs: guide.steps.length / 2 });
    },
  );

  return app;
}
```

- [ ] **Step 2: Create `src/server/index.ts`**

```typescript
import { buildApp } from "./app";
import { Store } from "../db/store";

const app = buildApp({
  store: new Store(process.env.DB_PATH ?? "data.db"),
  oauth: {
    clientId: process.env.SUUNTO_CLIENT_ID ?? "",
    clientSecret: process.env.SUUNTO_CLIENT_SECRET ?? "",
    redirectUri: process.env.SUUNTO_REDIRECT_URI ?? "http://localhost:3000/oauth/callback",
    subscriptionKey: process.env.SUUNTO_SUBSCRIPTION_KEY ?? "",
  },
  subscriptionKey: process.env.SUUNTO_SUBSCRIPTION_KEY ?? "",
});

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "0.0.0.0" }).then(() => console.log(`listening on :${port}`));
```

- [ ] **Step 3: Typecheck + boot smoke test**

Run: `npx tsc --noEmit && (npx tsx src/server/index.ts & sleep 2; curl -s localhost:3000/health; kill %1)`
Expected: `{"ok":true}` printed.

- [ ] **Step 4: Commit**

```bash
git add src/server/app.ts src/server/index.ts
git commit -m "feat(server): Fastify app — OAuth, profile, route webhook"
```

---

## Task 14: Web pages (connect + profile form)

**Files:**
- Create: `src/web/connect.html`, `src/web/profile.html`

> **REQUIRED:** Build these two pages with the `/frontend-design` skill (per user's global instruction that all UI uses it). The skill produces the markup/styling; wire the form fields below.

- [ ] **Step 1: Invoke `/frontend-design`** to design two minimal pages:
  - `connect.html`: a single "Connect your Suunto account" call-to-action linking to `/oauth/start`.
  - `profile.html`: a one-page form POSTing to `/profile` with fields — hidden `user`, number inputs `vo2max`, `thresholdHR`, `maxHR`, `restHR`, `bodyMass`; checkbox `hasPoles`; selects `experience` (novice/intermediate/elite) and `goal` (training/race); submit button.

- [ ] **Step 2: Verify the form contract** — confirm the field `name` attributes exactly match the keys read in `src/server/app.ts` POST `/profile` handler (`vo2max, thresholdHR, maxHR, restHR, bodyMass, hasPoles, experience, goal, user`).

- [ ] **Step 3: Manual check**

Run: `npx tsx src/server/index.ts` then open `http://localhost:3000/connect` and `http://localhost:3000/profile`.
Expected: both pages render; profile form submits and shows the saved confirmation.

- [ ] **Step 4: Commit**

```bash
git add src/web/connect.html src/web/profile.html
git commit -m "feat(web): connect + profile form pages"
```

---

## Task 15: README + final verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`** documenting: install, `npm test`, the offline `generate-guide` CLI, the env vars for the server (`SUUNTO_CLIENT_ID/SECRET/REDIRECT_URI/SUBSCRIPTION_KEY`, `PORT`, `DB_PATH`), and a clear list of the `[VERIFY]` items from SPEC §8 that must be confirmed before live use.

- [ ] **Step 2: Full test + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: typecheck clean; all test files pass (core, gpx, guide schema, guide builder, pipeline).

- [ ] **Step 3: End-to-end offline run**

Run: `npm run generate-guide fixtures/tirol-sample.gpx --name "Tirol sample"`
Expected: writes `guide.zip`; prints climbs + notifications.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README with usage, env vars, and [VERIFY] checklist"
```

---

## Self-Review notes (verification of this plan vs spec)

- **§4 core / config / energetics / advice** → Tasks 2–4 (golden cases cover §9 matrix).
- **§4.4 segmentation** → Tasks 5–6 (resample, smooth, hysteresis, min-length/vertical).
- **§2 guide schema + §5.2.4 step pattern** → Tasks 7–9 (schema, builder, icon, zip).
- **§5.4 edge cases** → elevation guard (Task 5), step cap/drop (Task 10).
- **§3.1 routes / §3.2 guide cloud / §5.2.1 OAuth** → Task 12 (build-as-is, constants isolate guesses).
- **§5.2.3 webhook / §5.3 flow** → Task 13.
- **§5.2.2 profile + UI** → Tasks 13–14.
- **§7 zones/HR ceiling** → `hrCeiling` in Task 4.
- **§8 verify checklist** → centralized in `suunto/constants.ts` + README (Task 15).
- **Type consistency:** `Segment`, `Profile`, `Advice` defined once (Task 2) and imported everywhere; `advise()` name consistent; `generateGuideFromGpx`, `buildGuide`, `packageGuideZip` names consistent across tasks.
- **App 2 (live watch app, §6)** is intentionally out of scope this session.
