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
