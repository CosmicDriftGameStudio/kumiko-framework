import type { AccessRule, QueryHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import type { WhereObject } from "@cosmicdrift/kumiko-types/where-clause-types";
import * as z from "zod";
import { transactionTable } from "../executor.ts";
import type { LedgerTxRow } from "../recurring.ts";
import { normalizeLines } from "../reports.ts";
import { periodSchema } from "../schemas.ts";
import { DEFAULT_LEDGER_ACCESS, type TransactionStatus } from "../web/constants.ts";

const POSTED: TransactionStatus = "posted";

const subjectTotalsSchema = z.object({
  subjectType: z.string().min(1).max(64),
  subjectIds: z.array(z.string().min(1).max(128)).min(1).max(500),
  accountIds: z.array(z.string().min(1)).min(1).max(200).optional(),
  periodFrom: periodSchema.optional(),
  periodTo: periodSchema.optional(),
  asOf: z.string().date().optional(),
  byPeriod: z.boolean().optional(),
});

const scheduleActualsSchema = z.object({
  scheduleIds: z.array(z.string().min(1).max(64)).min(1).max(500),
  periodFrom: periodSchema.optional(),
  periodTo: periodSchema.optional(),
});

type PeriodRange = { readonly periodFrom?: string | undefined; readonly periodTo?: string | undefined };

function addPeriodBounds(where: WhereObject, range: PeriodRange): void {
  const bounds: { gte?: string; lte?: string } = {};
  if (range.periodFrom !== undefined) bounds.gte = range.periodFrom;
  if (range.periodTo !== undefined) bounds.lte = range.periodTo;
  if (Object.keys(bounds).length > 0) where["period"] = bounds;
}

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

type SubjectTotalRow = {
  subjectId: string;
  period: string | null;
  accountId: string;
  amount: number;
};

function compareNullsFirst(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a.localeCompare(b);
}

// ponytail: sums posted rows of the requested subjects per request (indexed, one query); add a postings projection when measured latency on large ledgers demands it (see docs/reference/decisions.md).
export function createSubjectTotalsHandler(
  access: AccessRule = DEFAULT_LEDGER_ACCESS,
): QueryHandlerDef {
  return {
    name: "report:subject-totals",
    schema: subjectTotalsSchema,
    access,
    description:
      "Returns net signed posting totals per subject, account and optionally period for up to 500 subjects in one call (posted entries only, Storno pairs net out); use it for rent balances, direct-debit previews or any per-contract saldo instead of paging transactions.",
    handler: async (query, ctx) => {
      const input = subjectTotalsSchema.parse(query);
      const where: WhereObject = {
        tenantId: ctx.user.tenantId,
        status: POSTED,
        subjectType: input.subjectType,
        subjectId: { in: input.subjectIds },
      };
      addPeriodBounds(where, input);
      if (input.asOf !== undefined) where["date"] = { lte: input.asOf };

      const txRows = await ctx.db.selectMany(transactionTable, where, {
        fields: ["subjectId", "period", "lines"],
      });
      const accountFilter = input.accountIds === undefined ? null : new Set(input.accountIds);
      const totals = new Map<string, SubjectTotalRow>();
      for (const row of txRows) {
        const subjectId = String(row["subjectId"]);
        const period = input.byPeriod === true ? nullableString(row["period"]) : null;
        for (const line of normalizeLines(row["lines"])) {
          if (accountFilter !== null && !accountFilter.has(line.accountId)) continue;
          const key = JSON.stringify([subjectId, period, line.accountId]);
          const entry = totals.get(key);
          if (entry) entry.amount += line.amount;
          else totals.set(key, { subjectId, period, accountId: line.accountId, amount: line.amount });
        }
      }
      const rows = [...totals.values()]
        .filter((t) => t.amount !== 0)
        .sort(
          (a, b) =>
            a.subjectId.localeCompare(b.subjectId) ||
            compareNullsFirst(a.period, b.period) ||
            a.accountId.localeCompare(b.accountId),
        );
      return { rows };
    },
  };
}

export function createScheduleActualsHandler(
  access: AccessRule = DEFAULT_LEDGER_ACCESS,
): QueryHandlerDef {
  return {
    name: "schedule-actuals",
    schema: scheduleActualsSchema,
    access,
    description:
      "Returns the posted entries (including Storno entries) booked against the given schedules and optional period range in one call, shaped for mergeScheduleActuals; use it to show forecast versus actual for standing orders without paging the journal.",
    handler: async (query, ctx) => {
      const input = scheduleActualsSchema.parse(query);
      const where: WhereObject = {
        tenantId: ctx.user.tenantId,
        status: POSTED,
        scheduleId: { in: input.scheduleIds },
      };
      addPeriodBounds(where, input);
      const txRows = await ctx.db.selectMany(transactionTable, where, {
        fields: ["id", "scheduleId", "period", "reversesTransactionId", "lines"],
      });
      const rows: LedgerTxRow[] = txRows
        .map((row) => ({
          id: String(row["id"]),
          scheduleId: nullableString(row["scheduleId"]),
          period: nullableString(row["period"]),
          reversesTransactionId: nullableString(row["reversesTransactionId"]),
          lines: normalizeLines(row["lines"]),
        }))
        .sort(
          (a, b) =>
            compareNullsFirst(a.scheduleId, b.scheduleId) ||
            compareNullsFirst(a.period, b.period) ||
            a.id.localeCompare(b.id),
        );
      return { rows };
    },
  };
}
