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
  bodyMass: number;     // kg — collected for future absolute-power models; unused in current per-kg formulas
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
