// climb-advisor-core — ES5 port for the SuuntoPlus watch runtime (Duktape, ES5 only).
//
// This is the on-watch twin of the backend's src/core (TypeScript). It MUST stay
// behaviorally identical to src/core/advice.ts + energetics.ts + config.ts so the live
// app and the baked Guide give the same advice (SPEC §4). The parity is locked by
// test/app2-core-parity.test.ts, which runs THIS file's advise() against the TS core
// on the golden cases.
//
// ES5 constraints (verified, see docs/suunto-api-findings.md Part B): no const/let,
// no arrow functions, no `**` (use Math.pow), no template literals, no default params.
// Helpers are `var fn = function(){}` because top-level `function` names are reserved
// for SuuntoPlus lifecycle callbacks.

var CONFIG = {
  G_RUN_MAX: 0.12,
  G_HIKE_MAX: 0.22,
  G_POLES: 0.25,
  V_CROSS: 0.78,
  L_LONG: 400,
  P_SUS_FRACTION: { training: 0.85, race: 0.92 },
  EXPERIENCE_SHIFT: { novice: 0.0, intermediate: 0.02, elite: 0.04 },
  J_PER_ML_O2: 20.9
};

// Minetti AE et al. (2002) net cost of running, J/kg/m. [VERIFY coefficients] — shape model.
var costOfRunning = function (i) {
  return 155.4 * Math.pow(i, 5) - 30.4 * Math.pow(i, 4) - 43.3 * Math.pow(i, 3) +
         46.3 * Math.pow(i, 2) + 19.5 * i + 3.6;
};

var sustainablePowerWkg = function (profile, cfg) {
  return (profile.vo2max * cfg.J_PER_ML_O2 / 60) * cfg.P_SUS_FRACTION[profile.goal];
};

var vRun = function (g, profile, cfg) {
  var cr = costOfRunning(g);
  if (cr <= 0) return Infinity; // flat/downhill: running not cost-limited
  return sustainablePowerWkg(profile, cfg) / cr;
};

var fitnessShift = function (profile, cfg) {
  var expShift = cfg.EXPERIENCE_SHIFT[profile.experience];
  var vo2Shift = Math.max(-0.02, Math.min(0.02, (profile.vo2max - 50) * 0.001));
  return expShift + vo2Shift;
};

var fatigue = function (seg, profile) {
  var ascentTerm = Math.min(0.04, seg.cumulativeAscentBefore / 1000 * 0.02);
  var goalFactor = profile.goal === "race" ? 0.6 : 1.0;
  return ascentTerm * goalFactor;
};

var hrCeiling = function (profile, seg) {
  var thr = profile.thresholdHR;
  if (profile.goal === "race") {
    var shortClimb = seg.length < 400;
    var max = Math.min(profile.maxHR, thr + (shortClimb ? 12 : 5));
    return { min: thr - 8, max: max };
  }
  return { min: thr - 20, max: thr - 5 };
};

// Identical banding to src/core/advice.ts advise(). seg = {gradient, length,
// cumulativeAscentBefore}. Returns { mode, poles, targetHR:{min,max} }.
var advise = function (seg, profile, cfg) {
  if (!cfg) cfg = CONFIG;
  var g = seg.gradient;
  var shift = fitnessShift(profile, cfg);
  var fat = fatigue(seg, profile);

  var gRun = cfg.G_RUN_MAX + shift - fat;
  var gHike = cfg.G_HIKE_MAX + shift - fat;
  var gPoles = cfg.G_POLES + shift;

  var mode;
  if (g < gRun && vRun(g, profile, cfg) >= cfg.V_CROSS) mode = "RUN";
  else if (g < gHike) mode = "POWER_HIKE";
  else mode = "HIKE";

  var poles = profile.hasPoles && (g >= gPoles || (mode === "HIKE" && seg.length > cfg.L_LONG));

  return { mode: mode, poles: poles, targetHR: hrCeiling(profile, seg) };
};
