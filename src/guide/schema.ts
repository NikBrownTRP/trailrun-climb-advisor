import { z } from "zod";

// SPEC §2.4 display + gauge field types.
const FieldType = z.enum([
  "text", "heartRate", "speed", "pace", "power", "altitude", "distance",
  "duration", "temperature", "cadence", "ascent", "descent", "verticalSpeed",
  "ascentTime", "descentTime", "energy",
  "stepDistanceCountdown", "stepDurationCountdown",
  "targetHeartRate", "targetSpeed", "targetPace", "targetPower", "targetCadence",
]);

const Field = z.object({
  type: FieldType,
  title: z.string().optional(),
  text: z.string().max(54).optional(),
  window: z.enum(["workout", "step", "manualLap"]).optional(),
  aggregate: z.enum(["average", "min", "max"]).optional(),
  value: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
}).strict();

// SPEC §2.3 conditions. Recursive for or/and.
const Condition: z.ZodType<any> = z.lazy(() =>
  z.object({
    type: z.enum([
      "distance", "stepDistance", "duration", "stepDuration",
      "location", "routeCompleted", "routeExited", "manualLap", "or", "and",
    ]),
    value: z.number().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    distance: z.number().optional(),
    direction: z.number().optional(),
    conditions: z.array(Condition).optional(),
  }).strict(),
);

const Transition = z.object({
  condition: Condition,
  stepId: z.string().optional(),
}).strict();

const Notification = z.object({
  title: z.string().max(13).optional(),
  text: z.string().max(54).optional(),
}).strict();

const FieldsStep = z.object({
  type: z.literal("fields"),
  id: z.string().optional(),
  title: z.string().max(13).optional(),
  fields: z.array(Field).min(1),
  transitions: z.array(Transition).optional(),
  notification: Notification.optional(),
  createManualLap: z.boolean().optional(),
}).strict();

const RepeatStep = z.object({
  type: z.literal("repeat"),
  times: z.number().int().min(1).max(100),
  steps: z.array(FieldsStep),
}).strict();

const Step = z.union([FieldsStep, RepeatStep]);

export const GuideSchema = z.object({
  type: z.literal("sequence"),
  name: z.string().min(1).max(60),
  description: z.string().min(1).max(256),
  richText: z.string().max(100000).optional(),
  shortDescription: z.string().min(1).max(23),
  owner: z.string().min(1).max(64),
  url: z.string().url(),
  activities: z.array(z.number()).optional(),
  usage: z.literal("workout"),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  externalId: z.string().optional(),
  steps: z.array(Step).min(1).max(1000),
}).strict();

export type Guide = z.infer<typeof GuideSchema>;
