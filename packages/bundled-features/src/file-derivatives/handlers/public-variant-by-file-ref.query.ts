import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createAnonymousUser,
  defineQueryHandler,
  isUuid,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { PUBLIC_VARIANT_QN, publicVariantPayloadSchema } from "./public-variant.query";

type FileRefTenantRow = {
  readonly tenantId: TenantId;
};

const BY_FILE_REF_ESCAPE_HATCH_REASON =
  "shared public host serves every tenant's public variants; the FileRef row names the tenant, and publicVariantQuery's isPublic gate still runs inside that tenant via queryAs";

// Full QN this handler is registered under, mirrors PUBLIC_VARIANT_QN.
export const PUBLIC_VARIANT_BY_FILE_REF_QN = "file-derivatives:query:public-variant-by-file-ref";

export const publicVariantByFileRefQuery = defineQueryHandler({
  name: "public-variant-by-file-ref",
  schema: publicVariantPayloadSchema,
  access: { roles: ["anonymous", "User", "TenantAdmin", "SystemAdmin"] },
  agent: { expose: false },
  rateLimit: { per: "ip", limit: 60, windowSeconds: 60 },
  escapeHatch: {
    reason: BY_FILE_REF_ESCAPE_HATCH_REASON,
  },
  handler: async (query, ctx) => {
    const row = await fetchOne<FileRefTenantRow>(
      ctx.db.unsafeRaw(BY_FILE_REF_ESCAPE_HATCH_REASON),
      fileRefsTable,
      { id: query.payload.fileRefId, isDeleted: false },
    );
    if (!row || !isUuid(row.tenantId)) return null;

    return ctx.queryAs(createAnonymousUser(row.tenantId), PUBLIC_VARIANT_QN, query.payload);
  },
});
