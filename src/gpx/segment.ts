import type { GpxPoint } from "./parse";
import type { Segment } from "../core/types";

export interface SegmentOpts {
  resampleSpacing: number; // m
  smoothWindow: number;    // points, odd
  climbGradeEnter: number; // fraction; start a climb above this
  climbGradeExit: number;  // fraction; end a climb below this (hysteresis)
  minVertical: number;     // m; drop climbs with less gain
  minLength: number;       // m; drop climbs shorter than this
}

export const DEFAULT_SEGMENT_OPTS: SegmentOpts = {
  resampleSpacing: 15,
  smoothWindow: 5,
  climbGradeEnter: 0.04,
  climbGradeExit: 0.02,
  minVertical: 30,
  minLength: 50,
};

/** Resample to even spacing by linear interpolation on cumDist (SPEC §4.4 step 1). */
function resample(pts: GpxPoint[], spacing: number): GpxPoint[] {
  const total = pts.at(-1)!.cumDist;
  const out: GpxPoint[] = [];
  let j = 0;
  for (let d = 0; d <= total; d += spacing) {
    while (j < pts.length - 2 && pts[j + 1].cumDist < d) j++;
    const a = pts[j], b = pts[Math.min(j + 1, pts.length - 1)];
    const span = b.cumDist - a.cumDist || 1;
    const t = Math.max(0, Math.min(1, (d - a.cumDist) / span));
    out.push({
      lat: a.lat + (b.lat - a.lat) * t,
      lon: a.lon + (b.lon - a.lon) * t,
      ele: a.ele + (b.ele - a.ele) * t,
      cumDist: d,
    });
  }
  return out;
}

/** Moving-average smooth of elevation (SPEC §4.4 step 2). */
function smoothEle(pts: GpxPoint[], window: number): GpxPoint[] {
  const half = Math.floor(window / 2);
  return pts.map((p, i) => {
    let sum = 0, n = 0;
    for (let k = i - half; k <= i + half; k++) {
      if (k >= 0 && k < pts.length) { sum += pts[k].ele; n++; }
    }
    return { ...p, ele: sum / n };
  });
}

/** Segment a point array into climb Segments (SPEC §4.4 steps 3-4). */
export function segmentClimbs(
  rawPts: GpxPoint[],
  opts: SegmentOpts = DEFAULT_SEGMENT_OPTS,
): Segment[] {
  const pts = smoothEle(resample(rawPts, opts.resampleSpacing), opts.smoothWindow);

  const climbs: Segment[] = [];
  let cumulativeAscent = 0;
  let i = 0;
  while (i < pts.length - 1) {
    const grade = localGrade(pts, i);
    if (grade <= opts.climbGradeEnter) { i++; continue; }

    // climb started at i; extend while grade stays above exit threshold
    const start = i;
    let j = i + 1;
    while (j < pts.length - 1 && localGrade(pts, j) > opts.climbGradeExit) j++;

    const a = pts[start], b = pts[j];
    const length = b.cumDist - a.cumDist;
    const vertical = b.ele - a.ele;
    const ascentBefore = cumulativeAscent;
    cumulativeAscent += Math.max(0, vertical);

    if (vertical >= opts.minVertical && length >= opts.minLength) {
      let maxGrade = 0;
      for (let k = start; k < j; k++) maxGrade = Math.max(maxGrade, localGrade(pts, k));
      climbs.push({
        gradient: vertical / length,
        maxGradient: maxGrade,
        length,
        vertical,
        cumulativeAscentBefore: ascentBefore,
        distanceIntoRoute: a.cumDist,
        startLat: a.lat, startLon: a.lon,
        topLat: b.lat, topLon: b.lon,
      });
    }
    i = j + 1;
  }
  return climbs;
}

function localGrade(pts: GpxPoint[], i: number): number {
  const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
  const dd = b.cumDist - a.cumDist;
  if (dd < 1) return 0; // clamp near-zero horizontal (SPEC §6.3 spirit)
  return (b.ele - a.ele) / dd;
}
