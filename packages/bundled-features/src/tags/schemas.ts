import { z } from "zod";

export const createTagPayloadSchema = z.object({
  name: z.string().min(1).max(64),
  color: z.string().max(32).optional(),
});
export type CreateTagPayload = z.infer<typeof createTagPayloadSchema>;

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
