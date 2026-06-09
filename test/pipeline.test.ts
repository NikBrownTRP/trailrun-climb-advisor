import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { generateGuideFromGpx } from "../src/pipeline";
import { GuideSchema } from "../src/guide/schema";
import JSZip from "jszip";

const gpx = readFileSync("fixtures/tirol-sample.gpx", "utf8");
const profile = JSON.parse(readFileSync("fixtures/profile.sample.json", "utf8"));

describe("generateGuideFromGpx", () => {
  it("turns GPX + profile into a schema-valid guide and ZIP", async () => {
    const { guide, zip } = await generateGuideFromGpx(gpx, profile, {
      routeId: "route-xyz", routeName: "Tirol sample",
    });
    expect(() => GuideSchema.parse(guide)).not.toThrow();
    const loaded = await JSZip.loadAsync(zip);
    expect(loaded.file("guide.json")).not.toBeNull();
  });

  it("throws a clear error on GPX without elevation", async () => {
    const noEle = gpx.replace(/<ele>[^<]*<\/ele>/g, "");
    await expect(generateGuideFromGpx(noEle, profile, { routeId: "r", routeName: "n" }))
      .rejects.toThrow(/elevation/i);
  });
});
