// Trail-Run Climb Advisor — SuuntoPlus Sports App (on-watch, live reaction).
// ES5 only (Duktape). Pairs with the Guide (App 1): the Guide bakes lookahead advice;
// this app reacts to the gradient under-foot + live HR in real time (SPEC §6).
//
// Resource paths and accessor semantics are from docs/suunto-api-findings.md Part B.
// Items marked VERIFY-HW must be confirmed in the simulator / on a real watch.
//
// Depends on app2/src/core.js (advise, CONFIG). The SuuntoPlus build concatenates app
// sources; advise()/CONFIG are in scope. Helpers use `var fn = function(){}` because
// top-level `function` names are reserved for lifecycle callbacks.

// ---- tunables for the LIVE layer (not in the shared core) ----
var GRADE_WINDOW_M = 30; // smooth grade over the last ~30 m of horizontal travel
var T_DWELL = 4; // s a new mode must persist before we switch the displayed advice
var T_OVER = 20; // s HR must stay over threshold before biasing toward hiking
var MIN_DDIST = 1.0; // m, clamp to avoid divide-by-near-zero when slow/stopped

// ---- live state ----
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

// Build the athlete profile from settings (edited in the Suunto mobile app, read via
// localStorage by the manifest `settings[].path`). Falls back to sane defaults so the
// app still runs in the simulator before settings are configured.
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
  // drop samples older than the window
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

// Re-read settings if the athlete edited them mid-session is not supported on-watch;
// profile is fixed at load (matches the Guide's bake-once model).
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

  // Live "segment": length is unknown under-foot. Use remaining route distance is also
  // unavailable as a clean number here, so use a long sentinel so the core's long-hike
  // poles rule (length > L_LONG) can engage on sustained steep terrain; race short-climb
  // HR easing intentionally won't trigger live (we lack a per-climb length).
  var seg = { gradient: grade, length: 9999, cumulativeAscentBefore: ascent };
  var rec = advise(seg, profile, CONFIG);

  // HR override (SPEC §6.4): if HR sits above threshold while we're saying RUN, bias to hike.
  if (hrBpm > profile.thresholdHR) {
    if (hrOverSince < 0) hrOverSince = ticks;
  } else {
    hrOverSince = -1;
  }
  if (rec.mode === "RUN" && hrOverSince >= 0 && (ticks - hrOverSince) >= T_OVER) {
    rec.mode = "POWER_HIKE";
  }

  // Hysteresis + dwell (SPEC §6.4): only switch the shown advice after the new mode
  // persists for T_DWELL seconds — stops flapping at band edges on rolling terrain.
  if (rec.mode !== candidate) {
    candidate = rec.mode;
    candidateSince = ticks;
  }
  if (candidate !== state && (ticks - candidateSince) >= T_DWELL) {
    state = candidate;
  }

  // outputs (bound in t.html). gradePct signed; mode is the dwell-smoothed state.
  output.mode = state;
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
