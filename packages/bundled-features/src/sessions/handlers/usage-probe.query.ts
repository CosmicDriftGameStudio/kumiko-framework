import { unsafeReadRetrying } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { AccessDeniedError, InternalError } from "@cosmicdrift/kumiko-framework/errors";
import {
  FILES_STORAGE_TRACKING_FEATURE,
  tenantStorageUsageTable,
} from "@cosmicdrift/kumiko-framework/files";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { currentCalendarMonthStartIso } from "../../cap-counter/index.ts";
import { deliveryAttemptsTable } from "../../delivery/tables.ts";
import { DELIVERY_FEATURE } from "../../delivery/web/public-names.ts";
import { secretsMatch } from "./last-activity-probe.query.ts";

export const USAGE_PROBE_QUERY = "sessions:query:usage-probe";

const USAGE_ESCAPE_HATCH_REASON =
  "answers one sibling app with this app's database size, file bytes and mails sent this month across every tenant, guarded by a shared secret";

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

      let mailsSentThisMonth: number | null = null;
      if (ctx.registry.getFeature(DELIVERY_FEATURE) !== undefined) {
        mailsSentThisMonth = await crossTenantReads.count(deliveryAttemptsTable, {
          channel: "email",
          status: "sent",
          createdAt: { gte: Temporal.Instant.from(currentCalendarMonthStartIso()) },
        });
      }

      return { dbBytes: Number(sizeRow.size), fileBytes, mailsSentThisMonth };
    },
  });
}
