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
