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
