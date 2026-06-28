import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { AccessRule, QueryHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { DEFAULT_LEDGER_ACCESS } from "../constants";
import { accountTable, transactionTable } from "../executor";
import {
  accountBalances,
  balanceSheet,
  incomeStatement,
  type LedgerAccount,
  type LedgerEntry,
  toAccounts,
  toEntries,
} from "../reports";

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
  const accountRows = await selectMany(ctx.db.raw, accountTable, { tenantId: ctx.user.tenantId });
  const txRows = await selectMany(ctx.db.raw, transactionTable, { tenantId: ctx.user.tenantId });
  return { accounts: toAccounts(accountRows), entries: toEntries(txRows) };
}

// Per-account balances (natural sign) + the trial balance (Σ raw = 0 invariant).
export function createBalancesReportHandler(
  access: AccessRule = DEFAULT_LEDGER_ACCESS,
): QueryHandlerDef {
  return {
    name: "report:balances",
    schema: periodSchema,
    access,
    handler: async (query, ctx) => {
      const period = periodSchema.parse(query);
      const { accounts, entries } = await loadBooks(ctx);
      return accountBalances(accounts, entries, period);
    },
  };
}

// GuV — income − expense over the period.
export function createIncomeStatementHandler(
  access: AccessRule = DEFAULT_LEDGER_ACCESS,
): QueryHandlerDef {
  return {
    name: "report:income-statement",
    schema: periodSchema,
    access,
    handler: async (query, ctx) => {
      const period = periodSchema.parse(query);
      const { accounts, entries } = await loadBooks(ctx);
      return incomeStatement(accounts, entries, period);
    },
  };
}

// Bilanz as of `to` — current result folded into equity so it balances.
export function createBalanceSheetHandler(
  access: AccessRule = DEFAULT_LEDGER_ACCESS,
): QueryHandlerDef {
  return {
    name: "report:balance-sheet",
    schema: periodSchema,
    access,
    handler: async (query, ctx) => {
      const period = periodSchema.parse(query);
      const { accounts, entries } = await loadBooks(ctx);
      return balanceSheet(accounts, entries, period);
    },
  };
}
