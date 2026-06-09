import { CLOUD_API_BASE } from "./constants";

export interface ApiAuth { accessToken: string; subscriptionKey: string; }

/** Export a route as GPX (SPEC §3.1). Returns the raw GPX text. */
export async function exportRouteGpx(auth: ApiAuth, routeId: string): Promise<string> {
  const res = await fetch(`${CLOUD_API_BASE}/v2/route/${routeId}/export`, {
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "Ocp-Apim-Subscription-Key": auth.subscriptionKey,
      Accept: "application/gpx+xml",
    },
  });
  if (!res.ok) throw new Error(`Route export failed: ${res.status} ${await res.text()}`);
  return res.text();
}
