// ledger — double-entry bookkeeping as a host-agnostic primitive.
//
// Two event-sourced entities:
//   1. `account` (read_ledger_accounts)        — per-tenant chart of accounts (parentId tree).
//   2. `transaction` (read_ledger_transactions) — journal entries with embedded,
//      balanced posting lines (Σ amount = 0). IMMUTABLE: no update/delete handler;
//      corrections are reverse-transaction (Storno) entries.
//
// Everything financial — banking, accounting, rent cashflow, credits, invoices —
// is accounts + balanced transactions on top. Balances and reports (Bilanz, GuV,
// Cashflow) are pure queries over the postings (Phase 1), never stored state.
//
// Spec: kumiko-platform/docs/plans/ledger-feature.md

import {
  type AccessRule,
  defineEntityCreateHandler,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
  defineFeature,
  type FeatureRegistrar,
} from "@cosmicdrift/kumiko-framework/engine";
import { DEFAULT_LEDGER_ACCESS, LEDGER_FEATURE_NAME } from "./constants";
import { accountEntity, scheduleEntity, transactionEntity } from "./entity";
import { createConfirmSchedulePeriodHandler } from "./handlers/confirm-schedule-period.write";
import { createCreateTransactionHandler } from "./handlers/create-transaction.write";
import {
  createBalanceSheetHandler,
  createBalancesReportHandler,
  createIncomeStatementHandler,
} from "./handlers/reports.query";
import { createReverseTransactionHandler } from "./handlers/reverse-transaction.write";

// Opt-in tier-gating (mirrors folders): when set, the feature declares itself
// r.toggleable so the dispatcher gate + tier-engine can switch the WHOLE ledger
// on/off per tenant. Use { default: false } for fail-closed gating.
type LedgerToggleable = { readonly default: boolean };

function registerLedger(
  r: FeatureRegistrar<typeof LEDGER_FEATURE_NAME>,
  access: AccessRule,
  toggleable: LedgerToggleable | undefined,
): void {
  r.describe(
    "Double-entry bookkeeping primitive. Owns two event-sourced entities — the per-tenant `account` chart of accounts (`read_ledger_accounts`, self-referential via parentId, typed asset/liability/equity/income/expense) and immutable `transaction` journal entries (`read_ledger_transactions`) whose balanced posting lines are embedded as jsonb (Σ amount = 0, signed integer minor units). The account catalog uses the generic entity handlers (create, update, list, detail); create-transaction books a balanced entry (Σ=0 and ≥2 distinct accounts enforced at the command boundary, referential integrity against accounts checked) and reverse-transaction books its Storno mirror — there is deliberately NO transaction update/delete, so a posted entry is an immutable fact and the audit trail stays intact. Recurring schedules (`read_ledger_schedules`) layer Dauerauftrag templates on top — a schedule names debit/credit accounts, an amount and a monthly interval, from which the Soll (forecast) is a pure projection (projectSchedule) needing no bookings, and confirm-schedule-period materialises one period as an idempotent, reversal-aware balanced entry referencing scheduleReference(id, period); only confirming writes. Balances and reports (balance sheet, P&L, cashflow) derive as pure queries over the postings. Everything financial — banking, accounting, rent cashflow, credits, invoices — models as accounts + balanced transactions on top. Pin roles with createLedgerFeature({ roles }) or adopt the host model with { access }; pass { toggleable: { default: false } } to tier-gate the whole feature.",
  );
  r.uiHints({
    displayLabel: "Ledger",
    category: "data",
    recommended: false,
  });

  if (toggleable !== undefined) r.toggleable(toggleable);

  r.entity("account", accountEntity);
  r.entity("transaction", transactionEntity);
  r.entity("schedule", scheduleEntity);

  // Chart of accounts — plain CRUD, no custom logic. No delete in v1: removing an
  // account that has postings would orphan them; a posting-aware guard lands with
  // the postings projection (Phase 1).
  r.writeHandler(defineEntityCreateHandler("account", accountEntity, { access }));
  r.writeHandler(defineEntityUpdateHandler("account", accountEntity, { access }));
  r.queryHandler(defineEntityListHandler("account", accountEntity, { access }));
  r.queryHandler(defineEntityDetailHandler("account", accountEntity, { access }));

  // Journal entries — immutable. Only create (balanced) + reverse (Storno). No
  // update/delete handler is registered, so a posted entry cannot be mutated.
  r.writeHandler(createCreateTransactionHandler(access));
  r.writeHandler(createReverseTransactionHandler(access));
  r.queryHandler(defineEntityListHandler("transaction", transactionEntity, { access }));
  r.queryHandler(defineEntityDetailHandler("transaction", transactionEntity, { access }));

  // Recurring schedules — CRUD catalog plus confirm-schedule-period, which books
  // one projected period as a balanced, idempotent + reversal-aware entry. The
  // Soll (forecast) is a pure projection (projectSchedule); only confirming writes.
  r.writeHandler(defineEntityCreateHandler("schedule", scheduleEntity, { access }));
  r.writeHandler(defineEntityUpdateHandler("schedule", scheduleEntity, { access }));
  r.writeHandler(createConfirmSchedulePeriodHandler(access));
  r.queryHandler(defineEntityListHandler("schedule", scheduleEntity, { access }));
  r.queryHandler(defineEntityDetailHandler("schedule", scheduleEntity, { access }));

  // Reports — pure aggregations over the posted entries (account balances,
  // GuV, Bilanz with the current result folded into equity).
  r.queryHandler(createBalancesReportHandler(access));
  r.queryHandler(createIncomeStatementHandler(access));
  r.queryHandler(createBalanceSheetHandler(access));
}

export const ledgerFeature = defineFeature(LEDGER_FEATURE_NAME, (r) =>
  registerLedger(r, DEFAULT_LEDGER_ACCESS, undefined),
);

export type LedgerFeatureOptions = {
  /** Access rule for all ledger write/read paths. Default { roles: ["TenantAdmin","TenantMember"] }.
   *  Takes precedence over `roles`. */
  readonly access?: AccessRule;
  /** Shorthand for { access: { roles } }. Ignored when `access` is set. */
  readonly roles?: readonly string[];
  /** Make the whole feature tier-gatable via the tier-engine. Use { default: false }
   *  for fail-closed gating. Omit to keep the ledger always-on (default). */
  readonly toggleable?: LedgerToggleable;
};

function resolveAccess(opts: LedgerFeatureOptions): AccessRule {
  if (opts.access !== undefined) return opts.access;
  if (opts.roles !== undefined) return { roles: opts.roles };
  return DEFAULT_LEDGER_ACCESS;
}

// Options wrapper. Without options returns the module-level singleton (no
// rebuild). access/roles/toggleable build a fresh feature-definition.
export function createLedgerFeature(opts: LedgerFeatureOptions = {}): typeof ledgerFeature {
  if (opts.access === undefined && opts.roles === undefined && opts.toggleable === undefined) {
    return ledgerFeature;
  }
  const access = resolveAccess(opts);
  return defineFeature(LEDGER_FEATURE_NAME, (r) => registerLedger(r, access, opts.toggleable));
}
