import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseGpx } from "../src/gpx/parse";
import { segmentClimbs, DEFAULT_SEGMENT_OPTS } from "../src/gpx/segment";

const gpx = readFileSync("fixtures/tirol-sample.gpx", "utf8");

describe("parseGpx", () => {
  it("returns distance-stamped points with elevation", () => {
    const pts = parseGpx(gpx);
    expect(pts.length).toBeGreaterThan(10);
    expect(pts[0].cumDist).toBe(0);
    expect(pts.at(-1)!.cumDist).toBeGreaterThan(pts[0].cumDist);
    expect(pts[0].ele).toBeCloseTo(600, 0);
  });

  it("rejects GPX without elevation (SPEC §5.4)", () => {
    const noEle = gpx.replace(/<ele>[^<]*<\/ele>/g, "");
    expect(() => parseGpx(noEle)).toThrow(/elevation/i);
  });
});

describe("segmentClimbs", () => {
  it("finds the two climbs in the fixture and skips flats/descents", () => {
    const climbs = segmentClimbs(parseGpx(gpx));
    expect(climbs.length).toBe(2);
    // first climb ~14-16%, second ~steeper
    expect(climbs[0].gradient).toBeGreaterThan(0.08);
    expect(climbs[1].gradient).toBeGreaterThan(climbs[0].gradient);
    // climbs are ordered and carry cumulative ascent
    expect(climbs[1].distanceIntoRoute).toBeGreaterThan(climbs[0].distanceIntoRoute);
    expect(climbs[1].cumulativeAscentBefore).toBeGreaterThan(0);
  });

  it("drops micro-climbs below the minimum vertical", () => {
    const opts = { ...DEFAULT_SEGMENT_OPTS, minVertical: 1000 };
    expect(segmentClimbs(parseGpx(gpx), opts).length).toBe(0);
  });
});
