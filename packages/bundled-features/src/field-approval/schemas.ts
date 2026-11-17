import * as z from "zod";

// entityType/entityId/fieldName are joined with "|" to derive the request's aggregate id, so a
// literal "|" could shift tuple boundaries and collide with an unrelated request.
const NO_PIPE = /^[^|]*$/;

export const requestFieldChangePayloadSchema = z.object({
  entityType: z.string().min(1).max(64).regex(NO_PIPE, 'entityType must not contain "|"'),
  entityId: z.string().min(1).max(128).regex(NO_PIPE, 'entityId must not contain "|"'),
  fieldName: z.string().min(1).max(64).regex(NO_PIPE, 'fieldName must not contain "|"'),
  value: z.unknown(),
});
export type RequestFieldChangePayload = z.infer<typeof requestFieldChangePayloadSchema>;

export const decideFieldChangePayloadSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
});
export type DecideFieldChangePayload = z.infer<typeof decideFieldChangePayloadSchema>;

export const pendingFieldChangesQuerySchema = z.object({
  entityType: z.string().max(64).optional(),
  entityId: z.string().max(128).optional(),
});
export type PendingFieldChangesQuery = z.infer<typeof pendingFieldChangesQuerySchema>;
