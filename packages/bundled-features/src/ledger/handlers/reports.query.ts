import type { AccessRule, QueryHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
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
import { DEFAULT_LEDGER_ACCESS } from "../web/constants.ts";

// Reports take an optional reporting period. Balance-sheet is cumulative → pass
// { to: asOf }; income-statement is a period → { from, to }.
const periodSchema = z.object({
  from: z.string().min(1).max(32).optional(),
  to: z.string().min(1).max(32).optional(),
});

type QueryCtx = Parameters<QueryHandlerDef["handler"]>[1];

async function loadBooks(
  ctx: QueryCtx,
): Promise<{ accounts: LedgerAccount[]; entries: LedgerEntry[] }> {
  const accountRows = await ctx.db.selectMany(accountTable, { tenantId: ctx.user.tenantId });
  const txRows = await ctx.db.selectMany(transactionTable, { tenantId: ctx.user.tenantId });
  return { accounts: toAccounts(accountRows), entries: toEntries(txRows) };
}

type ReportPeriod = z.infer<typeof periodSchema>;

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
): QueryHandlerDef {
  return {
    name: report.name,
    schema: periodSchema,
    access,
    description: report.description,
    handler: async (query, ctx) => {
      const period = periodSchema.parse(query);
      const { accounts, entries } = await loadBooks(ctx);
      return report.compute(accounts, entries, period);
    },
  };
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
export function createBalancesReportHandler(
  access: AccessRule = DEFAULT_LEDGER_ACCESS,
): QueryHandlerDef {
  return createPeriodReportHandler(BALANCES_REPORT, access);
}

// GuV — income − expense over the period.
export function createIncomeStatementHandler(
  access: AccessRule = DEFAULT_LEDGER_ACCESS,
): QueryHandlerDef {
  return createPeriodReportHandler(INCOME_STATEMENT_REPORT, access);
}

// Bilanz as of `to` — current result folded into equity so it balances.
export function createBalanceSheetHandler(
  access: AccessRule = DEFAULT_LEDGER_ACCESS,
): QueryHandlerDef {
  return createPeriodReportHandler(BALANCE_SHEET_REPORT, access);
}
