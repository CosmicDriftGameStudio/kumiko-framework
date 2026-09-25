import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createAnonymousUser,
  defineQueryHandler,
  isUuid,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import {
  isTenantServingPublicContent,
  type TenantLifecycleStatus,
  tenantTable,
} from "../../tenant";
import { PUBLIC_VARIANT_QN, publicVariantPayloadSchema } from "./public-variant.query";

type FileRefTenantRow = {
  readonly tenantId: TenantId;
};

type TenantGateRow = {
  readonly isEnabled: boolean;
  readonly status: TenantLifecycleStatus;
};

const BY_FILE_REF_ESCAPE_HATCH_REASON =
  "shared public host serves every tenant's public variants; the FileRef row names the tenant, and publicVariantQuery's isPublic gate still runs inside that tenant via queryAs — reading the FileRef's tenant row (isEnabled/status) first so a blocked tenant 404s identically to an unknown fileRef";

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
    const db = ctx.db.unsafeRaw(BY_FILE_REF_ESCAPE_HATCH_REASON);
    const row = await fetchOne<FileRefTenantRow>(db, fileRefsTable, {
      id: query.payload.fileRefId,
      isDeleted: false,
    });
    if (!row || !isUuid(row.tenantId)) return null;

    // A blocked tenant (disabled, or past active in its destroy lifecycle)
    // must 404 identically to an unknown fileRef — otherwise this shared
    // public host would keep serving a tenant's public variants after it
    // was disabled or asked to be destroyed.
    const tenant = await fetchOne<TenantGateRow>(db, tenantTable, { id: row.tenantId });
    if (!tenant || !isTenantServingPublicContent(tenant)) return null;

    return ctx.queryAs(createAnonymousUser(row.tenantId), PUBLIC_VARIANT_QN, query.payload);
  },
});
