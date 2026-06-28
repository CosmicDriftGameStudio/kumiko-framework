import { parseJsonSafe } from "@cosmicdrift/kumiko-framework/utils";
import type { AccountType } from "./constants";
import type { Posting } from "./schemas";

// Pure report aggregation over posted journal entries. No DB, no IO — the query
// handlers fetch accounts + transactions (selectMany) and feed them here, so the
// accounting logic is fully unit-testable. v1 aggregates over the transaction
// list directly (query-first); a flat read_ledger_postings projection is the
// documented materialisation upgrade for when this is measurably slow.

export type LedgerAccount = {
  readonly id: string;
  readonly name: string;
  readonly type: AccountType;
};

export type LedgerEntry = {
  readonly status: string;
  readonly date: string;
  readonly lines: readonly Posting[];
};

export type Period = { readonly from?: string; readonly to?: string };

// asset/expense are debit-normal (a positive raw balance = normal side);
// liability/equity/income are credit-normal (negative raw = normal side).
const DEBIT_NORMAL: ReadonlySet<AccountType> = new Set<AccountType>(["asset", "expense"]);

function naturalBalance(type: AccountType, raw: number): number {
  const n = DEBIT_NORMAL.has(type) ? raw : -raw;
  return n === 0 ? 0 : n; // avoid -0 for credit-normal accounts with a 0 balance
}

// jsonb lines surface as a parsed array or a JSON string depending on the driver
// path — normalise so the pure fns always get Posting[].
export function normalizeLines(raw: unknown): Posting[] {
  const value = typeof raw === "string" ? parseJsonSafe<unknown>(raw, null) : raw;
  return Array.isArray(value) ? (value as Posting[]) : []; // @cast-boundary db-row
}

export function toAccounts(rows: readonly Record<string, unknown>[]): LedgerAccount[] {
  return rows.map((r) => ({
    id: r["id"] as string, // @cast-boundary db-row
    name: r["name"] as string, // @cast-boundary db-row
    type: r["type"] as AccountType, // @cast-boundary db-row
  }));
}

export function toEntries(rows: readonly Record<string, unknown>[]): LedgerEntry[] {
  return rows.map((r) => ({
    status: r["status"] as string, // @cast-boundary db-row
    date: String(r["date"]),
    lines: normalizeLines(r["lines"]),
  }));
}

function inPeriod(date: string, period?: Period): boolean {
  if (period?.from !== undefined && date < period.from) return false;
  if (period?.to !== undefined && date > period.to) return false;
  return true;
}

// Raw signed balance (Soll +, Haben −) per accountId over POSTED entries in the
// period. Draft entries never count toward the books.
export function rawBalances(entries: readonly LedgerEntry[], period?: Period): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries) {
    if (e.status !== "posted") continue;
    if (!inPeriod(e.date, period)) continue;
    for (const l of e.lines) {
      out.set(l.accountId, (out.get(l.accountId) ?? 0) + l.amount);
    }
  }
  return out;
}

export type AccountBalance = {
  readonly id: string;
  readonly name: string;
  readonly type: AccountType;
  readonly balance: number; // natural (sign-corrected by type)
};

export type BalancesReport = {
  readonly accounts: readonly AccountBalance[];
  // Σ of every RAW balance — 0 on a consistent ledger (the trial balance),
  // because every entry sums to 0. The golden invariant.
  readonly trialBalance: number;
};

export function accountBalances(
  accounts: readonly LedgerAccount[],
  entries: readonly LedgerEntry[],
  period?: Period,
): BalancesReport {
  const raw = rawBalances(entries, period);
  const rows = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    balance: naturalBalance(a.type, raw.get(a.id) ?? 0),
  }));
  let trial = 0;
  for (const v of raw.values()) trial += v;
  return { accounts: rows, trialBalance: trial };
}

export type IncomeStatement = {
  readonly income: number;
  readonly expense: number;
  readonly netIncome: number;
};

export function incomeStatement(
  accounts: readonly LedgerAccount[],
  entries: readonly LedgerEntry[],
  period?: Period,
): IncomeStatement {
  const raw = rawBalances(entries, period);
  let income = 0;
  let expense = 0;
  for (const a of accounts) {
    const nat = naturalBalance(a.type, raw.get(a.id) ?? 0);
    if (a.type === "income") income += nat;
    else if (a.type === "expense") expense += nat;
  }
  return { income, expense, netIncome: income - expense };
}

export type BalanceSheet = {
  readonly assets: number;
  readonly liabilities: number;
  readonly equity: number; // includes currentResult
  readonly currentResult: number; // laufendes Ergebnis = net income to date
  readonly balances: boolean; // assets === liabilities + equity
};

// Balance sheet as of a date — pass the period as { to: asOf } (cumulative). The
// current result (net income to date) is folded into equity as the "laufendes
// Ergebnis" line, so the statement balances WITHOUT a period-close: assets =
// liabilities + equity holds because the trial balance is 0.
export function balanceSheet(
  accounts: readonly LedgerAccount[],
  entries: readonly LedgerEntry[],
  period?: Period,
): BalanceSheet {
  const raw = rawBalances(entries, period);
  let assets = 0;
  let liabilities = 0;
  let equityBase = 0;
  let income = 0;
  let expense = 0;
  for (const a of accounts) {
    const nat = naturalBalance(a.type, raw.get(a.id) ?? 0);
    if (a.type === "asset") assets += nat;
    else if (a.type === "liability") liabilities += nat;
    else if (a.type === "equity") equityBase += nat;
    else if (a.type === "income") income += nat;
    else if (a.type === "expense") expense += nat;
  }
  const currentResult = income - expense;
  const equity = equityBase + currentResult;
  return { assets, liabilities, equity, currentResult, balances: assets === liabilities + equity };
}
