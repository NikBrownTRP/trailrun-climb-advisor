import { describe, it, expect } from "vitest";
import { GuideSchema } from "../src/guide/schema";

const minimal = {
  type: "sequence",
  name: "Climb Advisor",
  description: "Test guide",
  shortDescription: "Climb",
  owner: "Bike AI Lab",
  url: "https://example.com",
  usage: "workout",
  steps: [{ type: "fields", fields: [{ type: "altitude" }] }],
};

describe("GuideSchema (SPEC §2)", () => {
  it("accepts a minimal valid guide", () => {
    expect(() => GuideSchema.parse(minimal)).not.toThrow();
  });

  it("rejects shortDescription over 23 chars", () => {
    expect(() => GuideSchema.parse({ ...minimal, shortDescription: "x".repeat(24) })).toThrow();
  });

  it("rejects a notification title over 13 chars", () => {
    const bad = { ...minimal, steps: [{ type: "fields", fields: [{ type: "altitude" }],
      notification: { title: "x".repeat(14) } }] };
    expect(() => GuideSchema.parse(bad)).toThrow();
  });

  it("rejects more than 1000 steps", () => {
    const steps = Array.from({ length: 1001 }, () => ({ type: "fields", fields: [{ type: "altitude" }] }));
    expect(() => GuideSchema.parse({ ...minimal, steps })).toThrow();
  });
});
