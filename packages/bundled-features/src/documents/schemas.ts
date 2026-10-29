import * as z from "zod";

export const documentLinkPayloadSchema = z.object({
  documentId: z.uuid(),
  entityType: z.string().min(1).max(64),
  entityId: z.string().min(1).max(128),
});
export type DocumentLinkPayload = z.infer<typeof documentLinkPayloadSchema>;

const isoDate = z.iso.date();

export const importDocumentPayloadSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1).max(200),
  category: z.string().min(1),
  issuedAt: isoDate.optional(),
  validUntil: isoDate.optional(),
  fileRefId: z.uuid(),
  links: z.array(
    z.object({ entityType: z.string().min(1).max(64), entityId: z.string().min(1).max(128) }),
  ),
  deleted: z.boolean().optional(),
});
export type ImportDocumentPayload = z.infer<typeof importDocumentPayloadSchema>;

export const forRecordPayloadSchema = z.object({
  entityType: z.string().min(1).max(64),
  entityId: z.string().min(1).max(128),
  limit: z.number().int().nonnegative().max(200).optional(),
  cursor: z.string().optional(),
  offset: z.number().int().nonnegative().optional(),
  search: z.string().optional(),
  sort: z.string().optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
  totalCount: z.boolean().optional(),
  filter: z
    .object({
      field: z.string(),
      op: z.enum(["eq", "ne", "lt", "gt", "lte", "gte", "in"]),
      value: z.unknown(),
    })
    .optional(),
  filters: z
    .array(
      z.object({
        field: z.string(),
        op: z.enum(["eq", "ne", "lt", "gt", "lte", "gte", "in"]),
        value: z.unknown(),
      }),
    )
    .optional(),
});
export type ForRecordPayload = z.infer<typeof forRecordPayloadSchema>;

export const overviewPayloadSchema = forRecordPayloadSchema.omit({
  entityType: true,
  entityId: true,
  filter: true,
});
export type OverviewPayload = z.infer<typeof overviewPayloadSchema>;

export const expiryOverviewPayloadSchema = z.object({
  entityType: z.string().min(1).max(64).optional(),
  entityId: z.string().min(1).max(128).optional(),
});
export type ExpiryOverviewPayload = z.infer<typeof expiryOverviewPayloadSchema>;
