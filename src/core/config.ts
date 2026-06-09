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
