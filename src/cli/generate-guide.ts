import { readFileSync, writeFileSync } from "node:fs";
import { generateGuideFromGpx } from "../pipeline";
import type { Profile } from "../core/types";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const gpxPath = process.argv[2];
  if (!gpxPath || gpxPath.startsWith("--")) {
    console.error("Usage: npm run generate-guide <route.gpx> [--profile p.json] [--out guide.zip] [--route-id ID] [--name NAME]");
    process.exit(2);
  }
  const profilePath = arg("--profile") ?? "fixtures/profile.sample.json";
  const out = arg("--out") ?? "guide.zip";
  const routeId = arg("--route-id") ?? "local-route";
  const routeName = arg("--name") ?? "Local route";

  const gpx = readFileSync(gpxPath, "utf8");
  const profile = JSON.parse(readFileSync(profilePath, "utf8")) as Profile;

  const { guide, zip, climbCount, droppedClimbs } =
    await generateGuideFromGpx(gpx, profile, { routeId, routeName });

  writeFileSync(out, zip);
  writeFileSync(out.replace(/\.zip$/, "") + ".guide.json", JSON.stringify(guide, null, 2));
  console.log(`Wrote ${out} — ${climbCount} climb(s)${droppedClimbs ? `, dropped ${droppedClimbs} minor climb(s)` : ""}.`);
  for (const s of guide.steps) {
    if ((s as any).notification) console.log(`  • ${(s as any).notification.title}: ${(s as any).notification.text}`);
  }
}

main().catch((e) => { console.error("Error:", e.message); process.exit(1); });
