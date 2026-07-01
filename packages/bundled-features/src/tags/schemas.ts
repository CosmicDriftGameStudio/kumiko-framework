import { z } from "zod";

export const createTagPayloadSchema = z.object({
  name: z.string().trim().min(1).max(64),
  color: z
    .string()
    .regex(/^(#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}))?$/, "color must be a hex code (#rgb or #rrggbb)")
    .optional(),
  scope: z.string().max(64).optional(),
});
export type CreateTagPayload = z.infer<typeof createTagPayloadSchema>;

// update-tag — id + the version the client read (optimistic lock, mirrors
// tenant:update) + the fields to change. name/color/scope are each optional so
// the management UI can rename, recolor or re-scope independently; the executor
// shallow-merges, so any field left undefined is preserved. color/scope accept ""
// to clear them. At least one mutable field must be present (no-op guard).
export const updateTagPayloadSchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(64).optional(),
    color: z
      .string()
      .regex(/^(#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}))?$/, "color must be a hex code (#rgb or #rrggbb)")
      .optional(),
    scope: z.string().max(64).optional(),
  })
  .refine((p) => p.name !== undefined || p.color !== undefined || p.scope !== undefined, {
    message: "update-tag needs at least one of name, color or scope",
  });
export type UpdateTagPayload = z.infer<typeof updateTagPayloadSchema>;

// delete-tag — hard-deletes the catalog tag AND cascades a soft-delete over
// every assignment carrying it (no FK, so the handler does the cascade). No
// version: deleting a label is a destructive "make it gone" intent — last writer
// wins toward deletion rather than 409-ing on a concurrent rename. Idempotent.
export const deleteTagPayloadSchema = z.object({
  id: z.string().min(1),
});
export type DeleteTagPayload = z.infer<typeof deleteTagPayloadSchema>;

// assign + remove share the (tag, entity) reference shape.
const entityTagRef = {
  tagId: z.string().min(1).max(64),
  entityType: z.string().min(1).max(64),
  entityId: z.string().min(1).max(128),
} as const;

export const assignTagPayloadSchema = z.object(entityTagRef);
export type AssignTagPayload = z.infer<typeof assignTagPayloadSchema>;

export const removeTagPayloadSchema = z.object(entityTagRef);
export type RemoveTagPayload = z.infer<typeof removeTagPayloadSchema>;
