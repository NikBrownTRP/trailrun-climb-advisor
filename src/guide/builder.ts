import type { Guide } from "./schema";
import type { Profile, Segment, Advice } from "../core/types";
import { advise } from "../core/advice";
import { TRAIL_RUN_ACTIVITY_ID } from "../suunto/constants";

export interface BuildOpts {
  routeId: string;
  routeName: string;
  approachLeadMeters?: number; // notify this far before the climb (SPEC §5.2.4)
  localDate?: string;
}

const MODE_WORD: Record<Advice["mode"], string> = {
  RUN: "run",
  POWER_HIKE: "power-hike",
  HIKE: "hike",
};

/** Build a schema-valid SuuntoPlus Guide from climbs + profile (SPEC §2, §5.2.4). */
export function buildGuide(climbs: Segment[], profile: Profile, opts: BuildOpts): Guide {
  const lead = opts.approachLeadMeters ?? 200;
  const steps: Guide["steps"] = [];

  climbs.forEach((climb, idx) => {
    const adv = advise(climb, profile);

    // Approach/cruise step: waits until the climb start, then notifies.
    const approachTransitions: Array<{ condition: any; stepId?: string }> = [];
    if (climb.startLat != null && climb.startLon != null) {
      // primary: location at the climb start (distance = min distance into step before matching)
      approachTransitions.push({
        condition: {
          type: "location",
          latitude: climb.startLat,
          longitude: climb.startLon,
          distance: lead,
        },
        stepId: `climb-${idx}`,
      });
    }
    // fallback: absolute distance into workout, at the climb start
    approachTransitions.push({
      condition: { type: "distance", value: climb.distanceIntoRoute },
      stepId: `climb-${idx}`,
    });

    steps.push({
      type: "fields",
      id: `approach-${idx}`,
      fields: [{ type: "distance" }],
      notification: {
        title: notifTitle(climb),
        text: notifText(climb, adv),
      },
      transitions: approachTransitions,
    });

    // During-climb step: HR gauge + countdown + mode reminder.
    steps.push({
      type: "fields",
      id: `climb-${idx}`,
      title: `Climb ${idx + 1}`.slice(0, 13),
      fields: [
        { type: "targetHeartRate", min: adv.targetHR.min, max: adv.targetHR.max },
        { type: "verticalSpeed" },
        { type: "stepDistanceCountdown" },
        { type: "text", text: climbReminder(climb, adv) },
      ],
      transitions: [
        { condition: { type: "stepDistance", value: Math.round(climb.length) } },
      ],
    });
  });

  return {
    type: "sequence",
    name: `Climb Advisor — ${opts.routeName}`.slice(0, 60),
    description: `Auto-generated climb advice for ${opts.routeName}`.slice(0, 256),
    shortDescription: "Climb".slice(0, 23),
    owner: "Bike AI Lab",
    url: "https://example.com",
    activities: [TRAIL_RUN_ACTIVITY_ID],
    usage: "workout",
    ...(opts.localDate ? { localDate: opts.localDate } : {}),
    externalId: opts.routeId,
    steps,
  };
}

function notifTitle(climb: Segment): string {
  // e.g. "Climb 600m" — distance is the climb length, rounded. ≤13 chars.
  return `Climb ${Math.round(climb.length)}m`.slice(0, 13);
}

function notifText(climb: Segment, adv: Advice): string {
  // e.g. "14% · power-hike · poles · HR<155" — ≤54 chars.
  const pct = Math.round(climb.gradient * 100);
  const poles = adv.poles ? " · poles" : "";
  return `${pct}% · ${MODE_WORD[adv.mode]}${poles} · HR<${adv.targetHR.max}`.slice(0, 54);
}

function climbReminder(climb: Segment, adv: Advice): string {
  const pct = Math.round(climb.gradient * 100);
  return `${pct}% ${MODE_WORD[adv.mode]}${adv.poles ? " +poles" : ""}`.slice(0, 54);
}
