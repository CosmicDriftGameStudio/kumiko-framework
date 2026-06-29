// @runtime client
// ledger bundle constants — feature-name + qualified handler/query names.
//
// Spec: kumiko-platform/docs/plans/ledger-feature.md

import type { AccessRule } from "@cosmicdrift/kumiko-framework/engine";

export const LEDGER_FEATURE_NAME = "ledger";

// Qualified names (QN format: scope:type:name). The account catalog uses the
// generic defineEntity*Handler (create/update/list/detail) → "account:<verb>"
// qualified to "ledger:write:account:<verb>". Transactions are immutable: only
// create-transaction (balanced, Σ=0) and reverse-transaction (Storno) exist —
// no update/delete, so a posted journal entry can never be mutated.
export const LedgerHandlers = {
  createAccount: "ledger:write:account:create",
  updateAccount: "ledger:write:account:update",
  createTransaction: "ledger:write:create-transaction",
  reverseTransaction: "ledger:write:reverse-transaction",
  // Recurring schedules — the catalog's CRUD verbs plus the confirm verb that
  // books one projected period as a balanced, idempotent entry.
  createSchedule: "ledger:write:schedule:create",
  updateSchedule: "ledger:write:schedule:update",
  confirmSchedulePeriod: "ledger:write:confirm-schedule-period",
} as const;

export const LedgerQueries = {
  accountList: "ledger:query:account:list",
  accountDetail: "ledger:query:account:detail",
  transactionList: "ledger:query:transaction:list",
  transactionDetail: "ledger:query:transaction:detail",
  scheduleList: "ledger:query:schedule:list",
  scheduleDetail: "ledger:query:schedule:detail",
  // Reports — pure aggregations over the posted entries (Phase 1).
  reportBalances: "ledger:query:report:balances",
  reportIncomeStatement: "ledger:query:report:income-statement",
  reportBalanceSheet: "ledger:query:report:balance-sheet",
} as const;

// Account types double-entry needs to interpret a balance: asset/expense are
// debit-normal, liability/equity/income are credit-normal. The report layer
// (Phase 1) flips signs by type; the primitive only stores them.
export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const TRANSACTION_STATUS = ["draft", "posted"] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUS)[number];

// Recurrence steps a schedule can project. Monthly is the only step v1 needs
// (rent, loan rate, salary); weekly/quarterly/yearly add to projectSchedule when
// a schedule actually requires them.
export const SCHEDULE_INTERVALS = ["monthly"] as const;
export type ScheduleInterval = (typeof SCHEDULE_INTERVALS)[number];

// Default RBAC for every ledger path. A ledger is sensitive (it's the books), but
// like folders it adopts the host's model — apps pin roles via
// createLedgerFeature({ roles }) or { access }. Default: both tenant roles.
export const DEFAULT_LEDGER_ROLES = ["TenantAdmin", "TenantMember"] as const;

export const DEFAULT_LEDGER_ACCESS: AccessRule = { roles: DEFAULT_LEDGER_ROLES };
