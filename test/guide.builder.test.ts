import { describe, it, expect } from "vitest";
import { buildGuide } from "../src/guide/builder";
import { GuideSchema } from "../src/guide/schema";
import { parseGpx } from "../src/gpx/parse";
import { segmentClimbs } from "../src/gpx/segment";
import { readFileSync } from "node:fs";
import type { Profile } from "../src/core/types";
import { packageGuideZip } from "../src/guide/zip";
import JSZip from "jszip";

const profile: Profile = {
  vo2max: 55, thresholdHR: 165, maxHR: 188, restHR: 50, bodyMass: 70,
  hasPoles: true, experience: "intermediate", goal: "training",
};
const climbs = segmentClimbs(parseGpx(readFileSync("fixtures/tirol-sample.gpx", "utf8")));

describe("buildGuide", () => {
  it("emits a schema-valid guide for the route", () => {
    const guide = buildGuide(climbs, profile, { routeId: "route-123", routeName: "Tirol sample" });
    expect(() => GuideSchema.parse(guide)).not.toThrow();
    expect(guide.externalId).toBe("route-123");
  });

  it("creates a cruise step + climb step per climb (alternating)", () => {
    const guide = buildGuide(climbs, profile, { routeId: "r", routeName: "n" });
    expect(guide.steps.length).toBe(climbs.length * 2);
    const climbStep = guide.steps[1] as any;
    expect(climbStep.fields.some((f: any) => f.type === "targetHeartRate")).toBe(true);
    expect(climbStep.fields.some((f: any) => f.type === "stepDistanceCountdown")).toBe(true);
  });

  it("the approach step carries a notification within char limits", () => {
    const guide = buildGuide(climbs, profile, { routeId: "r", routeName: "n" });
    const approach = guide.steps[0] as any;
    expect(approach.notification.title.length).toBeLessThanOrEqual(13);
    expect(approach.notification.text.length).toBeLessThanOrEqual(54);
  });
});

describe("packageGuideZip", () => {
  it("produces a ZIP containing guide.json and a 300x300 icon.png", async () => {
    const guide = buildGuide(climbs, profile, { routeId: "r", routeName: "n" });
    const buf = await packageGuideZip(guide);
    const zip = await JSZip.loadAsync(buf);
    expect(zip.file("guide.json")).not.toBeNull();
    expect(zip.file("icon.png")).not.toBeNull();
    const json = JSON.parse(await zip.file("guide.json")!.async("string"));
    expect(json.type).toBe("sequence");
  });
});
