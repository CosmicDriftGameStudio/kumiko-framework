import { selectMany, type WhereObject } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
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
    const where: WhereObject = { tenantId: query.user.tenantId };
    if (p.result) where["result"] = p.result;
    if (p.ip) where["ip"] = p.ip;
    if (p.from || p.to) {
      const range: { gte?: unknown; lte?: unknown } = {};
      if (p.from) range.gte = Temporal.Instant.from(p.from);
      if (p.to) range.lte = Temporal.Instant.from(p.to);
      where["attemptedAt"] = range;
    }

    const rows = await selectMany(ctx.db, downloadAttemptsTable, where, {
      orderBy: { col: "attemptedAt", direction: "desc" },
      limit: p.limit,
    });

    return { rows };
  },
});
