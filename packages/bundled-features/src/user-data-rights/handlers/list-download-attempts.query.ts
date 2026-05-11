import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { downloadAttemptsTable } from "../schema/download-attempt";

// Operator-Query: invalid Download-Attempts (S2.U7).
// DPO-Sicht fuer Brute-Force-Detection. Tenant-isolated via WHERE.

const MAX_LIMIT = 100;

export const listDownloadAttemptsQuery = defineQueryHandler({
  name: "list-download-attempts",
  schema: z
    .object({
      limit: z.number().int().min(1).max(MAX_LIMIT).default(50),
      result: z.enum(["notFound", "expired", "failed", "signedUrlNotSupported"]).optional(),
      ip: z.string().optional(),
      from: z.iso.datetime().optional(),
      to: z.iso.datetime().optional(),
    })
    .refine((v) => !v.from || !v.to || v.from <= v.to, {
      message: "`from` must be less than or equal to `to`",
    }),
  access: { roles: ["Admin", "SystemAdmin"] },
  handler: async (query, ctx) => {
    const p = query.payload;
    const t = downloadAttemptsTable;
    const conditions = [eq(t["tenantId"], query.user.tenantId)];
    if (p.result) conditions.push(eq(t["result"], p.result));
    if (p.ip) conditions.push(eq(t["ip"], p.ip));
    if (p.from) conditions.push(gte(t["attemptedAt"], Temporal.Instant.from(p.from)));
    if (p.to) conditions.push(lte(t["attemptedAt"], Temporal.Instant.from(p.to)));

    const rows = await ctx.db
      .select({
        id: t["id"],
        result: t["result"],
        via: t["via"],
        tokenHash: t["tokenHash"],
        jobId: t["jobId"],
        attemptedByUserId: t["attemptedByUserId"],
        ip: t["ip"],
        userAgent: t["userAgent"],
        attemptedAt: t["attemptedAt"],
      })
      .from(t)
      .where(and(...conditions))
      .orderBy(desc(t["attemptedAt"]))
      .limit(p.limit);

    return { rows };
  },
});
