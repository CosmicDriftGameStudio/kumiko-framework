import { defineWriteHandler, type HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import * as z from "zod";
import { listAllWaitlistRows, purgeWaitlistRows } from "../entries-admin.ts";
import { adminAccess, waitlistDb } from "../lib.ts";
import {
  WAITLIST_AUDIT_AGGREGATE_TYPE,
  WAITLIST_EXPORTED_EVENT_QN,
  WAITLIST_PURGED_EVENT_QN,
  WaitlistErrors,
} from "../web/constants.ts";

export type WaitlistExportData = {
  readonly count: number;
  readonly entries: readonly Record<string, unknown>[];
};
export type WaitlistPurgeData = { readonly purged: number };

const PurgeSchema = z.object({ confirmCount: z.number().int().min(0) }).strict();
const ExportSchema = z.object({}).strict();

async function appendAudit(ctx: HandlerContext, type: string, count: number): Promise<void> {
  await ctx.unsafeAppendEvent({
    aggregateId: generateId(),
    aggregateType: WAITLIST_AUDIT_AGGREGATE_TYPE,
    type,
    payload: { count },
  });
}

function exportedRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row["id"],
    name: row["name"],
    email: row["email"],
    company: row["company"],
    portfolio: row["portfolio"],
    message: row["message"],
    locale: row["locale"],
    status: row["status"],
    submittedAt: String(row["submittedAt"] ?? ""),
  };
}

export const exportHandler = defineWriteHandler<"export", typeof ExportSchema, WaitlistExportData>({
  name: "export",
  schema: ExportSchema,
  access: adminAccess,
  agent: { expose: false, risk: "high" },
  description:
    "Returns every waitlist entry with its personal data for a hand-over and records the export as an audit event that carries only the count.",
  handler: async (_event, ctx) => {
    const rows = await listAllWaitlistRows(waitlistDb(ctx));
    await appendAudit(ctx, WAITLIST_EXPORTED_EVENT_QN, rows.length);
    return { isSuccess: true, data: { count: rows.length, entries: rows.map(exportedRow) } };
  },
});

export const purgeHandler = defineWriteHandler<"purge", typeof PurgeSchema, WaitlistPurgeData>({
  name: "purge",
  schema: PurgeSchema,
  access: adminAccess,
  agent: { expose: false, risk: "high" },
  description:
    "Erases every waitlist entry and shreds its personal data. confirmCount must equal the current entry count, so a stale export cannot purge newer entries.",
  handler: async (event, ctx) => {
    const db = waitlistDb(ctx);
    const rows = await listAllWaitlistRows(db);
    if (rows.length !== event.payload.confirmCount) {
      return writeFailure(
        new UnprocessableError(WaitlistErrors.confirmCountMismatch, {
          details: { confirmCount: event.payload.confirmCount, actualCount: rows.length },
        }),
      );
    }
    // Audit first: purgeWaitlistRows shreds KMS keys, which a later failure cannot roll back.
    await appendAudit(ctx, WAITLIST_PURGED_EVENT_QN, rows.length);
    await purgeWaitlistRows(db, rows, event.user.id);
    return { isSuccess: true, data: { purged: rows.length } };
  },
});
