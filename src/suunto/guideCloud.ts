import { CLOUD_API_BASE } from "./constants";
import type { ApiAuth } from "./routes";

// [VERIFY] exact endpoint paths + whether create/update is ZIP multipart or JSON,
// from SuuntoplusGuideCloudAPI.pdf. Shapes below are best-effort per SPEC §3.2.
const GUIDES_PATH = "/v2/suuntoplus/guides";

function headers(auth: ApiAuth): Record<string, string> {
  return {
    Authorization: `Bearer ${auth.accessToken}`,
    "Ocp-Apim-Subscription-Key": auth.subscriptionKey,
  };
}

export interface GuideRef { id: string; externalId?: string; }

export async function listGuides(auth: ApiAuth): Promise<GuideRef[]> {
  const res = await fetch(`${CLOUD_API_BASE}${GUIDES_PATH}`, { headers: headers(auth) });
  if (!res.ok) throw new Error(`List guides failed: ${res.status}`);
  return (await res.json()) as GuideRef[];
}

async function uploadZip(auth: ApiAuth, url: string, method: "POST" | "PUT", zip: Buffer): Promise<GuideRef> {
  const form = new FormData();
  form.append("guide", new Blob([new Uint8Array(zip)], { type: "application/zip" }), "guide.zip");
  const res = await fetch(url, { method, headers: headers(auth), body: form });
  if (!res.ok) throw new Error(`Guide ${method} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as GuideRef;
}

export function createGuide(auth: ApiAuth, zip: Buffer): Promise<GuideRef> {
  return uploadZip(auth, `${CLOUD_API_BASE}${GUIDES_PATH}`, "POST", zip);
}

export function updateGuide(auth: ApiAuth, guideId: string, zip: Buffer): Promise<GuideRef> {
  return uploadZip(auth, `${CLOUD_API_BASE}${GUIDES_PATH}/${guideId}`, "PUT", zip);
}

export async function deleteGuide(auth: ApiAuth, guideId: string): Promise<void> {
  const res = await fetch(`${CLOUD_API_BASE}${GUIDES_PATH}/${guideId}`, { method: "DELETE", headers: headers(auth) });
  if (!res.ok) throw new Error(`Delete guide failed: ${res.status}`);
}

/** Idempotent push on externalId = route id (SPEC §5.2.5, §5.4). */
export async function upsertGuideForRoute(auth: ApiAuth, externalId: string, zip: Buffer): Promise<GuideRef> {
  const existing = (await listGuides(auth)).find((g) => g.externalId === externalId);
  return existing ? updateGuide(auth, existing.id, zip) : createGuide(auth, zip);
}
