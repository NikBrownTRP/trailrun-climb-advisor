import type { Profile } from "./core/types";
import { parseGpx } from "./gpx/parse";
import { segmentClimbs, type SegmentOpts } from "./gpx/segment";
import { buildGuide, type BuildOpts } from "./guide/builder";
import { packageGuideZip } from "./guide/zip";
import type { Guide } from "./guide/schema";

const MAX_STEPS = 1000; // SPEC §2.1 / §5.4

export interface PipelineResult {
  guide: Guide;
  zip: Buffer;
  climbCount: number;
  droppedClimbs: number;
}

/** Full offline pipeline: GPX text + profile -> validated guide + ZIP (SPEC §4.4, §5.2). */
export async function generateGuideFromGpx(
  gpxText: string,
  profile: Profile,
  build: BuildOpts,
  segOpts?: SegmentOpts,
): Promise<PipelineResult> {
  const points = parseGpx(gpxText); // throws on missing elevation (SPEC §5.4)
  let climbs = segmentClimbs(points, segOpts);
  if (climbs.length === 0) {
    throw new Error("No climbs found in this route — nothing to advise on (flat route, or all climbs below the segmentation thresholds).");
  }

  // Cap steps (2 per climb) to the watch limit; drop the smallest climbs if needed (SPEC §5.4).
  const maxClimbs = Math.floor(MAX_STEPS / 2);
  let dropped = 0;
  if (climbs.length > maxClimbs) {
    const keep = [...climbs].sort((a, b) => b.vertical - a.vertical).slice(0, maxClimbs);
    const keepSet = new Set(keep);
    dropped = climbs.length - keep.length;
    climbs = climbs.filter((c) => keepSet.has(c)); // preserve route order
  }

  const guide = buildGuide(climbs, profile, build);
  const zip = await packageGuideZip(guide);
  return { guide, zip, climbCount: climbs.length, droppedClimbs: dropped };
}
