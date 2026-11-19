import {
  type AccessRule,
  defineQueryHandler,
  type HandlerContext,
} from "@cosmicdrift/kumiko-framework/engine";
import type { WhereObject } from "@cosmicdrift/kumiko-types/where-clause-types";
import * as z from "zod";
import { accountTable, transactionTable } from "../executor.ts";
import {
  accountBalances,
  balanceSheet,
  incomeStatement,
  type LedgerAccount,
  type LedgerEntry,
  toAccounts,
  toEntries,
} from "../reports.ts";
import { DEFAULT_LEDGER_ACCESS, type TransactionStatus } from "../web/constants.ts";

const POSTED: TransactionStatus = "posted";

// Reports take an optional reporting period. Balance-sheet is cumulative → pass
// { to: asOf }; income-statement is a period → { from, to }. Both bounds are
// inclusive ISO dates because they are compared against the date column in SQL.
const periodSchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

type ReportPeriod = z.infer<typeof periodSchema>;

async function loadBooks(
  ctx: HandlerContext,
  period: ReportPeriod,
): Promise<{ accounts: LedgerAccount[]; entries: LedgerEntry[] }> {
  const accountRows = await ctx.db.selectMany(accountTable, { tenantId: ctx.user.tenantId });
  const where: WhereObject = { tenantId: ctx.user.tenantId, status: POSTED };
  const dateBounds: { gte?: string; lte?: string } = {};
  if (period.from !== undefined) dateBounds.gte = period.from;
  if (period.to !== undefined) dateBounds.lte = period.to;
  if (Object.keys(dateBounds).length > 0) where["date"] = dateBounds;
  const txRows = await ctx.db.selectMany(transactionTable, where);
  return { accounts: toAccounts(accountRows), entries: toEntries(txRows) };
}

function createPeriodReportHandler(
  report: {
    readonly name: string;
    readonly description: string;
    readonly compute: (
      accounts: LedgerAccount[],
      entries: LedgerEntry[],
      period: ReportPeriod,
    ) => unknown;
  },
  access: AccessRule,
) {
  return defineQueryHandler({
    name: report.name,
    schema: periodSchema,
    access,
    description: report.description,
    handler: async (query, ctx) => {
      const period = query.payload;
      const { accounts, entries } = await loadBooks(ctx, period);
      return report.compute(accounts, entries, period);
    },
  });
}

const BALANCES_REPORT = {
  name: "report:balances",
  description:
    "Returns the per-account balance in its natural sign plus the trial balance over an optional from/to period; use it for a trial balance or to read one account's standing.",
  compute: accountBalances,
};

const INCOME_STATEMENT_REPORT = {
  name: "report:income-statement",
  description:
    "Returns income minus expense over an optional from/to period; use it for a profit-and-loss statement.",
  compute: incomeStatement,
};

const BALANCE_SHEET_REPORT = {
  name: "report:balance-sheet",
  description:
    "Returns assets, liabilities and equity as of the optional `to` date with the period result folded into equity so the sheet balances; use it for a balance sheet at a point in time.",
  compute: balanceSheet,
};

// Per-account balances (natural sign) + the trial balance (Σ raw = 0 invariant).
export function createBalancesReportHandler(access: AccessRule = DEFAULT_LEDGER_ACCESS) {
  return createPeriodReportHandler(BALANCES_REPORT, access);
}

// GuV — income − expense over the period.
export function createIncomeStatementHandler(access: AccessRule = DEFAULT_LEDGER_ACCESS) {
  return createPeriodReportHandler(INCOME_STATEMENT_REPORT, access);
}

// Bilanz as of `to` — current result folded into equity so it balances.
export function createBalanceSheetHandler(access: AccessRule = DEFAULT_LEDGER_ACCESS) {
  return createPeriodReportHandler(BALANCE_SHEET_REPORT, access);
}
