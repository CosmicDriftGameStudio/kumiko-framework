import { z } from "zod";

// Toggle-change event payload.
//
// Contract: every set-operation produces exactly one event, even when
// enabled === previousEnabled. Redundant writes are legal (confirms the
// current state, useful for ops "make sure feature X is on"), so consumers
// that filter for actual transitions must compare enabled !== previousEnabled
// themselves. `previousEnabled` is null when this is the first time the
// feature is being toggled (no row existed).
export const featureToggleSetSchema = z.object({
  featureName: z.string().min(1),
  enabled: z.boolean(),
  previousEnabled: z.boolean().nullable(),
  updatedBy: z.string(),
});

export type FeatureToggleSetPayload = z.infer<typeof featureToggleSetSchema>;
