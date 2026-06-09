import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { advise as tsAdvise } from "../src/core/advice";
import type { Profile, Segment } from "../src/core/types";

// Load the ES5 watch core by evaluating its source in a bare function scope — no module
// system, mirroring the Duktape runtime. This both proves the file is valid ES5-ish JS
// runnable without imports AND lets us compare its advise() to the backend's.
const src = readFileSync("app2/src/core.js", "utf8");
type SegLite = { gradient: number; length: number; cumulativeAscentBefore: number };
type Adv = { mode: string; poles: boolean; targetHR: { min: number; max: number } };
const watchAdvise = new Function(src + "\n;return advise;")() as (
  seg: SegLite,
  profile: Profile,
  cfg?: unknown,
) => Adv;

const profiles: Record<string, Profile> = {
  novice: { vo2max: 42, thresholdHR: 160, maxHR: 185, restHR: 60, bodyMass: 80, hasPoles: true, experience: "novice", goal: "training" },
  elite: { vo2max: 70, thresholdHR: 170, maxHR: 190, restHR: 45, bodyMass: 65, hasPoles: true, experience: "elite", goal: "race" },
};

function seg(gradient: number, length: number, cum: number): Segment {
  return { gradient, length, vertical: gradient * length, cumulativeAscentBefore: cum, distanceIntoRoute: 1000 };
}

describe("watch core ⇄ backend core parity (SPEC §4 no-drift)", () => {
  const grades = [0.05, 0.12, 0.18, 0.25, 0.35];
  const lengths = [120, 600, 1200];
  const cums = [0, 500, 1500];
  for (const name of Object.keys(profiles)) {
    for (const goal of ["training", "race"] as const) {
      for (const g of grades) {
        for (const L of lengths) {
          for (const c of cums) {
            it(`${name}/${goal} g=${g} L=${L} cum=${c} → identical advice`, () => {
              const profile: Profile = { ...profiles[name], goal };
              const ts = tsAdvise(seg(g, L, c), profile);
              const w = watchAdvise({ gradient: g, length: L, cumulativeAscentBefore: c }, profile);
              expect(w.mode).toBe(ts.mode);
              expect(w.poles).toBe(ts.poles);
              expect(w.targetHR).toEqual(ts.targetHR);
            });
          }
        }
      }
    }
  }
});
