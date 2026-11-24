import { unsafeReadRetrying } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { AccessDeniedError, InternalError } from "@cosmicdrift/kumiko-framework/errors";
import {
  FILES_STORAGE_TRACKING_FEATURE,
  tenantStorageUsageTable,
} from "@cosmicdrift/kumiko-framework/files";
import * as z from "zod";
import { currentCalendarMonthStartIso } from "../../cap-counter/index.ts";
import { secretsMatch } from "./last-activity-probe.query.ts";

export const USAGE_PROBE_QUERY = "sessions:query:usage-probe";

const USAGE_ESCAPE_HATCH_REASON =
  "answers one sibling app with this app's database size, file bytes and mails sent this month across every tenant, guarded by a shared secret; raw SQL because sessions cannot import delivery";

// sessions must not import delivery (cycle sessions -> delivery -> user -> sessions), so the table
// is addressed by name; the integration test pins it against the real delivery table.
const DELIVERY_ATTEMPTS_TABLE = "store_delivery_attempts";

// null = the app does not mount the feature that measures it.
export const usageProbeAnswerSchema = z.object({
  dbBytes: z.number(),
  fileBytes: z.number().nullable(),
  mailsSentThisMonth: z.number().nullable(),
});

export type UsageProbeAnswer = z.infer<typeof usageProbeAnswerSchema>;

export function createUsageProbeQuery(secret: string) {
  return defineQueryHandler({
    name: "usage-probe",
    schema: z.object({ bearerToken: z.string().min(1).max(512) }),
    access: { roles: ["anonymous"] },
    agent: { expose: false },
    rateLimit: { per: "ip", limit: 30, windowSeconds: 60 },
    escapeHatch: { grants: ["crossTenantReads", "unsafeRaw"], reason: USAGE_ESCAPE_HATCH_REASON },
    description:
      "Returns database size, file bytes and mails sent this month across every tenant of this app to a sibling app that presents the shared probe secret.",
    handler: async (query, ctx) => {
      if (!secretsMatch(query.payload.bearerToken, secret)) {
        throw new AccessDeniedError();
      }
      if (!ctx.crossTenantReads) {
        throw new InternalError({ message: "sessions usage probe: crossTenantReads missing" });
      }
      const { crossTenantReads } = ctx;

      const [sizeRow] = await unsafeReadRetrying<{ size: string | number }>(
        ctx.db.unsafeRawAllTenants(),
        "select pg_database_size(current_database())::bigint as size",
        [],
      );
      if (!sizeRow) throw new InternalError({ message: "sessions usage probe: no db size row" });

      let fileBytes: number | null = null;
      if (ctx.registry.getFeature(FILES_STORAGE_TRACKING_FEATURE) !== undefined) {
        const [sum] = await crossTenantReads.aggregate(tenantStorageUsageTable, {
          measure: { fn: "sum", field: "totalBytes" },
        });
        fileBytes = sum?.value ?? 0;
      }

      const [tableRow] = await unsafeReadRetrying<{ present: boolean }>(
        ctx.db.unsafeRawAllTenants(),
        "select to_regclass($1) is not null as present",
        [DELIVERY_ATTEMPTS_TABLE],
      );
      let mailsSentThisMonth: number | null = null;
      if (tableRow?.present) {
        const [mailRow] = await unsafeReadRetrying<{ total: string | number }>(
          ctx.db.unsafeRawAllTenants(),
          `select count(*) as total from ${DELIVERY_ATTEMPTS_TABLE} where channel = 'email' and status = 'sent' and created_at >= $1`,
          [currentCalendarMonthStartIso()],
        );
        mailsSentThisMonth = Number(mailRow?.total ?? 0);
      }

      return { dbBytes: Number(sizeRow.size), fileBytes, mailsSentThisMonth };
    },
  });
}
