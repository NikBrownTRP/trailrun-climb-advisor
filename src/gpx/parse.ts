import { XMLParser } from "fast-xml-parser";

export interface GpxPoint {
  lat: number;
  lon: number;
  ele: number;
  cumDist: number; // m from start
}

/** Haversine distance in metres. */
function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Parse GPX text into distance-stamped points. Throws if any point lacks <ele>. */
export function parseGpx(xml: string): GpxPoint[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const doc = parser.parse(xml);

  // Accept track points (trkpt) or route points (rtept).
  const raw: any[] = [];
  const trksegs = toArray(doc?.gpx?.trk).flatMap((t: any) => toArray(t?.trkseg));
  for (const seg of trksegs) raw.push(...toArray(seg?.trkpt));
  for (const rte of toArray(doc?.gpx?.rte)) raw.push(...toArray(rte?.rtept));

  if (raw.length === 0) throw new Error("GPX contains no track or route points.");

  const pts: GpxPoint[] = [];
  let cumDist = 0;
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const ele = r?.ele;
    if (ele === undefined || ele === null || ele === "") {
      throw new Error("GPX point is missing elevation (<ele>); cannot segment climbs.");
    }
    const lat = Number(r["@_lat"]);
    const lon = Number(r["@_lon"]);
    if (i > 0) cumDist += haversine(pts[i - 1].lat, pts[i - 1].lon, lat, lon);
    pts.push({ lat, lon, ele: Number(ele), cumDist });
  }
  return pts;
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}
