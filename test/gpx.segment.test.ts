import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseGpx } from "../src/gpx/parse";

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
