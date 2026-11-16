import type { ValidationError } from "@cosmicdrift/kumiko-types/hooks";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import * as z from "zod";

export const TAG_COLOR_PATTERN = /^(#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}))?$/;

export const createTagPayloadSchema = z.object({
  name: z.string().trim().min(1).max(64),
  color: z
    .string()
    .regex(TAG_COLOR_PATTERN, "color must be a hex code (#rgb or #rrggbb)")
    .optional(),
  scope: z.string().max(64).optional(),
});
export type CreateTagPayload = z.infer<typeof createTagPayloadSchema>;

// delete-tag — hard-deletes the catalog tag AND cascades a soft-delete over
// every assignment carrying it (no FK, so the handler does the cascade). No
// version: deleting a label is a destructive "make it gone" intent — last writer
// wins toward deletion rather than 409-ing on a concurrent rename. Idempotent.
export const deleteTagPayloadSchema = z.object({
  id: z.string().min(1),
});
export type DeleteTagPayload = z.infer<typeof deleteTagPayloadSchema>;

// assign + remove share the (tag, entity) reference shape.
// entityType/entityId are app-supplied, unlike tagId (always a real tag's
// UUID) — tagAssignmentAggregateId joins all four with "|" to derive the
// stream id, so a literal "|" in either could shift tuple boundaries and
// collide with an unrelated (tenant, tag, entity) combination (456/3).
// Rejecting it here is cheaper and non-breaking compared to changing the
// derivation's separator, which would re-key every existing stream.
const NO_PIPE = /^[^|]*$/;
const entityTagRef = {
  tagId: z.string().min(1).max(64),
  entityType: z.string().min(1).max(64).regex(NO_PIPE, 'entityType must not contain "|"'),
  entityId: z.string().min(1).max(128).regex(NO_PIPE, 'entityId must not contain "|"'),
} as const;

export const assignTagPayloadSchema = z.object(entityTagRef);
export type AssignTagPayload = z.infer<typeof assignTagPayloadSchema>;

export const removeTagPayloadSchema = z.object(entityTagRef);
export type RemoveTagPayload = z.infer<typeof removeTagPayloadSchema>;

// tag:update derives its schema from the entity, so the hex check on the changed colour runs as a validation hook.
export function rejectInvalidTagColorChange(
  data: Readonly<Record<string, unknown>>,
): readonly ValidationError[] | null {
  const color = propertyOf(propertyOf(data, "changes"), "color");
  if (typeof color === "string" && !TAG_COLOR_PATTERN.test(color)) {
    return [{ field: "color", error: "invalid_color" }];
  }
  return null;
}
