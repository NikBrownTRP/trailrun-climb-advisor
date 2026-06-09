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
