import JSZip from "jszip";
import type { Guide } from "./schema";
import { GuideSchema } from "./schema";
import { makeIcon } from "./icon";

/** Validate then package a guide as a ZIP buffer (guide.json + icon.png). SPEC §2. */
export async function packageGuideZip(guide: Guide, icon?: Buffer): Promise<Buffer> {
  GuideSchema.parse(guide); // fail loudly if we ever build an invalid guide
  const zip = new JSZip();
  zip.file("guide.json", JSON.stringify(guide, null, 2));
  zip.file("icon.png", icon ?? makeIcon());
  return zip.generateAsync({ type: "nodebuffer" });
}
