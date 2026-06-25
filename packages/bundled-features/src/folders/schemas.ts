import { z } from "zod";

// set-folder + clear-folder share the (entity) reference shape; set-folder adds
// the target folderId. Folder catalog CRUD (create/update/delete) uses the
// generic defineEntity*Handler schemas — no hand-written schema needed there.
const entityRef = {
  entityType: z.string().min(1).max(64),
  entityId: z.string().min(1).max(128),
} as const;

export const setFolderPayloadSchema = z.object({
  folderId: z.string().min(1).max(64),
  ...entityRef,
});
export type SetFolderPayload = z.infer<typeof setFolderPayloadSchema>;

export const clearFolderPayloadSchema = z.object(entityRef);
export type ClearFolderPayload = z.infer<typeof clearFolderPayloadSchema>;
