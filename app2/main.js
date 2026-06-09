// Trail-Run Climb Advisor — SuuntoPlus Sports App (on-watch, live reaction).
// ES5 only (Duktape). Pairs with the Guide (App 1): the Guide bakes lookahead advice;
// this app reacts to the gradient under-foot + live HR in real time (SPEC §6).
//
// SuuntoPlus apps are single-file: main.js is the ONLY script the build includes
// (no import/require). So the decision core is INLINED below. It is the on-watch twin
// of the backend's src/core (TypeScript) and MUST stay behaviorally identical so the
// live app and the baked Guide give the same advice (SPEC §4). That parity is locked by
// ../test/app2-core-parity.test.ts, which evaluates THIS file and runs advise() against
// the backend core across a 180-case matrix.
//
// ES5 constraints (docs/suunto-api-findings.md Part B): no const/let, no arrow functions,
// no `**` (use Math.pow), no template literals, no default params. Helpers are
// `var fn = function(){}` because top-level `function` names are reserved for the
// SuuntoPlus lifecycle callbacks (onLoad / evaluate / getUserInterface / ...).

// ===================== climb-advisor-core (inlined ES5 twin) =====================

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

// ===================== live layer (watch-only, not in the shared core) =====================

var GRADE_WINDOW_M = 30; // smooth grade over the last ~30 m of horizontal travel
var T_DWELL = 4; // s a new mode must persist before we switch the displayed advice
var T_OVER = 20; // s HR must stay over threshold before biasing toward hiking
var MIN_DDIST = 1.0; // m, clamp to avoid divide-by-near-zero when slow/stopped

var profile;
var samples; // ring of { dist: m, alt: m } over the grade window
var state; // current displayed mode: "RUN" | "POWER_HIKE" | "HIKE"
var candidate; // mode advise currently wants
var candidateSince; // tick count since candidate first seen
var hrOverSince; // tick count since HR first exceeded threshold (-1 = not over)
var ticks;

var num = function (v, dflt) {
  var n = Number(v);
  return isFinite(n) ? n : dflt;
};

// Build the athlete profile from settings (edited in the Suunto mobile app, stored in
// data.json, read via localStorage by the manifest `settings[].path`). Falls back to
// sane defaults so the app still runs in the simulator before settings are configured.
var loadProfile = function () {
  return {
    vo2max: num(localStorage.getItem("vo2max"), 50),
    thresholdHR: num(localStorage.getItem("thresholdHR"), 165),
    maxHR: num(localStorage.getItem("maxHR"), 188),
    restHR: num(localStorage.getItem("restHR"), 50),
    bodyMass: num(localStorage.getItem("bodyMass"), 70),
    hasPoles: localStorage.getItem("hasPoles") === "true" || localStorage.getItem("hasPoles") === "1",
    experience: localStorage.getItem("experience") || "intermediate",
    goal: localStorage.getItem("goal") || "training"
  };
};

// Smoothed grade (fraction) over the trailing GRADE_WINDOW_M of horizontal distance.
var smoothedGrade = function (dist, alt) {
  samples.push({ dist: dist, alt: alt });
  while (samples.length > 1 && (dist - samples[0].dist) > GRADE_WINDOW_M) samples.shift();
  var a = samples[0];
  var dd = dist - a.dist;
  if (dd < MIN_DDIST) return 0; // not enough horizontal travel yet (slow/stationary)
  return (alt - a.alt) / dd;
};

function onLoad(input, output) {
  profile = loadProfile();
  samples = [];
  state = "RUN";
  candidate = "RUN";
  candidateSince = 0;
  hrOverSince = -1;
  ticks = 0;
}

function evaluate(input, output) {
  ticks++;

  var dist = num(input.distance, 0); // /Activity/Current/Distance, m
  var alt = num(input.altitude, 0); // /Fusion/Altitude, m (fused baro+GPS)
  var hrHz = num(input.hr, 0); // Activity/Move/-1/HeartRate/Current, Hz
  var hrBpm = Math.round(hrHz * 60); // HR is reported in Hz — convert (VERIFY-HW)
  var ascent = num(input.ascent, 0); // /Fusion/Altitude/Ascent, m cumulative
  var navState = num(input.navState, 0); // /Navigation/State (3 on-route, 7 snap)
  var remainAsc = num(input.remainAscent, 0); // route remaining ascent, m (nav only)

  var grade = smoothedGrade(dist, alt);

  // Live "segment": length under-foot is unknown, so use a long sentinel — lets the core's
  // long-hike poles rule engage on sustained steep terrain; race short-climb HR easing
  // intentionally won't trigger live (no per-climb length available).
  var seg = { gradient: grade, length: 9999, cumulativeAscentBefore: ascent };
  var rec = advise(seg, profile, CONFIG);

  // HR override (SPEC §6.4): HR sustained above threshold while saying RUN → bias to hike.
  if (hrBpm > profile.thresholdHR) {
    if (hrOverSince < 0) hrOverSince = ticks;
  } else {
    hrOverSince = -1;
  }
  if (rec.mode === "RUN" && hrOverSince >= 0 && (ticks - hrOverSince) >= T_OVER) {
    rec.mode = "POWER_HIKE";
  }

  // Hysteresis + dwell (SPEC §6.4): switch the shown advice only after the new mode
  // persists for T_DWELL seconds — stops flapping at band edges on rolling terrain.
  if (rec.mode !== candidate) {
    candidate = rec.mode;
    candidateSince = ticks;
  }
  if (candidate !== state && (ticks - candidateSince) >= T_DWELL) {
    state = candidate;
  }

  output.mode = state === "POWER_HIKE" ? "P-HIKE" : state; // short label for the watch screen
  output.gradePct = Math.round(grade * 100);
  output.hrBpm = hrBpm;
  output.targetMax = rec.targetHR.max;
  output.poles = rec.poles ? 1 : 0;
  output.remainAsc = (navState === 3 || navState === 7) ? Math.round(remainAsc) : -1;
}

// MANDATORY callback — the app screen will not render without it.
function getUserInterface(input, output) {
  return { template: "t.html" };
}
